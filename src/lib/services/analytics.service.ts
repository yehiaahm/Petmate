import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { stringifyJson } from "@/lib/json";
import { addDays, startOfDayUTC } from "@/lib/utils";

/**
 * Analytics.
 *
 * Everything here is computed from the transaction tables. There is no seeded
 * number, no placeholder series, no "sample data" path. If a chart is empty it
 * is because nothing has happened yet, and that is the correct thing to show.
 *
 * First-party only: no third-party tracker ships with the product.
 */

export async function trackEvent(params: {
  name: string;
  userId?: string | null;
  anonId?: string | null;
  sessionId?: string | null;
  entityType?: string;
  entityId?: string;
  valueCents?: number;
  props?: Record<string, unknown>;
  path?: string;
  referrer?: string;
}): Promise<void> {
  try {
    await db.analyticsEvent.create({
      data: {
        name: params.name.slice(0, 80),
        userId: params.userId ?? null,
        anonId: params.anonId ?? null,
        sessionId: params.sessionId ?? null,
        entityType: params.entityType ?? null,
        entityId: params.entityId ?? null,
        valueCents: params.valueCents ?? null,
        props: params.props ? stringifyJson(params.props) : null,
        path: params.path?.slice(0, 300) ?? null,
        referrer: params.referrer?.slice(0, 300) ?? null,
      },
    });
  } catch (e) {
    // Analytics must never break a user action.
    logger.exception("analytics write failed", e, { name: params.name });
  }
}

export interface DateRange {
  from: Date;
  to: Date;
}

export function rangeFor(period: "7d" | "30d" | "90d" | "12m"): DateRange {
  const to = new Date();
  const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 365;
  return { from: addDays(to, -days), to };
}

// ---------------------------------------------------------------------------
// Platform overview
// ---------------------------------------------------------------------------

export interface PlatformMetrics {
  users: { total: number; new: number; active: number };
  listings: { active: number; new: number; completed: number };
  gmvCents: number;
  revenueCents: number;
  revenueByStream: { stream: string; cents: number }[];
  transactions: { count: number; averageValueCents: number };
  appointments: { booked: number; completed: number };
  orders: { count: number; gmvCents: number };
  conversion: { views: number; inquiries: number; purchases: number; rate: number };
  currency: string;
}

