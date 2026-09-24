import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { clientEnv } from "@/lib/env";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { queueEmail, emailTemplates } from "@/lib/email";
import { badRequest, forbidden, unauthenticated, unprocessable } from "@/lib/errors";
import { hashPassword, verifyPassword, needsRehash, assessPassword } from "@/lib/auth/password";
import {
  createSession,
  revokeAllSessions,
  setSessionCookie,
  type SessionUser,
} from "@/lib/auth/session";
import {
  enforceRateLimit,
  isAccountLocked,
  recordLoginAttempt,
} from "@/lib/rate-limit";
import { awardTrustSignal } from "./trust.service";
import { seedNotificationPreferences } from "./notification.service";
import { getSettings } from "@/lib/settings";
import { getLocale } from "@/lib/i18n/server";
import { generateToken, slugify, readableCode, addDays } from "@/lib/utils";
import type { Role } from "@/lib/constants";

/**
 * Authentication.
 *
 * Three principles run through this file:
 *
 *   1. Nothing here reveals whether an email address exists. Registration,
 *      login and password reset all behave identically for a known and an
 *      unknown address, because a differing response is a user-enumeration
 *      oracle that feeds credential stuffing.
 *   2. Timing is levelled. A login for a missing user still performs a hash
 *      verification against a dummy, so response time does not leak existence.
 *   3. Every state change is audited and, where it affects security, emailed.
 */

const EMAIL_TOKEN_TTL_HOURS = 24;
const RESET_TOKEN_TTL_MINUTES = 60;

/** Compared against on a missing account so failed logins take the same time. */
const DUMMY_HASH =
  "scrypt$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA$" +
  "d2hlbi10aGUtYWNjb3VudC1kb2VzLW5vdC1leGlzdC13ZS1zdGlsbC1kby10aGUtd29yaw";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
  role?: Extract<Role, "USER" | "BREEDER" | "SELLER" | "CLINIC_ADMIN">;
  acceptedTerms: boolean;
  ip?: string | null;
  userAgent?: string | null;
}

export async function register(input: RegisterInput): Promise<{ userId: string }> {
  const settings = await getSettings();
  if (!settings.registrationOpen) {
    throw forbidden("New registrations are paused. Please check back soon.");
  }

  const email = normalizeEmail(input.email);
  await enforceRateLimit("register", input.ip ?? email);

  if (!input.acceptedTerms) {
    throw unprocessable("Please accept the terms to continue.", [
      { field: "acceptedTerms", message: "You must accept the terms of service." },
    ]);
  }

  const strength = assessPassword(input.password, [input.name, email.split("@")[0] ?? ""]);
  if (!strength.ok) {
    throw unprocessable("Choose a stronger password.", [
      { field: "password", message: strength.problems[0] ?? "That password is not strong enough." },
    ]);
  }

  const existing = await db.user.findUnique({
    where: { emailNormalized: email },
    select: { id: true },
  });

  if (existing) {
    // Do not confirm the address exists. Send a "you already have an account"
    // email instead, which is useful to the real owner and useless to a
    // stranger probing for valid addresses.
    await queueEmail({
      to: email,
      email: emailTemplates.generic({
        subject: "You already have a PetMate account",
        heading: "You already have an account",
        body: "Someone tried to sign up with this address. If that was you, sign in instead — or reset your password if you cannot remember it.",
        cta: { label: "Sign in", url: `${clientEnv.NEXT_PUBLIC_APP_URL}/login` },
      }),
      template: "register.duplicate",
    });
    logger.warn("registration attempted on existing address");
    return { userId: existing.id };
  }

  const passwordHash = await hashPassword(input.password);
  const handle = await generateUniqueHandle(input.name);
  const role = input.role ?? "USER";
  // The language they signed up in is the language their email arrives in.
  const locale = await getLocale();

  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: input.email.trim(),
        emailNormalized: email,
        passwordHash,
        name: input.name.trim(),
        handle,
        acceptedTermsAt: new Date(),
        currency: settings.defaultCurrency,
        locale,
        roles: {
          create:
            role === "USER"
              ? [{ role: "USER" }]
              : [{ role: "USER" }, { role }],
        },
      },
      select: { id: true, email: true, name: true },
    });

    await seedNotificationPreferences(created.id, tx);

    await audit(
      {
        action: "auth.register",
        actorId: created.id,
        entityType: "USER",
        entityId: created.id,
        summary: `Registered as ${role}`,
        ip: input.ip,
        userAgent: input.userAgent,
      },
      tx,
    );

    return created;
  });

  await sendVerificationEmail(user.id, user.email, user.name);
  return { userId: user.id };
}

