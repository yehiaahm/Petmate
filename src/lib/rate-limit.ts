import "server-only";
import { db } from "@/lib/db";
import { rateLimited } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Rate limiting.
 *
 * Backed by the database rather than process memory, so a limit is not reset by
 * a deploy and holds across every instance sharing the database. In-memory
 * counters are a per-process illusion the moment you run two containers.
 *
 * Fixed windows, which can allow up to 2x the limit at a boundary. That is an
 * accepted trade for a counter that costs one upsert. The strict buckets that
 * matter (login, password reset, payment) are sized with that doubling in mind.
 */

export interface RateLimitRule {
  /** Window length in seconds. */
  window: number;
  /** Maximum requests allowed inside one window. */
  max: number;
}

export const RATE_LIMITS = {
  // Authentication — sized for a human, hostile to a script.
  login: { window: 900, max: 8 },
  loginPerIp: { window: 900, max: 30 },
  register: { window: 3600, max: 5 },
  passwordReset: { window: 3600, max: 4 },
  emailVerifyResend: { window: 3600, max: 5 },

  // Money. Deliberately tight; a legitimate user never hits these.
  payment: { window: 60, max: 10 },
  checkout: { window: 300, max: 20 },
  refund: { window: 3600, max: 20 },

  // Content creation — spam and listing-farm control.
  listingCreate: { window: 3600, max: 15 },
  petCreate: { window: 3600, max: 20 },
  message: { window: 60, max: 30 },
  breedingRequest: { window: 3600, max: 25 },
  adoptionApply: { window: 86400, max: 10 },
  review: { window: 86400, max: 15 },
  report: { window: 3600, max: 10 },
  upload: { window: 600, max: 40 },
  productImport: { window: 3600, max: 20 },
  adCampaign: { window: 3600, max: 10 },
  // One billable impression / click per visitor per campaign per window, so a
  // refresh loop cannot drain a competitor's budget.
  adImpression: { window: 1800, max: 1 },
  adClick: { window: 1800, max: 1 },
  groupCreate: { window: 86400, max: 3 },
  // Every code costs money to send and is a way to spam a stranger's phone.
  phoneCode: { window: 3600, max: 5 },
  clientError: { window: 600, max: 20 },
  phoneCodePerNumber: { window: 86400, max: 8 },
  post: { window: 3600, max: 20 },
  comment: { window: 300, max: 30 },
  supportTicket: { window: 3600, max: 6 },
  supportReply: { window: 600, max: 20 },

  // Expensive reads.
  search: { window: 60, max: 90 },
  aiAssistant: { window: 3600, max: 30 },
  aiListingHelp: { window: 3600, max: 20 },

  // Generic API fallback.
  api: { window: 60, max: 240 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number;
  limit: number;
}

/**
 * Consumes one unit from `name:identifier`.
 *
 * Fails open on a database error: a broken counter table must not take the
 * whole site down. The failure is logged loudly so it cannot go unnoticed.
 */
export async function checkRateLimit(
  name: RateLimitName,
  identifier: string,
): Promise<RateLimitResult> {
  const rule = RATE_LIMITS[name];

  if (process.env.RATE_LIMIT_ENABLED === "false" || process.env.NODE_ENV === "test") {
    return { allowed: true, remaining: rule.max, retryAfter: 0, limit: rule.max };
  }

  const now = Date.now();
  const windowStart = Math.floor(now / (rule.window * 1000)) * rule.window * 1000;
  const bucket = `${name}:${identifier}:${windowStart}`;
  const expiresAt = new Date(windowStart + rule.window * 1000);

  try {
    // One statement, atomic in both engines: insert at 1, or increment.
    const row = await db.rateLimitCounter.upsert({
      where: { bucket },
      create: { bucket, count: 1, expiresAt },
      update: { count: { increment: 1 } },
      select: { count: true },
    });

    const allowed = row.count <= rule.max;
    return {
      allowed,
      remaining: Math.max(0, rule.max - row.count),
      retryAfter: allowed ? 0 : Math.ceil((expiresAt.getTime() - now) / 1000),
      limit: rule.max,
    };
  } catch (e) {
    logger.exception("rate limiter unavailable, failing open", e, { name });
    return { allowed: true, remaining: rule.max, retryAfter: 0, limit: rule.max };
  }
}

/**
 * Counts an event at most `max` times per key per window, for rules that
 * decide what someone is charged (an ad impression) rather than protect the
 * server. Unlike `checkRateLimit` it is never switched off by configuration
 * or in tests, and it fails closed: when the counter cannot be read, the event
 * is not counted, so an outage can never bill anyone for more than happened.
 */
export async function countOnce(key: string, windowSeconds: number, max = 1): Promise<boolean> {
  const windowStart = Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000;
  const bucket = `once:${key}:${windowStart}`;
  try {
    const row = await db.rateLimitCounter.upsert({
      where: { bucket },
      create: { bucket, count: 1, expiresAt: new Date(windowStart + windowSeconds * 1000) },
      update: { count: { increment: 1 } },
      select: { count: true },
    });
    return row.count <= max;
  } catch (e) {
    logger.exception("event counter unavailable, not counting", e, { key });
    return false;
  }
}

/** Throws the standard 429 when the bucket is exhausted. */
export async function enforceRateLimit(
  name: RateLimitName,
  identifier: string,
): Promise<RateLimitResult> {
  const result = await checkRateLimit(name, identifier);
  if (!result.allowed) throw rateLimited(result.retryAfter);
  return result;
}

/** Removes expired buckets. Called by the `prune.rateLimits` job. */
export async function pruneRateLimits(): Promise<number> {
  const { count } = await db.rateLimitCounter.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}

// ---------------------------------------------------------------------------
// Login lockout
// ---------------------------------------------------------------------------

const LOCKOUT_THRESHOLD = 10;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Progressive lockout on top of the rate limiter, keyed on the account rather
 * than the IP so a distributed attack on one account is still stopped.
 */
export async function isAccountLocked(identifier: string): Promise<{
  locked: boolean;
  until: Date | null;
}> {
  const since = new Date(Date.now() - LOCKOUT_WINDOW_MS);

  const recent = await db.loginAttempt.findMany({
    where: { identifier, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: { success: true, createdAt: true },
    take: LOCKOUT_THRESHOLD + 5,
  });

  // Any success inside the window clears the streak.
  let failures = 0;
  for (const a of recent) {
    if (a.success) break;
    failures++;
  }

  if (failures < LOCKOUT_THRESHOLD) return { locked: false, until: null };

  const newest = recent[0]?.createdAt ?? new Date();
  const until = new Date(newest.getTime() + LOCKOUT_WINDOW_MS);
  return { locked: until > new Date(), until };
}

export async function recordLoginAttempt(
  identifier: string,
  success: boolean,
  meta: { ip?: string | null; reason?: string } = {},
) {
  await db.loginAttempt
    .create({
      data: {
        identifier: identifier.toLowerCase().slice(0, 320),
        success,
        ip: meta.ip ?? null,
        reason: meta.reason ?? null,
      },
    })
    .catch((e) => logger.exception("failed to record login attempt", e));
}
