import "server-only";
import { db } from "@/lib/db";
import { getDailySeries, getPlatformMetrics, type DateRange } from "@/lib/services/analytics.service";

/**
 * The numbers behind the console's overview and its sidebar badges.
 *
 * Every figure is a live query. Counts that touch tables a module may not
 * have migrated yet are wrapped so a missing table reads as "no data" instead
 * of taking the overview down.
 */

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export const PERIODS = {
  "7d": { days: 7, label: "Last 7 days" },
  "30d": { days: 30, label: "Last 30 days" },
  "90d": { days: 90, label: "Last 90 days" },
  "12m": { days: 365, label: "Last 12 months" },
} as const;
export type Period = keyof typeof PERIODS;

export function parsePeriod(value: string | undefined): Period {
  return value && value in PERIODS ? (value as Period) : "30d";
}

/**
 * Everything waiting on a human. Shared by the sidebar badges and the
 * overview, so the two can never disagree.
 */
export async function getQueueCounts() {
  const [reports, listings, verifications, disputes, tickets, payouts, risks, failedJobs, failedEmails] =
    await Promise.all([
      safe(() => db.report.count({ where: { status: { in: ["OPEN", "IN_REVIEW"] } } }), 0),
      safe(() => db.listing.count({ where: { status: "PENDING_REVIEW", deletedAt: null } }), 0),
      safe(() => db.verification.count({ where: { status: { in: ["PENDING", "IN_REVIEW"] } } }), 0),
      safe(() => db.dispute.count({ where: { status: { in: ["OPEN", "AWAITING_RESPONSE", "IN_REVIEW"] } } }), 0),
      safe(() => db.supportTicket.count({ where: { status: { in: ["OPEN", "AWAITING_USER"] } } }), 0),
      safe(() => db.payout.count({ where: { status: { in: ["REQUESTED", "APPROVED"] } } }), 0),
      safe(() => db.riskEvent.count({ where: { handled: false, score: { gte: 40 } } }), 0),
      safe(() => db.job.count({ where: { status: { in: ["FAILED", "DEAD"] } } }), 0),
      safe(() => db.emailMessage.count({ where: { status: "FAILED" } }), 0),
    ]);

  return {
    reports,
    listings,
    verifications,
    disputes,
    tickets,
    payouts,
    risks,
    failedJobs,
    failedEmails,
    moderation: reports + listings + verifications + disputes + risks,
  };
}
export type QueueCounts = Awaited<ReturnType<typeof getQueueCounts>>;

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

/** Current period against the one immediately before it, same length. */
export async function getOverview(period: Period) {
  const days = PERIODS[period].days;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const prev: DateRange = { from: new Date(from.getTime() - days * 86_400_000), to: from };

  const [current, previous, series] = await Promise.all([
    getPlatformMetrics({ from, to }),
    getPlatformMetrics(prev),
    getDailySeries({ from, to }),
  ]);

  // A year of daily points is noise on a 600px chart; fold it into weeks.
  const points = days > 120 ? foldWeekly(series) : series;

  return {
    period,
    label: PERIODS[period].label,
    from: from.toISOString(),
    to: to.toISOString(),
    metrics: current,
    deltas: {
      newUsers: pctChange(current.users.new, previous.users.new),
      activeUsers: pctChange(current.users.active, previous.users.active),
      newListings: pctChange(current.listings.new, previous.listings.new),
      gmv: pctChange(current.gmvCents, previous.gmvCents),
      revenue: pctChange(current.revenueCents, previous.revenueCents),
      transactions: pctChange(current.transactions.count, previous.transactions.count),
      orders: pctChange(current.orders.count, previous.orders.count),
      appointments: pctChange(current.appointments.booked, previous.appointments.booked),
    },
    series: points,
  };
}

function foldWeekly<T extends { date: string; users: number; listings: number; gmvCents: number; orders: number }>(
  series: T[],
) {
  const out: { date: string; users: number; listings: number; gmvCents: number; orders: number }[] = [];
  for (let i = 0; i < series.length; i += 7) {
    const week = series.slice(i, i + 7);
    out.push({
      date: week[0]!.date,
      users: week.reduce((a, d) => a + d.users, 0),
      listings: week.reduce((a, d) => a + d.listings, 0),
      gmvCents: week.reduce((a, d) => a + d.gmvCents, 0),
      orders: week.reduce((a, d) => a + d.orders, 0),
    });
  }
  return out;
}

