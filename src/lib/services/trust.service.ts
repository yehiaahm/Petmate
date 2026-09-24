import "server-only";
import { db, type DbClient } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  TRUST_WEIGHTS,
  TRUST_SIGNAL_LABEL,
  trustTier,
  type TrustSignalKind,
  type TrustTier,
} from "@/lib/constants";
import { clamp } from "@/lib/utils";

/**
 * Trust.
 *
 * The score is the sum of discrete, individually-recorded signals rather than
 * an opaque number. That matters for two reasons: a seller can see exactly what
 * would raise their score, and a buyer can see exactly what earned it. A trust
 * score nobody can interrogate is just a number that people learn to ignore.
 *
 * Signals that are one-off (email verified) are deduplicated. Signals that
 * accumulate (completed sales) are capped so a seller cannot farm the score
 * with a hundred one-dollar transactions.
 */

/** Signals that may only ever count once. */
const ONE_TIME: TrustSignalKind[] = [
  "EMAIL_VERIFIED",
  "PHONE_VERIFIED",
  "ID_VERIFIED",
  "ADDRESS_VERIFIED",
  "BREEDER_VERIFIED",
  "CLINIC_VERIFIED",
  "PROFILE_COMPLETE",
  "FIRST_PET_ADDED",
  "ACCOUNT_AGE_90D",
];

/** Maximum total contribution from a repeatable signal. */
const CONTRIBUTION_CAP: Partial<Record<TrustSignalKind, number>> = {
  SALE_COMPLETED: 25,
  PURCHASE_COMPLETED: 10,
  APPOINTMENT_COMPLETED: 10,
  REVIEW_RECEIVED_POSITIVE: 15,
  PET_DOCUMENTED: 12,
};

export async function awardTrustSignal(
  userId: string,
  kind: TrustSignalKind,
  options: { reference?: string; note?: string } = {},
  client: DbClient = db,
): Promise<void> {
  try {
    if (ONE_TIME.includes(kind)) {
      const existing = await client.trustSignal.findFirst({
        where: { userId, kind },
        select: { id: true },
      });
      if (existing) return;
    } else if (options.reference) {
      // Same reference twice is the same event twice. Ignore the second.
      const existing = await client.trustSignal.findFirst({
        where: { userId, kind, reference: options.reference },
        select: { id: true },
      });
      if (existing) return;
    }

    await client.trustSignal.create({
      data: {
        userId,
        kind,
        weight: TRUST_WEIGHTS[kind],
        reference: options.reference ?? null,
        note: options.note ?? null,
      },
    });

    await recomputeTrustScore(userId, client);
  } catch (e) {
    logger.exception("failed to award trust signal", e, { userId, kind });
  }
}

export async function recomputeTrustScore(
  userId: string,
  client: DbClient = db,
): Promise<number> {
  const signals = await client.trustSignal.findMany({
    where: {
      userId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { kind: true, weight: true },
  });

  const score = scoreFromSignals(signals);

  await client.user.update({
    where: { id: userId },
    data: { trustScore: score, trustComputedAt: new Date() },
  });

  return score;
}

/** Pure, so it is unit-testable without a database. */
export function scoreFromSignals(signals: { kind: string; weight: number }[]): number {
  const totals = new Map<string, number>();

  for (const s of signals) {
    const running = totals.get(s.kind) ?? 0;
    const cap = CONTRIBUTION_CAP[s.kind as TrustSignalKind];

    if (s.weight > 0 && cap !== undefined) {
      totals.set(s.kind, Math.min(cap, running + s.weight));
    } else {
      // Penalties are never capped: repeated upheld reports should keep hurting.
      totals.set(s.kind, running + s.weight);
    }
  }

  let total = 0;
  for (const v of totals.values()) total += v;
  return clamp(Math.round(total), 0, 100);
}

export interface TrustBreakdown {
  score: number;
  tier: TrustTier;
  earned: { kind: string; label: string; points: number; count: number }[];
  lost: { kind: string; label: string; points: number; count: number }[];
  /** What this user could still do to raise the score. */
  available: { kind: string; label: string; points: number }[];
}

export async function getTrustBreakdown(userId: string): Promise<TrustBreakdown> {
  const signals = await db.trustSignal.findMany({
    where: { userId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    select: { kind: true, weight: true },
  });

  const grouped = new Map<string, { points: number; count: number }>();
  for (const s of signals) {
    const g = grouped.get(s.kind) ?? { points: 0, count: 0 };
    const cap = CONTRIBUTION_CAP[s.kind as TrustSignalKind];
    g.points = s.weight > 0 && cap !== undefined ? Math.min(cap, g.points + s.weight) : g.points + s.weight;
    g.count += 1;
    grouped.set(s.kind, g);
  }

  const earned: TrustBreakdown["earned"] = [];
  const lost: TrustBreakdown["lost"] = [];

  for (const [kind, g] of grouped) {
    const entry = {
      kind,
      label: TRUST_SIGNAL_LABEL[kind as TrustSignalKind] ?? kind,
      points: g.points,
      count: g.count,
    };
    (g.points >= 0 ? earned : lost).push(entry);
  }

  earned.sort((a, b) => b.points - a.points);
  lost.sort((a, b) => a.points - b.points);

  const available = ONE_TIME.filter((k) => !grouped.has(k) && k !== "ACCOUNT_AGE_90D").map((k) => ({
    kind: k,
    label: TRUST_SIGNAL_LABEL[k],
    points: TRUST_WEIGHTS[k],
  }));

  const score = scoreFromSignals(signals);
  return { score, tier: trustTier(score), earned, lost, available };
}

/**
 * Cheap public-facing summary. Deliberately does not expose the negative
 * signals: "this seller lost a dispute" is for the moderation console, not a
 * scarlet letter on a profile.
 */
export interface PublicTrust {
  score: number;
  tier: TrustTier;
  badges: string[];
}

export async function getPublicTrust(userId: string): Promise<PublicTrust> {
  const [user, signals] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { trustScore: true } }),
    db.trustSignal.findMany({
      where: {
        userId,
        kind: {
          in: ["EMAIL_VERIFIED", "PHONE_VERIFIED", "ID_VERIFIED", "BREEDER_VERIFIED", "CLINIC_VERIFIED", "ACCOUNT_AGE_90D"],
        },
      },
      select: { kind: true },
    }),
  ]);

  const score = user?.trustScore ?? 0;
  return {
    score,
    tier: trustTier(score),
    badges: [...new Set(signals.map((s) => TRUST_SIGNAL_LABEL[s.kind as TrustSignalKind] ?? s.kind))],
  };
}

/**
 * Awards the age signal to accounts that have crossed 90 days. Run daily by
 * the worker rather than computed on read, so the score is a stable stored
 * value that can be sorted and filtered on in SQL.
 */
export async function awardAccountAgeSignals(): Promise<number> {
  const cutoff = new Date(Date.now() - 90 * 86_400_000);

  const candidates = await db.user.findMany({
    where: { createdAt: { lt: cutoff }, deletedAt: null, status: "ACTIVE" },
    select: { id: true },
    take: 500,
  });

  let awarded = 0;
  for (const u of candidates) {
    const has = await db.trustSignal.findFirst({
      where: { userId: u.id, kind: "ACCOUNT_AGE_90D" },
      select: { id: true },
    });
    if (has) continue;
    await awardTrustSignal(u.id, "ACCOUNT_AGE_90D");
    awarded++;
  }
  return awarded;
}
