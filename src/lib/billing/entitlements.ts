import "server-only";
import { db } from "@/lib/db";
import { parseJsonRecord } from "@/lib/json";
import { getSettings } from "@/lib/settings";
import { upgradeRequired } from "@/lib/errors";

/**
 * Entitlements.
 *
 * Premium exists to sell capacity and leverage, not to hold basic function
 * hostage. Everything needed to complete a transaction — messaging, buying,
 * booking a vet, keeping a health record — is free forever, because a
 * marketplace that taxes its own liquidity does not grow.
 *
 * What paid tiers buy: more simultaneous listings, more outbound breeding
 * requests, alerts on saved searches, analytics, and visibility.
 */

export interface Entitlements {
  planCode: string;
  planName: string;
  activeListings: number;
  breedingRequestsPerMonth: number;
  savedSearchAlerts: number;
  /** Multiplier applied to the listing's ranking score. */
  visibilityBoost: number;
  analytics: boolean;
  verifiedBadgeEligible: boolean;
  prioritySupport: boolean;
  bulkTools: boolean;
  advancedMatching: boolean;
  /** Reduction on the platform commission, in basis points. */
  commissionDiscountBps: number;
}

const UNLIMITED = 100_000;

export async function getEntitlements(userId: string): Promise<Entitlements> {
  const settings = await getSettings();

  const subscription = await db.subscription.findFirst({
    where: {
      userId,
      status: { in: ["ACTIVE", "TRIALING"] },
      currentPeriodEnd: { gt: new Date() },
    },
    orderBy: { currentPeriodEnd: "desc" },
    select: {
      plan: { select: { code: true, name: true, limits: true } },
    },
  });

  if (!subscription) {
    return {
      planCode: "free",
      planName: "Free",
      activeListings: settings.freeActiveListingLimit,
      breedingRequestsPerMonth: settings.freeBreedingRequestLimit,
      savedSearchAlerts: settings.freeSavedSearchLimit,
      visibilityBoost: 1,
      analytics: false,
      verifiedBadgeEligible: true,
      prioritySupport: false,
      bulkTools: false,
      advancedMatching: false,
      commissionDiscountBps: 0,
    };
  }

  const limits = parseJsonRecord(subscription.plan.limits);
  const num = (key: string, fallback: number) => {
    const v = limits[key];
    if (v === "unlimited") return UNLIMITED;
    return typeof v === "number" ? v : fallback;
  };
  const bool = (key: string, fallback: boolean) =>
    typeof limits[key] === "boolean" ? (limits[key] as boolean) : fallback;

  return {
    planCode: subscription.plan.code,
    planName: subscription.plan.name,
    activeListings: num("activeListings", settings.freeActiveListingLimit),
    breedingRequestsPerMonth: num("breedingRequestsPerMonth", settings.freeBreedingRequestLimit),
    savedSearchAlerts: num("savedSearchAlerts", settings.freeSavedSearchLimit),
    visibilityBoost: clampVisibilityBoost(num("visibilityBoost", 1)),
    analytics: bool("analytics", false),
    verifiedBadgeEligible: true,
    prioritySupport: bool("prioritySupport", false),
    bulkTools: bool("bulkTools", false),
    advancedMatching: bool("advancedMatching", false),
    commissionDiscountBps: num("commissionDiscountBps", 0),
  };
}

/**
 * Ceiling on the ranking multiplier a plan can buy. A plan row with a typo'd
 * boost of 14 instead of 1.4 must not let a subscriber bury every organic
 * result, so the value is clamped here rather than trusted from the database.
 */
export const MAX_VISIBILITY_BOOST = 1.5;

export function clampVisibilityBoost(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.min(MAX_VISIBILITY_BOOST, Math.max(1, value));
}

/**
 * Ranking multipliers for many accounts at once.
 *
 * Search ranks a page of candidates from many different sellers; resolving
 * each seller's plan through `getEntitlements` would be one query per row.
 * This reads every active subscription for the set in one query. Accounts
 * without a paid plan are absent from the map, which callers treat as 1.
 */
