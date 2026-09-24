import "server-only";
import { cookies, headers } from "next/headers";
import { createHash, randomBytes, timingSafeEqual, createHmac } from "node:crypto";
import { cache } from "react";
import { db } from "@/lib/db";
import { env, isProduction } from "@/lib/env";
import type { Role } from "@/lib/constants";
import { logger } from "@/lib/logger";

/**
 * Session management.
 *
 * The cookie holds a 32-byte random token. The database holds only its SHA-256,
 * so a database leak does not hand an attacker a working session. Sessions are
 * server-side records, which means "sign out everywhere" and admin-forced
 * revocation are real operations rather than a hope that a JWT expires.
 */

export const SESSION_COOKIE = "pm_session";
export const CSRF_COOKIE = "pm_csrf";

const SESSION_TTL_DAYS = 30;
const SESSION_REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
  roles: Role[];
  status: string;
  emailVerified: boolean;
  trustScore: number;
  currency: string;
  city: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
}

export interface AuthContext {
  user: SessionUser;
  sessionId: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ---------------------------------------------------------------------------
// Creating and destroying sessions
// ---------------------------------------------------------------------------

export async function createSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);

  await db.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
    },
  });

  return { token, expiresAt };
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  // Double-submit CSRF token. Readable by JS on purpose: the client echoes it
  // in a header, and an attacker on another origin cannot read this cookie.
  jar.set(CSRF_COOKIE, issueCsrfToken(), {
    httpOnly: false,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  if (token) {
    await db.session
      .updateMany({
        where: { tokenHash: hashToken(token), revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch((e) => logger.exception("failed to revoke session", e));
  }

  jar.delete(SESSION_COOKIE);
  jar.delete(CSRF_COOKIE);
}

/** Sign out of every device. Used after a password change or a takeover report. */
export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  await db.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// Reading the current session
// ---------------------------------------------------------------------------

/**
 * Resolves the caller. Memoised per request by `cache`, so a page that checks
 * auth in a layout, a page and three components still issues one query.
 *
 * Returns null rather than throwing: callers decide whether anonymous is valid.
 */
export const getAuth = cache(async (): Promise<AuthContext | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      revokedAt: true,
      lastSeenAt: true,
      user: {
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
          deletedAt: true,
          roles: { select: { role: true } },
        },
      },
    },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;

  const u = session.user;
  if (!u || u.deletedAt) return null;

  // A banned or deactivated account keeps its cookie but gets no identity.
  // SUSPENDED still resolves, so the app can show the user why and let them
  // appeal, but every write path checks `requireActive`.
  if (u.status === "BANNED" || u.status === "DEACTIVATED") return null;

  // Touch `lastSeenAt` at most once a day; writing on every request would turn
  // a read path into a write path.
  if (Date.now() - session.lastSeenAt.getTime() > SESSION_REFRESH_AFTER_MS) {
    void db.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch(() => {});
    void db.user
      .update({ where: { id: u.id }, data: { lastSeenAt: new Date() } })
      .catch(() => {});
  }

  return {
    sessionId: session.id,
    user: {
      id: u.id,
      email: u.email,
      name: u.name,
      handle: u.handle,
      avatarUrl: u.avatarUrl,
      roles: u.roles.map((r) => r.role as Role),
      status: u.status,
      emailVerified: Boolean(u.emailVerifiedAt),
      trustScore: u.trustScore,
      currency: u.currency,
      city: u.city,
      country: u.country,
      lat: u.lat,
      lng: u.lng,
    },
  };
});

export async function getCurrentUser(): Promise<SessionUser | null> {
  return (await getAuth())?.user ?? null;
}

// ---------------------------------------------------------------------------
// CSRF
// ---------------------------------------------------------------------------

/**
 * Double-submit token, HMAC-signed so a forged cookie value is rejected even
 * if an attacker could somehow set one. SameSite=Lax is the first line of
 * defence; this is the second.
 */
export function issueCsrfToken(): string {
  const raw = randomBytes(24).toString("base64url");
  const sig = createHmac("sha256", env().AUTH_SECRET).update(raw).digest("base64url");
  return `${raw}.${sig}`;
}

export function verifyCsrfToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const [raw, sig] = token.split(".");
  if (!raw || !sig) return false;
  const expected = createHmac("sha256", env().AUTH_SECRET).update(raw).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Enforced on every mutating API request. Checks the header against the
 * cookie *and* the signature, so neither half alone is enough.
 */
export async function assertCsrf(request: Request): Promise<boolean> {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;

  const headerToken = request.headers.get("x-csrf-token");
  const jar = await cookies();
  const cookieToken = jar.get(CSRF_COOKIE)?.value;

  if (!headerToken || !cookieToken) return false;
  if (headerToken !== cookieToken) return false;
  return verifyCsrfToken(headerToken);
}

// ---------------------------------------------------------------------------
// Request metadata
// ---------------------------------------------------------------------------

export async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  // Only trust the leftmost XFF entry behind a proxy we control; see
  // docs/DEPLOYMENT.md for the trusted-proxy requirement.
  const forwarded = h.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    h.get("cf-connecting-ip") ||
    null;
  return { ip, userAgent: h.get("user-agent") };
}