export async function getPlatformMetrics(range: DateRange): Promise<PlatformMetrics> {
  const [
    totalUsers,
    newUsers,
    activeUsers,
    activeListings,
    newListings,
    completedListings,
    petOrders,
    productOrders,
    appointmentsBooked,
    appointmentsCompleted,
    revenueRows,
    listingViews,
    inquiries,
  ] = await Promise.all([
    db.user.count({ where: { deletedAt: null } }),
    db.user.count({ where: { createdAt: { gte: range.from, lte: range.to }, deletedAt: null } }),
    db.user.count({ where: { lastSeenAt: { gte: range.from }, deletedAt: null } }),
    db.listing.count({ where: { status: "ACTIVE", deletedAt: null } }),
    db.listing.count({ where: { publishedAt: { gte: range.from, lte: range.to }, deletedAt: null } }),
    db.listing.count({ where: { completedAt: { gte: range.from, lte: range.to } } }),
    db.petOrder.aggregate({
      where: { status: "COMPLETED", createdAt: { gte: range.from, lte: range.to } },
      _sum: { amountCents: true, platformFeeCents: true },
      _count: true,
    }),
    db.order.aggregate({
      where: {
        status: { in: ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"] },
        placedAt: { gte: range.from, lte: range.to },
      },
      _sum: { totalCents: true, platformFeeCents: true },
      _count: true,
    }),
    db.appointment.count({ where: { createdAt: { gte: range.from, lte: range.to } } }),
    db.appointment.aggregate({
      where: { status: "COMPLETED", startAt: { gte: range.from, lte: range.to } },
      _sum: { commissionCents: true },
      _count: true,
    }),
    // Revenue comes from the ledger, which is the authoritative record.
    db.ledgerEntry.findMany({
      where: {
        createdAt: { gte: range.from, lte: range.to },
        amountCents: { gt: 0 },
        account: { ownerType: "PLATFORM", kind: "REVENUE" },
      },
      select: { amountCents: true, transaction: { select: { kind: true, referenceType: true } } },
    }),
    db.listingView.count({ where: { createdAt: { gte: range.from, lte: range.to } } }),
    db.conversation.count({
      where: { type: "LISTING", createdAt: { gte: range.from, lte: range.to } },
    }),
  ]);

  const subscriptionRevenue = revenueRows
    .filter((r) => r.transaction.kind === "SUBSCRIPTION")
    .reduce((a, r) => a + r.amountCents, 0);

  const petCommission = petOrders._sum.platformFeeCents ?? 0;
  const productCommission = productOrders._sum.platformFeeCents ?? 0;
  const vetCommission = appointmentsCompleted._sum.commissionCents ?? 0;

  const featuredRevenue = revenueRows
    .filter((r) => r.transaction.referenceType === "FEATURED_PLACEMENT")
    .reduce((a, r) => a + r.amountCents, 0);

  const adRevenue = revenueRows
    .filter((r) => r.transaction.referenceType === "AD_CAMPAIGN")
    .reduce((a, r) => a + r.amountCents, 0);

  const gmvCents = (petOrders._sum.amountCents ?? 0) + (productOrders._sum.totalCents ?? 0);
  const transactionCount = petOrders._count + productOrders._count;

  const revenueByStream = [
    { stream: "Pet sales", cents: petCommission },
    { stream: "Products", cents: productCommission },
    { stream: "Veterinary", cents: vetCommission },
    { stream: "Subscriptions", cents: subscriptionRevenue },
    { stream: "Featured listings", cents: featuredRevenue },
    { stream: "Advertising", cents: adRevenue },
  ].filter((s) => s.cents > 0);

  const revenueCents = revenueByStream.reduce((a, s) => a + s.cents, 0);

  return {
    users: { total: totalUsers, new: newUsers, active: activeUsers },
    listings: { active: activeListings, new: newListings, completed: completedListings },
    gmvCents,
    revenueCents,
    revenueByStream,
    transactions: {
      count: transactionCount,
      averageValueCents: transactionCount ? Math.round(gmvCents / transactionCount) : 0,
    },
    appointments: { booked: appointmentsBooked, completed: appointmentsCompleted._count },
    orders: { count: productOrders._count, gmvCents: productOrders._sum.totalCents ?? 0 },
    conversion: {
      views: listingViews,
      inquiries,
      purchases: petOrders._count,
      rate: listingViews ? Math.round((petOrders._count / listingViews) * 10000) / 100 : 0,
    },
    currency: "USD",
  };
}

/** Daily series for the admin charts. Zero-filled so gaps read as zero. */
export async function getDailySeries(
  range: DateRange,
): Promise<{ date: string; users: number; listings: number; gmvCents: number; orders: number }[]> {
  const [users, listings, petOrders, orders] = await Promise.all([
    db.user.findMany({
      where: { createdAt: { gte: range.from, lte: range.to } },
      select: { createdAt: true },
    }),
    db.listing.findMany({
      where: { publishedAt: { gte: range.from, lte: range.to } },
      select: { publishedAt: true },
    }),
    db.petOrder.findMany({
      where: { status: "COMPLETED", createdAt: { gte: range.from, lte: range.to } },
      select: { createdAt: true, amountCents: true },
    }),
    db.order.findMany({
      where: {
        status: { in: ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"] },
        placedAt: { gte: range.from, lte: range.to },
      },
      select: { placedAt: true, totalCents: true },
    }),
  ]);

  const buckets = new Map<string, { users: number; listings: number; gmvCents: number; orders: number }>();

  const dayCount = Math.ceil((range.to.getTime() - range.from.getTime()) / 86_400_000);
  for (let i = 0; i <= dayCount; i++) {
    const key = startOfDayUTC(addDays(range.from, i)).toISOString().slice(0, 10);
    buckets.set(key, { users: 0, listings: 0, gmvCents: 0, orders: 0 });
  }

  const bump = (date: Date | null, field: "users" | "listings" | "orders", value = 1) => {
    if (!date) return;
    const key = date.toISOString().slice(0, 10);
    const bucket = buckets.get(key);
    if (bucket) bucket[field] += value;
  };

  for (const u of users) bump(u.createdAt, "users");
  for (const l of listings) bump(l.publishedAt, "listings");
  for (const o of petOrders) {
    const key = o.createdAt.toISOString().slice(0, 10);
    const bucket = buckets.get(key);
    if (bucket) bucket.gmvCents += o.amountCents;
  }
  for (const o of orders) {
    bump(o.placedAt, "orders");
    if (o.placedAt) {
      const key = o.placedAt.toISOString().slice(0, 10);
      const bucket = buckets.get(key);
      if (bucket) bucket.gmvCents += o.totalCents;
    }
  }

  return [...buckets.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Business intelligence
// ---------------------------------------------------------------------------

export async function getBusinessInsights(range: DateRange) {
  const [speciesDemand, breedDemand, locations, topSellers, topClinics, planPerformance, funnel] =
    await Promise.all([
      db.pet.groupBy({
        by: ["species"],
        where: { listings: { some: { publishedAt: { gte: range.from } } } },
        _count: true,
        orderBy: { _count: { species: "desc" } },
      }),
      db.listing.findMany({
        where: { publishedAt: { gte: range.from }, deletedAt: null },
        select: { viewCount: true, favoriteCount: true, pet: { select: { breed: { select: { id: true, name: true, species: true } } } } },
      }),
      db.listing.groupBy({
        by: ["city", "country"],
        where: { status: "ACTIVE", city: { not: null }, deletedAt: null },
        _count: true,
        orderBy: { _count: { city: "desc" } },
        take: 10,
      }),
      db.user.findMany({
        where: { completedSales: { gt: 0 } },
        orderBy: { completedSales: "desc" },
        take: 10,
        select: {
          id: true,
          name: true,
          handle: true,
          avatarUrl: true,
          completedSales: true,
          ratingAvgBps: true,
          ratingCount: true,
          trustScore: true,
        },
      }),
      db.clinic.findMany({
        where: { status: "ACTIVE", bookingCount: { gt: 0 } },
        orderBy: { bookingCount: "desc" },
        take: 10,
        select: { id: true, name: true, slug: true, city: true, bookingCount: true, ratingAvgBps: true, ratingCount: true },
      }),
      db.subscription.groupBy({
        by: ["planId"],
        where: { status: { in: ["ACTIVE", "TRIALING"] } },
        _count: true,
      }),
      getFunnel(range),
    ]);

  // Demand per breed: views and saves are the signal, not listing count.
  const breedMap = new Map<string, { name: string; species: string; views: number; saves: number; listings: number }>();
  for (const listing of breedDemand) {
    const breed = listing.pet.breed;
    if (!breed) continue;
    const entry = breedMap.get(breed.id) ?? {
      name: breed.name,
      species: breed.species,
      views: 0,
      saves: 0,
      listings: 0,
    };
    entry.views += listing.viewCount;
    entry.saves += listing.favoriteCount;
    entry.listings += 1;
    breedMap.set(breed.id, entry);
  }

  const plans = await db.plan.findMany({
    where: { id: { in: planPerformance.map((p) => p.planId) } },
    select: { id: true, name: true, code: true, priceMonthlyCents: true },
  });

  return {
    speciesDemand: speciesDemand.map((s) => ({ species: s.species, listings: s._count })),
    breedDemand: [...breedMap.entries()]
      .map(([id, v]) => ({ id, ...v, demandPerListing: v.listings ? Math.round(v.views / v.listings) : 0 }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 12),
    locations: locations.map((l) => ({
      city: l.city as string,
      country: l.country,
      listings: l._count,
    })),
    topSellers,
    topClinics,
    planPerformance: planPerformance.map((p) => {
      const plan = plans.find((pl) => pl.id === p.planId);
      return {
        planId: p.planId,
        name: plan?.name ?? "Unknown",
        code: plan?.code ?? "",
        subscribers: p._count,
        mrrCents: (plan?.priceMonthlyCents ?? 0) * p._count,
      };
    }),
    funnel,
  };
}

/** Where people drop out, measured from real rows rather than assumed. */
async function getFunnel(range: DateRange) {
  const [views, inquiries, orders, completed] = await Promise.all([
    db.listingView.count({ where: { createdAt: { gte: range.from } } }),
    db.conversation.count({ where: { type: "LISTING", createdAt: { gte: range.from } } }),
    db.petOrder.count({ where: { createdAt: { gte: range.from } } }),
    db.petOrder.count({ where: { status: "COMPLETED", createdAt: { gte: range.from } } }),
  ]);

  const steps = [
    { step: "Viewed a listing", count: views },
    { step: "Contacted the seller", count: inquiries },
    { step: "Started a purchase", count: orders },
    { step: "Completed the purchase", count: completed },
  ];

  return steps.map((s, i) => ({
    ...s,
    conversionFromPrevious:
      i === 0 || !steps[i - 1]!.count ? 100 : Math.round((s.count / steps[i - 1]!.count) * 1000) / 10,
    conversionFromStart: views ? Math.round((s.count / views) * 1000) / 10 : 0,
  }));
}

// ---------------------------------------------------------------------------
// Seller-facing analytics
// ---------------------------------------------------------------------------

export async function getSellerAnalytics(userId: string, range: DateRange) {
  const [listings, views, favorites, conversations, sales, shops] = await Promise.all([
    db.listing.findMany({
      where: { sellerId: userId, deletedAt: null },
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        viewCount: true,
        favoriteCount: true,
        inquiryCount: true,
        priceCents: true,
        currency: true,
        publishedAt: true,
      },
      orderBy: { viewCount: "desc" },
      take: 20,
    }),
    db.listingView.count({
      where: { listing: { sellerId: userId }, createdAt: { gte: range.from } },
    }),
    db.favorite.count({
      where: { listing: { sellerId: userId }, createdAt: { gte: range.from } },
    }),
    db.conversation.count({
      where: { listing: { sellerId: userId }, createdAt: { gte: range.from } },
    }),
    db.petOrder.aggregate({
      where: { sellerId: userId, status: "COMPLETED", createdAt: { gte: range.from } },
      _sum: { sellerPayoutCents: true },
      _count: true,
    }),
    db.shop.findMany({ where: { ownerUserId: userId, deletedAt: null }, select: { id: true } }),
  ]);

  const shopIds = shops.map((s) => s.id);
  const productSales = shopIds.length
    ? await db.orderItem.aggregate({
        where: {
          shopId: { in: shopIds },
          order: { status: { in: ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"] }, placedAt: { gte: range.from } },
        },
        _sum: { sellerEarningsCents: true, quantity: true },
        _count: true,
      })
    : null;

  return {
    totals: {
      views,
      favorites,
      conversations,
      sales: sales._count,
      earningsCents: (sales._sum.sellerPayoutCents ?? 0) + (productSales?._sum.sellerEarningsCents ?? 0),
      productsSold: productSales?._sum.quantity ?? 0,
    },
    listings: listings.map((l) => ({
      ...l,
      conversionRate: l.viewCount ? Math.round((l.inquiryCount / l.viewCount) * 1000) / 10 : 0,
    })),
    viewToInquiry: views ? Math.round((conversations / views) * 1000) / 10 : 0,
  };
}

export async function getClinicAnalytics(clinicId: string, range: DateRange) {
  const [appointments, revenue, byService, ratings] = await Promise.all([
    db.appointment.groupBy({
      by: ["status"],
      where: { clinicId, createdAt: { gte: range.from } },
      _count: true,
    }),
    db.appointment.aggregate({
      where: { clinicId, status: "COMPLETED", startAt: { gte: range.from } },
      _sum: { priceCents: true, commissionCents: true },
      _count: true,
    }),
    db.appointment.findMany({
      where: { clinicId, status: "COMPLETED", startAt: { gte: range.from } },
      select: { priceCents: true, service: { select: { id: true, name: true, category: true } } },
    }),
    db.review.aggregate({
      where: { targetType: "CLINIC", targetId: clinicId, status: "PUBLISHED" },
      _avg: { rating: true },
      _count: true,
    }),
  ]);

  const serviceMap = new Map<string, { name: string; category: string; count: number; revenueCents: number }>();
  for (const a of byService) {
    const entry = serviceMap.get(a.service.id) ?? {
      name: a.service.name,
      category: a.service.category,
      count: 0,
      revenueCents: 0,
    };
    entry.count += 1;
    entry.revenueCents += a.priceCents;
    serviceMap.set(a.service.id, entry);
  }

  const totalBooked = appointments.reduce((a, s) => a + s._count, 0);
  const noShows = appointments.find((s) => s.status === "NO_SHOW")?._count ?? 0;
  const cancelled = appointments.find((s) => s.status === "CANCELLED")?._count ?? 0;

  return {
    appointments: {
      total: totalBooked,
      completed: revenue._count,
      cancelled,
      noShows,
      noShowRate: totalBooked ? Math.round((noShows / totalBooked) * 1000) / 10 : 0,
    },
    revenue: {
      grossCents: revenue._sum.priceCents ?? 0,
      commissionCents: revenue._sum.commissionCents ?? 0,
      netCents: (revenue._sum.priceCents ?? 0) - (revenue._sum.commissionCents ?? 0),
    },
    services: [...serviceMap.values()].sort((a, b) => b.revenueCents - a.revenueCents),
    rating: { average: ratings._avg.rating ?? 0, count: ratings._count },
  };
}

/** Prunes raw event rows. Run by `analytics.rollup`. */
export async function pruneAnalytics(retentionDays = 180): Promise<number> {
  const { count } = await db.analyticsEvent.deleteMany({
    where: { createdAt: { lt: addDays(new Date(), -retentionDays) } },
  });
  return count;
}
