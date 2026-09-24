/**
 * Background worker.
 *
 * Run alongside the web process: `npm run worker`. It claims due jobs, runs
 * them, and re-schedules the recurring ones. Several workers can run at once —
 * claiming is a conditional update, so two never take the same job.
 *
 * Deployments that cannot run a long-lived process (most serverless platforms)
 * should instead hit `POST /api/cron/tick` on a schedule; it drains the same
 * queue with the same handlers. See docs/DEPLOYMENT.md.
 */
import { config } from "dotenv";
config();

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  claimJobs,
  completeJob,
  failJob,
  newWorkerId,
  scheduleRecurringJobs,
  queueStats,
} from "@/lib/jobs/queue";
import { runJob } from "@/lib/jobs/handlers";

const POLL_INTERVAL_MS = 2000;
const BATCH_SIZE = 10;

const workerId = newWorkerId();
let running = true;
let inFlight = 0;

async function tick(): Promise<number> {
  const jobs = await claimJobs(workerId, BATCH_SIZE);
  if (!jobs.length) return 0;

  await Promise.all(
    jobs.map(async (job) => {
      inFlight++;
      const started = Date.now();
      try {
        const result = await runJob(job);
        await completeJob(job.id);
        logger.info("job completed", {
          type: job.type,
          jobId: job.id,
          ms: Date.now() - started,
          result: result ?? undefined,
        });
      } catch (error) {
        await failJob(job, error);
      } finally {
        inFlight--;
      }
    }),
  );

  return jobs.length;
}

async function main() {
  logger.info("worker starting", { workerId });

  await scheduleRecurringJobs();

  let lastSchedule = Date.now();
  let idleTicks = 0;

  while (running) {
    try {
      const processed = await tick();

      // Re-seed the recurring schedule every minute. Unique keys make this a
      // no-op when the jobs already exist, so it is safe to call often and it
      // means the schedule repairs itself after any outage.
      if (Date.now() - lastSchedule > 60_000) {
        await scheduleRecurringJobs();
        lastSchedule = Date.now();

        const stats = await queueStats();
        if (stats.dead > 0 || stats.oldestDueSeconds > 300) {
          logger.warn("queue is falling behind", stats);
        }
      }

      // Back off when idle so an empty queue does not hammer the database.
      idleTicks = processed > 0 ? 0 : Math.min(idleTicks + 1, 10);
      const delay = processed > 0 ? 50 : POLL_INTERVAL_MS * Math.min(5, 1 + idleTicks / 3);
      await new Promise((resolve) => setTimeout(resolve, delay));
    } catch (error) {
      logger.exception("worker loop error", error);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

async function shutdown(signal: string) {
  if (!running) return;
  running = false;
  logger.info("worker shutting down", { signal, inFlight });

  // Give in-flight jobs a chance to finish so they are not retried needlessly.
  const deadline = Date.now() + 15_000;
  while (inFlight > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  await db.$disconnect().catch(() => {});
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  logger.exception("unhandled rejection in worker", reason);
});

main().catch((error) => {
  logger.exception("worker crashed", error);
  process.exit(1);
});