export async function getVisibilityBoosts(userIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(userIds)];
  const boosts = new Map<string, number>();
  if (ids.length === 0) return boosts;

  const rows = await db.subscription.findMany({
    where: {
      userId: { in: ids },
      status: { in: ["ACTIVE", "TRIALING"] },
      currentPeriodEnd: { gt: new Date() },
    },
    select: { userId: true, plan: { select: { limits: true } } },
  });

  for (const row of rows) {
    const boost = clampVisibilityBoost(parseJsonRecord(row.plan.limits).visibilityBoost);
    // Someone mid-upgrade can briefly hold two live subscriptions; the better
    // plan is the one they are paying for.
    if (boost > (boosts.get(row.userId) ?? 1)) boosts.set(row.userId, boost);
  }
  return boosts;
}

export const isUnlimited = (n: number) => n >= UNLIMITED;

export function formatLimit(n: number): string {
  return isUnlimited(n) ? "Unlimited" : String(n);
}

// ---------------------------------------------------------------------------
// Enforcement
// ---------------------------------------------------------------------------

export async function assertCanCreateListing(userId: string): Promise<void> {
  const entitlements = await getEntitlements(userId);
  if (isUnlimited(entitlements.activeListings)) return;

  const active = await db.listing.count({
    where: {
      sellerId: userId,
      status: { in: ["ACTIVE", "PENDING_REVIEW", "RESERVED"] },
      deletedAt: null,
    },
  });

  if (active >= entitlements.activeListings) {
    throw upgradeRequired(
      `Your ${entitlements.planName} plan allows ${entitlements.activeListings} active listings. Close one, or upgrade for more.`,
      { limit: entitlements.activeListings, used: active, feature: "activeListings" },
    );
  }
}

export async function assertCanSendBreedingRequest(userId: string): Promise<void> {
  const entitlements = await getEntitlements(userId);
  if (isUnlimited(entitlements.breedingRequestsPerMonth)) return;

  const since = new Date();
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  const used = await db.breedingRequest.count({
    where: { initiatorUserId: userId, createdAt: { gte: since } },
  });

  if (used >= entitlements.breedingRequestsPerMonth) {
    throw upgradeRequired(
      `You have used all ${entitlements.breedingRequestsPerMonth} breeding requests this month. Upgrade to send more.`,
      { limit: entitlements.breedingRequestsPerMonth, used, feature: "breedingRequests" },
    );
  }
}

export async function assertCanCreateSavedSearchAlert(userId: string): Promise<void> {
  const entitlements = await getEntitlements(userId);
  if (isUnlimited(entitlements.savedSearchAlerts)) return;

  const used = await db.savedSearch.count({ where: { userId, alertsEnabled: true } });

  if (used >= entitlements.savedSearchAlerts) {
    throw upgradeRequired(
      `Your plan includes ${entitlements.savedSearchAlerts} search alerts. Turn one off, or upgrade.`,
      { limit: entitlements.savedSearchAlerts, used, feature: "savedSearchAlerts" },
    );
  }
}

/** Usage figures for the billing screen. */
export async function getUsage(userId: string) {
  const entitlements = await getEntitlements(userId);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [activeListings, breedingRequests, savedSearchAlerts] = await Promise.all([
    db.listing.count({
      where: { sellerId: userId, status: { in: ["ACTIVE", "PENDING_REVIEW", "RESERVED"] }, deletedAt: null },
    }),
    db.breedingRequest.count({ where: { initiatorUserId: userId, createdAt: { gte: monthStart } } }),
    db.savedSearch.count({ where: { userId, alertsEnabled: true } }),
  ]);

  return {
    entitlements,
    usage: [
      { key: "activeListings", label: "Active listings", used: activeListings, limit: entitlements.activeListings },
      {
        key: "breedingRequests",
        label: "Breeding requests this month",
        used: breedingRequests,
        limit: entitlements.breedingRequestsPerMonth,
      },
      { key: "savedSearchAlerts", label: "Search alerts", used: savedSearchAlerts, limit: entitlements.savedSearchAlerts },
    ],
  };
}
