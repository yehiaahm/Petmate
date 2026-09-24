import "server-only";
import { db, type DbClient } from "@/lib/db";
import { logger } from "@/lib/logger";
import { stringifyJson, parseJsonRecord } from "@/lib/json";
import { uuid } from "@/lib/utils";

/**
 * Durable job queue, backed by the database.
 *
 * Why not a dedicated queue: the jobs here (send a reminder, release escrow,
 * clear a payout) must be transactional with the business writes that schedule
 * them. A row in the same database gives that for free. Redis would mean a job
 * can be enqueued for a transaction that then rolls back.
 *
 * Workers claim with a conditional update, so several can run safely. Failures
 * retry with exponential backoff and land in DEAD after `maxAttempts`.
 */

export type JobType =
  | "email.process"
  | "appointment.remind"
  | "appointment.complete"
  | "escrow.autoRelease"
  | "breeding.releaseFee"
  | "ads.settle"
  | "messages.process"
  | "referrals.qualify"
  | "delivery.book"
  | "delivery.sync"
  | "payouts.release"
  | "clinic.releaseHold"
  | "subscription.expire"
  | "listing.expire"
  | "health.reminders"
  | "breeding.refreshMatches"
  | "savedSearch.run"
  | "trust.accountAge"
  | "prune.rateLimits"
  | "prune.auth"
  | "analytics.rollup";

export interface EnqueueInput {
  type: JobType;
  payload?: Record<string, unknown>;
  runAt?: Date;
  maxAttempts?: number;
  /** Prevents duplicates. A second enqueue with the same key is a no-op. */
  uniqueKey?: string;
}

export async function enqueueJob(input: EnqueueInput, client: DbClient = db): Promise<void> {
  const data = {
    type: input.type,
    payload: stringifyJson(input.payload ?? {}),
    runAt: input.runAt ?? new Date(),
    maxAttempts: input.maxAttempts ?? 5,
    uniqueKey: input.uniqueKey ?? null,
  };

  if (!input.uniqueKey) {
    await client.job.create({ data });
    return;
  }

  try {
    await client.job.create({ data });
  } catch (e) {
    // Unique violation means the job is already scheduled. That is the point.
    const code = (e as { code?: string }).code;
    if (code !== "P2002") throw e;
  }
}

export interface ClaimedJob {
  id: string;
  type: JobType;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

/**
 * Claims up to `limit` due jobs for this worker.
 *
 * Claiming is a two-step read-then-conditional-update rather than a
 * `SELECT ... FOR UPDATE SKIP LOCKED`, because SQLite has no such clause. The
 * conditional update is what makes it safe: two workers that read the same row
 * race on `updateMany where lockedBy is null`, and exactly one wins.
 */
export async function claimJobs(workerId: string, limit = 10): Promise<ClaimedJob[]> {
  const now = new Date();
  // A job locked for over 5 minutes is assumed to belong to a dead worker.
  const staleBefore = new Date(now.getTime() - 5 * 60_000);

  const candidates = await db.job.findMany({
    where: {
      status: { in: ["PENDING", "RUNNING"] },
      runAt: { lte: now },
      OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }],
    },
    orderBy: { runAt: "asc" },
    take: limit * 2,
    select: { id: true, type: true, payload: true, attempts: true, maxAttempts: true, lockedAt: true },
  });

  const claimed: ClaimedJob[] = [];

  for (const job of candidates) {
    if (claimed.length >= limit) break;

    const result = await db.job.updateMany({
      where: {
        id: job.id,
        status: { in: ["PENDING", "RUNNING"] },
        OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }],
      },
      data: { status: "RUNNING", lockedAt: now, lockedBy: workerId, attempts: { increment: 1 } },
    });

    if (result.count === 1) {
      claimed.push({
        id: job.id,
        type: job.type as JobType,
        payload: parseJsonRecord(job.payload),
        attempts: job.attempts + 1,
        maxAttempts: job.maxAttempts,
      });
    }
  }

  return claimed;
}

export async function completeJob(jobId: string): Promise<void> {
  await db.job.update({
    where: { id: jobId },
    data: { status: "COMPLETED", completedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null },
  });
}

export async function failJob(job: ClaimedJob, error: unknown): Promise<void> {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const dead = job.attempts >= job.maxAttempts;

  // Exponential backoff with a ceiling: 30s, 2m, 8m, 32m, capped at 1h.
  const delaySeconds = Math.min(3600, 30 * 4 ** (job.attempts - 1));

  await db.job.update({
    where: { id: job.id },
    data: {
      status: dead ? "DEAD" : "PENDING",
      lastError: message.slice(0, 1000),
      lockedAt: null,
      lockedBy: null,
      runAt: dead ? undefined : new Date(Date.now() + delaySeconds * 1000),
    },
  });

  logger.error(dead ? "job died" : "job failed, will retry", {
    jobId: job.id,
    type: job.type,
    attempts: job.attempts,
    retryInSeconds: dead ? null : delaySeconds,
    error: message,
  });
}

/** Recurring jobs, re-enqueued after each run so the schedule self-heals. */
export const RECURRING_JOBS: { type: JobType; intervalSeconds: number }[] = [
  { type: "email.process", intervalSeconds: 30 },
  { type: "messages.process", intervalSeconds: 30 },
  { type: "referrals.qualify", intervalSeconds: 3600 },
  { type: "delivery.sync", intervalSeconds: 3600 },
  { type: "health.reminders", intervalSeconds: 3600 },
  { type: "listing.expire", intervalSeconds: 3600 },
  { type: "savedSearch.run", intervalSeconds: 21600 },
  { type: "breeding.refreshMatches", intervalSeconds: 21600 },
  { type: "trust.accountAge", intervalSeconds: 86400 },
  { type: "prune.rateLimits", intervalSeconds: 3600 },
  { type: "prune.auth", intervalSeconds: 86400 },
  { type: "analytics.rollup", intervalSeconds: 3600 },
  { type: "ads.settle", intervalSeconds: 900 },
];

export async function scheduleRecurringJobs(): Promise<void> {
  for (const job of RECURRING_JOBS) {
    await enqueueJob({
      type: job.type,
      runAt: new Date(),
      uniqueKey: `recurring:${job.type}:${Math.floor(Date.now() / (job.intervalSeconds * 1000))}`,
    });
  }
}

export function nextRecurringRun(type: JobType): Date | null {
  const config = RECURRING_JOBS.find((j) => j.type === type);
  if (!config) return null;
  return new Date(Date.now() + config.intervalSeconds * 1000);
}

export function newWorkerId(): string {
  return `worker-${process.pid}-${uuid().slice(0, 8)}`;
}

/** Health snapshot for the admin console and /api/health. */
export async function queueStats() {
  const [pending, running, dead, oldest] = await Promise.all([
    db.job.count({ where: { status: "PENDING" } }),
    db.job.count({ where: { status: "RUNNING" } }),
    db.job.count({ where: { status: "DEAD" } }),
    db.job.findFirst({
      where: { status: "PENDING", runAt: { lte: new Date() } },
      orderBy: { runAt: "asc" },
      select: { runAt: true },
    }),
  ]);

  return {
    pending,
    running,
    dead,
    oldestDueSeconds: oldest ? Math.round((Date.now() - oldest.runAt.getTime()) / 1000) : 0,
  };
}
