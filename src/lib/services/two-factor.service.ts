import "server-only";
import { createHash, randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { conflict, forbidden, unauthenticated } from "@/lib/errors";
import type { AuthContext, SessionUser } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "@/lib/auth/totp";
import { seal, open } from "@/lib/auth/secret-box";
import { recordLoginAttempt, enforceRateLimit } from "@/lib/rate-limit";
import { generateToken } from "@/lib/utils";
import { notify } from "./notification.service";
import { finishLogin } from "./auth.service";

/**
 * Two-factor sign-in with an authenticator app.
 *
 * Setup is two steps so nobody is locked out by a mistyped seed: the secret is
 * held (encrypted) against a short-lived setup token until the owner proves
 * their app produces the right code. Sign-in is also two steps: the password
 * yields only a challenge, and the session is created once a current code or
 * an unused backup code is presented against it.
 */

const SEAL_PURPOSE = "totp-secret";
const SETUP_TTL_MS = 15 * 60_000;
const CHALLENGE_TTL_MS = 10 * 60_000;
const CHALLENGE_MAX_ATTEMPTS = 5;
const BACKUP_CODE_COUNT = 10;
const ISSUER = "PetMate";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Backup codes are typed by hand: lowercase, no look-alike characters, grouped. */
function newBackupCode(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(10);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
  return `${chars.slice(0, 5)}-${chars.slice(5, 10)}`;
}

const normalizeBackupCode = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, "");

async function replaceBackupCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: BACKUP_CODE_COUNT }, newBackupCode);
  await db.$transaction([
    db.twoFactorBackupCode.deleteMany({ where: { userId } }),
    db.twoFactorBackupCode.createMany({
      data: codes.map((code) => ({ userId, codeHash: sha256(normalizeBackupCode(code)) })),
    }),
  ]);
  return codes;
}

/**
 * Checks a code from the app, or failing that a backup code, and consumes it:
 * the TOTP step is recorded so it cannot be used twice, and a backup code is
 * marked used. Both are conditional updates, so two requests racing with the
 * same code cannot both succeed.
 */
async function consumeSecondFactor(userId: string, code: string): Promise<"TOTP" | "BACKUP_CODE" | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { twoFactorSecret: true, twoFactorLastCounter: true },
  });
  if (!user?.twoFactorSecret) return null;

  const trimmed = code.trim();
  if (/^\d[\d\s]{5,7}$/.test(trimmed)) {
    const counter = verifyTotp(open(user.twoFactorSecret, SEAL_PURPOSE), trimmed, {
      lastUsedCounter: user.twoFactorLastCounter,
    });
    if (counter == null) return null;
    const { count } = await db.user.updateMany({
      where: {
        id: userId,
        OR: [{ twoFactorLastCounter: null }, { twoFactorLastCounter: { lt: counter } }],
      },
      data: { twoFactorLastCounter: counter },
    });
    return count === 1 ? "TOTP" : null;
  }

  const normalized = normalizeBackupCode(trimmed);
  if (normalized.length !== 10) return null;
  const { count } = await db.twoFactorBackupCode.updateMany({
    where: { userId, codeHash: sha256(normalized), usedAt: null },
    data: { usedAt: new Date() },
  });
  return count === 1 ? "BACKUP_CODE" : null;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export async function getTwoFactorStatus(userId: string) {
  const [user, remaining] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { twoFactorEnabledAt: true } }),
    db.twoFactorBackupCode.count({ where: { userId, usedAt: null } }),
  ]);
  return { enabled: Boolean(user?.twoFactorEnabledAt), enabledAt: user?.twoFactorEnabledAt ?? null, backupCodesLeft: remaining };
}

export async function beginTwoFactorSetup(auth: AuthContext) {
  const status = await getTwoFactorStatus(auth.user.id);
  if (status.enabled) throw conflict("Two-step sign-in is already on.");

  const secret = generateTotpSecret();
  await db.$transaction([
    db.verificationToken.deleteMany({ where: { userId: auth.user.id, purpose: "TOTP_SETUP" } }),
    db.verificationToken.create({
      data: {
        userId: auth.user.id,
        identifier: auth.user.email,
        purpose: "TOTP_SETUP",
        tokenHash: sha256(generateToken(24)),
        payload: seal(secret, SEAL_PURPOSE),
        expiresAt: new Date(Date.now() + SETUP_TTL_MS),
      },
    }),
  ]);

  const url = otpauthUrl({ secret, account: auth.user.email, issuer: ISSUER });
  const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  // Grouped in fours, as people read it when typing it in by hand.
  return { secret: secret.match(/.{1,4}/g)!.join(" "), otpauthUrl: url, qrSvg };
}

