import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  claimJobs,
  completeJob,
  failJob,
  scheduleRecurringJobs,
  queueStats,
} from "@/lib/jobs/queue";
import { runJob } from "@/lib/jobs/handlers";

/**
 * Cron-driven queue drain.
 *
 * For deployments that cannot run a long-lived worker process (most serverless
 * platforms). Point a scheduler at this every minute and it drains the same
 * queue with the same handlers as `npm run worker`.
 *
 * Authenticated with a shared secret compared in constant time. Without
 * `CRON_SECRET` configured the endpoint is disabled rather than open.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_JOBS_PER_TICK = 25;

function authorized(request: Request): boolean {
  const secret = env().CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : header;
  if (!provided) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    // Same answer whether the secret is wrong or not configured.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const started = Date.now();
  const workerId = `cron-${Date.now()}`;

  try {
    await scheduleRecurringJobs();

    const jobs = await claimJobs(workerId, MAX_JOBS_PER_TICK);
    const results: { type: string; ok: boolean }[] = [];

    for (const job of jobs) {
      // Leave time to return a response rather than being killed mid-job.
      if (Date.now() - started > 45_000) break;

      try {
        await runJob(job);
        await completeJob(job.id);
        results.push({ type: job.type, ok: true });
      } catch (error) {
        await failJob(job, error);
        results.push({ type: job.type, ok: false });
      }
    }

    const stats = await queueStats();

    return NextResponse.json({
      processed: results.length,
      failed: results.filter((r) => !r.ok).length,
      remaining: stats.pending,
      ms: Date.now() - started,
    });
  } catch (error) {
    logger.exception("cron tick failed", error);
    return NextResponse.json({ error: "Tick failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