async function generateUniqueHandle(name: string): Promise<string> {
  const base = slugify(name, 24) || "member";

  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${readableCode(4).toLowerCase()}`;
    const taken = await db.user.findUnique({ where: { handle: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  return `${base}-${readableCode(8).toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------

export async function sendVerificationEmail(
  userId: string,
  email: string,
  name: string,
): Promise<void> {
  const token = generateToken(32);

  await db.$transaction(async (tx) => {
    // One live verification token per address at a time.
    await tx.verificationToken.updateMany({
      where: { userId, purpose: "EMAIL_VERIFY", consumedAt: null },
      data: { consumedAt: new Date() },
    });

    await tx.verificationToken.create({
      data: {
        userId,
        identifier: normalizeEmail(email),
        purpose: "EMAIL_VERIFY",
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_HOURS * 3_600_000),
      },
    });

    await queueEmail(
      {
        to: email,
        toName: name,
        email: emailTemplates.verifyEmail({
          name,
          url: `${clientEnv.NEXT_PUBLIC_APP_URL}/verify-email?token=${token}`,
        }),
        template: "auth.verify",
      },
      tx,
    );
  });
}

export async function resendVerification(userId: string): Promise<void> {
  await enforceRateLimit("emailVerifyResend", userId);
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true, emailVerifiedAt: true },
  });
  if (!user) throw unauthenticated();
  if (user.emailVerifiedAt) throw badRequest("Your email address is already confirmed.");
  await sendVerificationEmail(userId, user.email, user.name);
}