export async function confirmTwoFactorSetup(auth: AuthContext, code: string): Promise<{ backupCodes: string[] }> {
  await enforceRateLimit("login", `2fa-setup:${auth.user.id}`);
  const setup = await db.verificationToken.findFirst({
    where: { userId: auth.user.id, purpose: "TOTP_SETUP", consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, payload: true },
  });
  if (!setup?.payload) throw conflict("That setup has expired. Start again.");

  const secret = open(setup.payload, SEAL_PURPOSE);
  const counter = verifyTotp(secret, code);
  if (counter == null) throw unauthenticated("That code is not correct. Check the time on your phone and try again.");

  const { count } = await db.verificationToken.updateMany({
    where: { id: setup.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (count === 0) throw conflict("That setup has expired. Start again.");

  await db.user.update({
    where: { id: auth.user.id },
    data: { twoFactorSecret: seal(secret, SEAL_PURPOSE), twoFactorEnabledAt: new Date(), twoFactorLastCounter: counter },
  });
  const backupCodes = await replaceBackupCodes(auth.user.id);

  await audit({ action: "auth.two_factor_enabled", actorId: auth.user.id, entityType: "USER", entityId: auth.user.id });
  await notify({
    userId: auth.user.id,
    category: "SECURITY",
    type: "security.two_factor_enabled",
    title: "Two-step sign-in is on",
    body: "Signing in now needs a code from your authenticator app. If this was not you, reset your password straight away.",
    url: "/settings/security",
  });

  return { backupCodes };
}

/** Turning it off needs the password and a second factor: a stolen session alone is not enough. */
export async function disableTwoFactor(auth: AuthContext, password: string, code: string) {
  await enforceRateLimit("login", `2fa-disable:${auth.user.id}`);
  const user = await db.user.findUnique({ where: { id: auth.user.id }, select: { passwordHash: true, twoFactorEnabledAt: true } });
  if (!user?.twoFactorEnabledAt) throw conflict("Two-step sign-in is not on.");
  if (!(await verifyPassword(password, user.passwordHash))) throw forbidden("That password is not correct.");
  if (!(await consumeSecondFactor(auth.user.id, code))) throw forbidden("That code is not correct.");

  await db.$transaction([
    db.user.update({
      where: { id: auth.user.id },
      data: { twoFactorSecret: null, twoFactorEnabledAt: null, twoFactorLastCounter: null },
    }),
    db.twoFactorBackupCode.deleteMany({ where: { userId: auth.user.id } }),
  ]);

  await audit({ action: "auth.two_factor_disabled", actorId: auth.user.id, entityType: "USER", entityId: auth.user.id });
  await notify({
    userId: auth.user.id,
    category: "SECURITY",
    type: "security.two_factor_disabled",
    title: "Two-step sign-in was turned off",
    body: "Your account is now protected by your password alone. If this was not you, reset your password straight away.",
    url: "/settings/security",
  });
  return { enabled: false };
}

export async function regenerateBackupCodes(auth: AuthContext, code: string) {
  await enforceRateLimit("login", `2fa-codes:${auth.user.id}`);
  const status = await getTwoFactorStatus(auth.user.id);
  if (!status.enabled) throw conflict("Two-step sign-in is not on.");
  if (!(await consumeSecondFactor(auth.user.id, code))) throw forbidden("That code is not correct.");
  const backupCodes = await replaceBackupCodes(auth.user.id);
  await audit({ action: "auth.backup_codes_regenerated", actorId: auth.user.id, entityType: "USER", entityId: auth.user.id });
  return { backupCodes };
}

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

/** Issued once the password is right; worth nothing without a second factor. */
export async function issueTwoFactorChallenge(userId: string, email: string): Promise<string> {
  const raw = generateToken(32);
  await db.verificationToken.create({
    data: {
      userId,
      identifier: email,
      purpose: "LOGIN_2FA",
      tokenHash: sha256(raw),
      payload: JSON.stringify({ attempts: 0 }),
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });
  return raw;
}

export async function completeTwoFactorLogin(input: {
  challenge: string;
  code: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<SessionUser> {
  const token = await db.verificationToken.findUnique({
    where: { tokenHash: sha256(input.challenge) },
    select: { id: true, userId: true, identifier: true, purpose: true, payload: true, consumedAt: true, expiresAt: true },
  });
  if (!token || token.purpose !== "LOGIN_2FA" || token.consumedAt || token.expiresAt < new Date() || !token.userId) {
    throw unauthenticated("Your sign-in has expired. Enter your password again.");
  }

  const attempts = (JSON.parse(token.payload ?? "{}") as { attempts?: number }).attempts ?? 0;
  if (attempts >= CHALLENGE_MAX_ATTEMPTS) {
    await db.verificationToken.update({ where: { id: token.id }, data: { consumedAt: new Date() } });
    throw unauthenticated("Too many wrong codes. Enter your password again.");
  }

  const method = await consumeSecondFactor(token.userId, input.code);
  if (!method) {
    await db.verificationToken.update({
      where: { id: token.id },
      data: { payload: JSON.stringify({ attempts: attempts + 1 }) },
    });
    await recordLoginAttempt(token.identifier, false, { ip: input.ip, reason: "bad_2fa" });
    throw unauthenticated("That code is not correct.");
  }

  // Single use: a second request with the same challenge finds it consumed.
  const { count } = await db.verificationToken.updateMany({
    where: { id: token.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (count === 0) throw unauthenticated("Your sign-in has expired. Enter your password again.");

  const user = await db.user.findUniqueOrThrow({
    where: { id: token.userId },
    select: {
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
      roles: { select: { role: true } },
    },
  });
  if (user.status === "BANNED" || user.status === "DEACTIVATED") {
    throw forbidden("This account cannot be signed in to. Contact support.");
  }

  if (method === "BACKUP_CODE") {
    const left = await db.twoFactorBackupCode.count({ where: { userId: user.id, usedAt: null } });
    await notify({
      userId: user.id,
      category: "SECURITY",
      type: "security.backup_code_used",
      title: "A backup code was used to sign in",
      body:
        left > 0
          ? `You have ${left} backup codes left. If this was not you, change your password now.`
          : "That was your last backup code. Create new ones in your security settings.",
      url: "/settings/security",
    });
  }

  return finishLogin(user, { email: token.identifier, ip: input.ip, userAgent: input.userAgent, method });
}