/** How big the platform is, all time. */
export async function getComposition() {
  const [pets, listings, shops, products, clinics, careProviders, subscriptions, staff] = await Promise.all([
    safe(() => db.pet.count({ where: { deletedAt: null } }), 0),
    safe(() => db.listing.count({ where: { deletedAt: null } }), 0),
    safe(() => db.shop.count({ where: { deletedAt: null, status: "ACTIVE" } }), 0),
    safe(() => db.product.count({ where: { deletedAt: null, status: "ACTIVE" } }), 0),
    safe(() => db.clinic.count({ where: { deletedAt: null, status: "ACTIVE" } }), 0),
    safe(() => db.careProvider.count({ where: { deletedAt: null, status: "ACTIVE" } }), 0),
    safe(() => db.subscription.count({ where: { status: { in: ["ACTIVE", "TRIALING"] } } }), 0),
    safe(
      () =>
        db.user.count({
          where: { deletedAt: null, roles: { some: { role: { in: ["MODERATOR", "ADMIN", "SUPER_ADMIN"] } } } },
        }),
      0,
    ),
  ]);

  const [listingStatus, userStatus] = await Promise.all([
    safe(
      () =>
        db.listing.groupBy({
          by: ["status"],
          where: { deletedAt: null },
          _count: { _all: true },
        }),
      [] as { status: string; _count: { _all: number } }[],
    ),
    safe(
      () =>
        db.user.groupBy({
          by: ["status"],
          where: { deletedAt: null },
          _count: { _all: true },
        }),
      [] as { status: string; _count: { _all: number } }[],
    ),
  ]);

  return {
    pets,
    listings,
    shops,
    products,
    clinics,
    careProviders,
    subscriptions,
    staff,
    listingStatus: listingStatus
      .map((r) => ({ status: r.status, count: r._count._all }))
      .sort((a, b) => b.count - a.count),
    userStatus: userStatus
      .map((r) => ({ status: r.status, count: r._count._all }))
      .sort((a, b) => b.count - a.count),
  };
}

/** Background machinery: is the worker keeping up, is mail going out. */
export async function getSystemHealth() {
  const [jobs, emails, oldestPending, sessions, recentLoginFailures] = await Promise.all([
    safe(
      () => db.job.groupBy({ by: ["status"], _count: { _all: true } }),
      [] as { status: string; _count: { _all: number } }[],
    ),
    safe(
      () => db.emailMessage.groupBy({ by: ["status"], _count: { _all: true } }),
      [] as { status: string; _count: { _all: number } }[],
    ),
    safe(
      () =>
        db.job.findFirst({
          where: { status: "PENDING", runAt: { lte: new Date() } },
          orderBy: { runAt: "asc" },
          select: { runAt: true, type: true },
        }),
      null,
    ),
    safe(() => db.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }), 0),
    safe(
      () =>
        db.loginAttempt.count({
          where: { success: false, createdAt: { gte: new Date(Date.now() - 86_400_000) } },
        }),
      0,
    ),
  ]);

  const byStatus = (rows: { status: string; _count: { _all: number } }[]) =>
    Object.fromEntries(rows.map((r) => [r.status, r._count._all])) as Record<string, number>;

  return {
    jobs: byStatus(jobs),
    emails: byStatus(emails),
    oldestPendingJob: oldestPending
      ? { type: oldestPending.type, runAt: oldestPending.runAt.toISOString() }
      : null,
    liveSessions: sessions,
    failedLogins24h: recentLoginFailures,
  };
}

export async function getRecentActivity(take = 12) {
  const rows = await safe(
    () =>
      db.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take,
        select: {
          id: true,
          action: true,
          summary: true,
          entityType: true,
          entityId: true,
          createdAt: true,
          actor: { select: { id: true, name: true, avatarUrl: true } },
        },
      }),
    [],
  );
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export async function getTopSellers(range: DateRange, take = 6) {
  const rows = await safe(
    () =>
      db.petOrder.groupBy({
        by: ["sellerId"],
        where: { status: "COMPLETED", createdAt: { gte: range.from, lte: range.to } },
        _sum: { amountCents: true },
        _count: { _all: true },
        orderBy: { _sum: { amountCents: "desc" } },
        take,
      }),
    [] as { sellerId: string; _sum: { amountCents: number | null }; _count: { _all: number } }[],
  );
  const users = await db.user.findMany({
    where: { id: { in: rows.map((r) => r.sellerId) } },
    select: { id: true, name: true, handle: true, avatarUrl: true, trustScore: true },
  });
  return rows.map((r) => ({
    user: users.find((u) => u.id === r.sellerId) ?? null,
    sellerId: r.sellerId,
    gmvCents: r._sum.amountCents ?? 0,
    sales: r._count._all,
  }));
}
