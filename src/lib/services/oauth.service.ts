import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { hashPassword } from "@/lib/auth/password";
import { revokeAllSessions } from "@/lib/auth/session";
import { seal, open } from "@/lib/auth/secret-box";
import { authorizeUrl, fetchOAuthProfile, pkcePair, type OAuthProfile, type OAuthProvider } from "@/lib/auth/oauth";
import { getSettings } from "@/lib/settings";
import { getLocale } from "@/lib/i18n/server";
import { PLATFORM_CURRENCY } from "@/lib/currency";
import { safeRedirect } from "@/lib/validation/common";
import { generateToken } from "@/lib/utils";
import { finishLogin, generateUniqueHandle, normalizeEmail } from "./auth.service";
import { issueTwoFactorChallenge } from "./two-factor.service";
import { seedNotificationPreferences } from "./notification.service";
import { awardTrustSignal } from "./trust.service";

/**
 * Social sign-in.
 *
 * The `state` value is random, single use and also set in a cookie on the
 * browser that started the flow, so a callback only completes in the browser
 * that asked for it (this is what stops "login CSRF", where an attacker signs
 * a victim in to the attacker's account). The PKCE verifier never leaves the
 * server.
 *
 * Account matching, in order:
 *   1. A Google/Facebook identity already linked → that account.
 *   2. An existing account with the same address, which the provider says the
 *      person controls → link it. If that account never confirmed its email,
 *      whoever registered it may not own the address (the "pre-registration"
 *      takeover), so its password is replaced and its sessions revoked.
 *   3. Otherwise a new account, with the address already confirmed.
 */

const STATE_TTL_MS = 10 * 60_000;
const SEAL_PURPOSE = "oauth-state";
export const OAUTH_STATE_COOKIE = "pm_oauth_state";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export async function startOAuth(provider: OAuthProvider, nextRaw: string | null) {
  const state = generateToken(24);
  const { verifier, challenge } = pkcePair();
  const next = safeRedirect(nextRaw ?? undefined, "/dashboard");

  await db.verificationToken.create({
    data: {
      identifier: provider,
      purpose: "OAUTH_STATE",
      tokenHash: sha256(state),
      payload: seal(JSON.stringify({ verifier, next, provider }), SEAL_PURPOSE),
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    },
  });

  return { url: authorizeUrl(provider, { state, challenge }), state, maxAgeSeconds: STATE_TTL_MS / 1000 };
}

/** Why a social sign-in failed, as a code the sign-in page turns into a sentence. */
export type OAuthFailure = "expired" | "provider" | "no-email" | "closed" | "paused";

export class OAuthError extends Error {
  constructor(readonly code: OAuthFailure) {
    super(code);
  }
}

export type OAuthResult =
  | { kind: "SIGNED_IN"; next: string; created: boolean }
  | { kind: "TWO_FACTOR"; next: string; challenge: string };

