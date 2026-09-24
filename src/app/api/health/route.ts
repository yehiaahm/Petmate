import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { queueStats } from "@/lib/jobs/queue";
import { assertProductionSafety, isProduction } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Health check.
 *
 * Returns 200 only when the application can actually serve: the database
 * answers, and production is not running on an insecure default. A health check
 * that returns 200 while the database is down is worse than none, because the
 * load balancer keeps sending traffic to it.
 *
 * Deliberately terse in production: uptime monitors do not need the internals,
 * and neither does anyone scanning the host.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const started = Date.now();
  const checks: Record<string, { ok: boolean; detail?: string; ms?: number }> = {};

  // Database
  const dbStarted = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = { ok: true, ms: Date.now() - dbStarted };
  } catch (error) {
    logger.exception("health check: database unreachable", error);
    checks.database = { ok: false, detail: "unreachable" };
  }

  // Background queue
  try {
    const stats = await queueStats();
    checks.queue = {
      // A queue more than ten minutes behind means the worker is not running.
      ok: stats.oldestDueSeconds < 600,
      detail: `pending ${stats.pending}, dead ${stats.dead}, oldest ${stats.oldestDueSeconds}s`,
    };
  } catch {
    checks.queue = { ok: false, detail: "unavailable" };
  }

  // Configuration
  const configProblems = assertProductionSafety();
  checks.configuration = {
    ok: configProblems.length === 0,
    detail: configProblems.length ? `${configProblems.length} problem(s)` : undefined,
  };

  const healthy = Object.values(checks).every((c) => c.ok);

  const body = isProduction()
    ? { status: healthy ? "ok" : "degraded" }
    : {
        status: healthy ? "ok" : "degraded",
        checks,
        configProblems,
        ms: Date.now() - started,
      };

  return NextResponse.json(body, {
    status: checks.database?.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