export async function verifyEmail(token: string): Promise<{ userId: string }> {
  const record = await db.verificationToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, purpose: true, expiresAt: true, consumedAt: true },
  });

  if (!record || record.purpose !== "EMAIL_VERIFY" || record.consumedAt || !record.userId) {
    throw badRequest("That confirmation link is invalid or has already been used.");
  }
  if (record.expiresAt < new Date()) {
    throw badRequest("That confirmation link has expired. Request a new one.");
  }

  await db.$transaction(async (tx) => {
    // Conditional update: if two clicks race, only one wins.
    const claimed = await tx.verificationToken.updateMany({
      where: { id: record.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (claimed.count === 0) throw badRequest("That confirmation link has already been used.");

    await tx.user.update({
      where: { id: record.userId! },
      data: { emailVerifiedAt: new Date() },
    });

    await audit(
      { action: "auth.email_verified", actorId: record.userId, entityType: "USER", entityId: record.userId! },
      tx,
    );
  });

  await awardTrustSignal(record.userId, "EMAIL_VERIFIED");
  return { userId: record.userId };
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export interface LoginInput {
  email: string;
  password: string;
  ip?: string | null;
  userAgent?: string | null;
}

export async function login(input: LoginInput): Promise<SessionUser> {
  const email = normalizeEmail(input.email);

  await enforceRateLimit("login", email);
  if (input.ip) await enforceRateLimit("loginPerIp", input.ip);

  const lock = await isAccountLocked(email);
  if (lock.locked) {
    await recordLoginAttempt(email, false, { ip: input.ip, reason: "locked" });
    throw forbidden(
      "Too many failed sign-in attempts. Try again in a few minutes, or reset your password.",
    );
  }

  const user = await db.user.findUnique({
    where: { emailNormalized: email },
    select: {
      id: true,
      email: true,
      name: true,
      handle: true,
      avatarUrl: true,
      passwordHash: true,
      status: true,
      statusReason: true,
      emailVerifiedAt: true,
      trustScore: true,
      currency: true,
      city: true,
      country: true,
      lat: true,
      lng: true,
      deletedAt: true,
      roles: { select: { role: true } },
    },
  });

  // Always run a verification, even with no user, so the two paths take
  // comparable time and the response cannot be used to enumerate accounts.
  const hash = user?.passwordHash ?? DUMMY_HASH;
  const passwordOk = await verifyPassword(input.password, hash);

  if (!user || !passwordOk || user.deletedAt) {
    await recordLoginAttempt(email, false, { ip: input.ip, reason: user ? "bad_password" : "no_user" });
    await audit({
      action: "auth.login_failed",
      entityType: "USER",
      entityId: user?.id,
      summary: "Invalid credentials",
      ip: input.ip,
      userAgent: input.userAgent,
    });
    throw unauthenticated("That email or password is not correct.");
  }

  if (user.status === "BANNED") {
    await recordLoginAttempt(email, false, { ip: input.ip, reason: "banned" });
    throw forbidden("This account has been closed. Contact support if you believe this is a mistake.");
  }
  if (user.status === "DEACTIVATED") {
    throw forbidden("This account has been deactivated. Contact support to restore it.");
  }

  // Transparently upgrade a hash created under weaker parameters.
  if (needsRehash(user.passwordHash)) {
    const upgraded = await hashPassword(input.password);
    await db.user
      .update({ where: { id: user.id }, data: { passwordHash: upgraded } })
      .catch((e) => logger.exception("password rehash failed", e, { userId: user.id }));
  }

  const { token, expiresAt } = await createSession(user.id, {
    ip: input.ip,
    userAgent: input.userAgent,
  });
  await setSessionCookie(token, expiresAt);

  await Promise.all([
    recordLoginAttempt(email, true, { ip: input.ip }),
    db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
    audit({
      action: "auth.login",
      actorId: user.id,
      entityType: "USER",
      entityId: user.id,
      ip: input.ip,
      userAgent: input.userAgent,
    }),
  ]);

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    handle: user.handle,
    avatarUrl: user.avatarUrl,
    roles: user.roles.map((r) => r.role as Role),
    status: user.status,
    emailVerified: Boolean(user.emailVerifiedAt),
    trustScore: user.trustScore,
    currency: user.currency,
    city: user.city,
    country: user.country,
    lat: user.lat,
    lng: user.lng,
  };
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export async function requestPasswordReset(params: {
  email: string;
  ip?: string | null;
}): Promise<void> {
  const email = normalizeEmail(params.email);
  await enforceRateLimit("passwordReset", params.ip ?? email);

  const user = await db.user.findUnique({
    where: { emailNormalized: email },
    select: { id: true, email: true, name: true, deletedAt: true, status: true },
  });

  // Caller gets the same answer either way; only the mail differs.
  if (!user || user.deletedAt || user.status === "BANNED") {
    logger.info("password reset requested for unknown or closed account");
    return;
  }

  const token = generateToken(32);

  await db.$transaction(async (tx) => {
    await tx.verificationToken.updateMany({
      where: { userId: user.id, purpose: "PASSWORD_RESET", consumedAt: null },
      data: { consumedAt: new Date() },
    });

    await tx.verificationToken.create({
      data: {
        userId: user.id,
        identifier: email,
        purpose: "PASSWORD_RESET",
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000),
      },
    });

    await queueEmail(
      {
        to: user.email,
        toName: user.name,
        email: emailTemplates.passwordReset({
          name: user.name,
          url: `${clientEnv.NEXT_PUBLIC_APP_URL}/reset-password?token=${token}`,
          ip: params.ip,
        }),
        template: "auth.reset",
      },
      tx,
    );

    await audit(
      {
        action: "auth.password_reset_requested",
        actorId: user.id,
        entityType: "USER",
        entityId: user.id,
        ip: params.ip,
      },
      tx,
    );
  });
}

export async function resetPassword(params: {
  token: string;
  password: string;
  ip?: string | null;
}): Promise<void> {
  const record = await db.verificationToken.findUnique({
    where: { tokenHash: hashToken(params.token) },
    select: { id: true, userId: true, purpose: true, expiresAt: true, consumedAt: true },
  });

  if (!record || record.purpose !== "PASSWORD_RESET" || record.consumedAt || !record.userId) {
    throw badRequest("That reset link is invalid or has already been used.");
  }
  if (record.expiresAt < new Date()) {
    throw badRequest("That reset link has expired. Request a new one.");
  }

  const user = await db.user.findUnique({
    where: { id: record.userId },
    select: { id: true, email: true, name: true },
  });
  if (!user) throw badRequest("That reset link is no longer valid.");

  const strength = assessPassword(params.password, [user.name, user.email.split("@")[0] ?? ""]);
  if (!strength.ok) {
    throw unprocessable("Choose a stronger password.", [
      { field: "password", message: strength.problems[0] ?? "That password is not strong enough." },
    ]);
  }

  const passwordHash = await hashPassword(params.password);

  await db.$transaction(async (tx) => {
    const claimed = await tx.verificationToken.updateMany({
      where: { id: record.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (claimed.count === 0) throw badRequest("That reset link has already been used.");

    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });

    await audit(
      {
        action: "auth.password_reset_completed",
        actorId: user.id,
        entityType: "USER",
        entityId: user.id,
        ip: params.ip,
      },
      tx,
    );
  });

  // A reset is a takeover-recovery action: every existing session dies.
  await revokeAllSessions(user.id);

  await queueEmail({
    to: user.email,
    toName: user.name,
    email: emailTemplates.passwordChanged({
      name: user.name,
      url: `${clientEnv.NEXT_PUBLIC_APP_URL}/settings/security`,
    }),
    template: "auth.password_changed",
  });
}

export async function changePassword(params: {
  userId: string;
  currentPassword: string;
  newPassword: string;
  currentSessionId: string;
  ip?: string | null;
}): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: params.userId },
    select: { id: true, email: true, name: true, passwordHash: true },
  });
  if (!user) throw unauthenticated();

  if (!(await verifyPassword(params.currentPassword, user.passwordHash))) {
    throw unprocessable("That is not your current password.", [
      { field: "currentPassword", message: "Incorrect password." },
    ]);
  }

  const strength = assessPassword(params.newPassword, [user.name, user.email.split("@")[0] ?? ""]);
  if (!strength.ok) {
    throw unprocessable("Choose a stronger password.", [
      { field: "newPassword", message: strength.problems[0] ?? "That password is not strong enough." },
    ]);
  }

  if (await verifyPassword(params.newPassword, user.passwordHash)) {
    throw unprocessable("Choose a password you have not used before.", [
      { field: "newPassword", message: "That is your current password." },
    ]);
  }

  const passwordHash = await hashPassword(params.newPassword);
  await db.user.update({ where: { id: user.id }, data: { passwordHash } });

  // Keep the session that made the change; kill the rest.
  await revokeAllSessions(user.id, params.currentSessionId);

  await audit({
    action: "auth.password_changed",
    actorId: user.id,
    entityType: "USER",
    entityId: user.id,
    ip: params.ip,
  });

  await queueEmail({
    to: user.email,
    toName: user.name,
    email: emailTemplates.passwordChanged({
      name: user.name,
      url: `${clientEnv.NEXT_PUBLIC_APP_URL}/settings/security`,
    }),
    template: "auth.password_changed",
  });
}