export async function completeOAuth(input: {
  provider: OAuthProvider;
  code: string;
  state: string;
  cookieState: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<OAuthResult> {
  const expired = () => new OAuthError("expired");

  if (!input.cookieState || input.cookieState.length !== input.state.length) throw expired();
  if (!timingSafeEqual(Buffer.from(input.cookieState), Buffer.from(input.state))) throw expired();

  const record = await db.verificationToken.findUnique({
    where: { tokenHash: sha256(input.state) },
    select: { id: true, purpose: true, payload: true, consumedAt: true, expiresAt: true },
  });
  if (!record || record.purpose !== "OAUTH_STATE" || record.consumedAt || record.expiresAt < new Date() || !record.payload) {
    throw expired();
  }
  const claimed = await db.verificationToken.updateMany({ where: { id: record.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (claimed.count === 0) throw expired();

  const saved = JSON.parse(open(record.payload, SEAL_PURPOSE)) as { verifier: string; next: string; provider: string };
  if (saved.provider !== input.provider) throw expired();

  let profile: OAuthProfile;
  try {
    profile = await fetchOAuthProfile(input.provider, { code: input.code, verifier: saved.verifier });
  } catch (e) {
    logger.exception("oauth profile exchange failed", e, { provider: input.provider });
    throw new OAuthError("provider");
  }

  const user = await findOrCreateUser(profile, { ip: input.ip, userAgent: input.userAgent });

  if (user.status === "BANNED" || user.status === "DEACTIVATED") throw new OAuthError("closed");

  const email = normalizeEmail(user.email);
  if (user.twoFactorEnabledAt) {
    // The provider stands in for the password; the second factor still applies.
    return { kind: "TWO_FACTOR", next: saved.next, challenge: await issueTwoFactorChallenge(user.id, email) };
  }

  await finishLogin(user, { email, ip: input.ip, userAgent: input.userAgent, method: profile.provider.toUpperCase() });
  return { kind: "SIGNED_IN", next: saved.next, created: user.created };
}

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  handle: true,
  avatarUrl: true,
  status: true,
  emailVerifiedAt: true,
  trustScore: true,
  currency: true,
  city: true,
  country: true,
  lat: true,
  lng: true,
  twoFactorEnabledAt: true,
  roles: { select: { role: true } },
} as const;

async function findOrCreateUser(profile: OAuthProfile, context: { ip?: string | null; userAgent?: string | null }) {
  const provider = profile.provider.toUpperCase();
  if (!profile.id) throw new OAuthError("provider");

  // 1. Already linked.
  const linked = await db.oAuthAccount.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId: profile.id } },
    select: { id: true, user: { select: USER_SELECT } },
  });
  if (linked) {
    await db.oAuthAccount.update({ where: { id: linked.id }, data: { lastUsedAt: new Date() } });
    return { ...linked.user, created: false };
  }

  if (!profile.email || !profile.emailVerified) {
    throw new OAuthError("no-email");
  }
  const email = normalizeEmail(profile.email);

  // 2. Same address, not yet linked.
  const existing = await db.user.findUnique({ where: { emailNormalized: email }, select: { ...USER_SELECT, deletedAt: true } });
  if (existing && !existing.deletedAt) {
    const neverConfirmed = !existing.emailVerifiedAt;
    const replacementHash = neverConfirmed ? await hashPassword(generateToken(32)) : null;
    await db.$transaction(async (tx) => {
      await tx.oAuthAccount.create({ data: { userId: existing.id, provider, providerAccountId: profile.id, email } });
      if (neverConfirmed) {
        // Whoever set that password never proved they own the address; the
        // person signing in now just did. Their password stops working.
        await tx.user.update({
          where: { id: existing.id },
          data: { emailVerifiedAt: new Date(), passwordHash: replacementHash! },
        });
      }
      await audit(
        {
          action: "auth.oauth_linked",
          actorId: existing.id,
          entityType: "USER",
          entityId: existing.id,
          summary: neverConfirmed ? `${provider} (unconfirmed account reclaimed)` : provider,
          ip: context.ip,
          userAgent: context.userAgent,
        },
        tx,
      );
    });
    if (neverConfirmed) {
      await revokeAllSessions(existing.id);
      await awardTrustSignal(existing.id, "EMAIL_VERIFIED");
    }
    return { ...existing, emailVerifiedAt: existing.emailVerifiedAt ?? new Date(), created: false };
  }
  if (existing?.deletedAt) throw new OAuthError("closed");

  // 3. New account.
  const settings = await getSettings();
  if (!settings.registrationOpen) throw new OAuthError("paused");

  const handle = await generateUniqueHandle(profile.name);
  const locale = await getLocale();
  const unusableHash = await hashPassword(generateToken(32));
  const created = await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: profile.email!.trim(),
        emailNormalized: email,
        emailVerifiedAt: new Date(),
        // No password: they sign in through the provider, or set one later
        // with "forgot password". A random hash nobody knows keeps the column honest.
        passwordHash: unusableHash,
        name: profile.name.slice(0, 80),
        handle,
        avatarUrl: profile.avatarUrl,
        acceptedTermsAt: new Date(),
        currency: PLATFORM_CURRENCY,
        locale,
        roles: { create: [{ role: "USER" }] },
        oauthAccounts: { create: { provider, providerAccountId: profile.id, email } },
      },
      select: USER_SELECT,
    });
    await seedNotificationPreferences(user.id, tx);
    await audit(
      {
        action: "auth.register",
        actorId: user.id,
        entityType: "USER",
        entityId: user.id,
        summary: `Registered with ${provider}`,
        ip: context.ip,
        userAgent: context.userAgent,
      },
      tx,
    );
    return user;
  });
  await awardTrustSignal(created.id, "EMAIL_VERIFIED");
  return { ...created, created: true };
}

export async function listLinkedAccounts(userId: string) {
  return db.oAuthAccount.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, provider: true, email: true, createdAt: true, lastUsedAt: true },
  });
}