// ---------------------------------------------------------------------------
// Session management surface
// ---------------------------------------------------------------------------

export async function listSessions(userId: string, currentSessionId: string) {
  const sessions = await db.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true },
  });

  return sessions.map((s) => ({
    ...s,
    current: s.id === currentSessionId,
    device: describeUserAgent(s.userAgent),
  }));
}

export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  // Scoped by userId: an id belonging to someone else matches nothing.
  const { count } = await db.session.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) throw badRequest("That session is no longer active.");
}

function describeUserAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : /Firefox\//.test(ua)
            ? "Firefox"
            : "Browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Macintosh|Mac OS/.test(ua)
      ? "macOS"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : /Android/.test(ua)
          ? "Android"
          : /Linux/.test(ua)
            ? "Linux"
            : "Unknown OS";
  return `${browser} on ${os}`;
}

/** Removes expired tokens and sessions. Run daily by the worker. */
export async function pruneAuthArtifacts(): Promise<{ sessions: number; tokens: number; attempts: number }> {
  const now = new Date();
  const [sessions, tokens, attempts] = await Promise.all([
    db.session.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: addDays(now, -30) } }] },
    }),
    db.verificationToken.deleteMany({ where: { expiresAt: { lt: addDays(now, -7) } } }),
    db.loginAttempt.deleteMany({ where: { createdAt: { lt: addDays(now, -30) } } }),
  ]);
  return { sessions: sessions.count, tokens: tokens.count, attempts: attempts.count };
}
