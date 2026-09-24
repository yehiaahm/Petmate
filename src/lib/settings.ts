import "server-only";
import { db } from "@/lib/db";
import { parseJson, stringifyJson } from "@/lib/json";
import { logger } from "@/lib/logger";

/**
 * Platform settings.
 *
 * Every commercial rule the business might want to change — commission rates,
 * escrow windows, listing limits, what a feature costs — lives in the database
 * and is editable from the admin console. Hard-coding a commission rate means
 * changing it needs an engineer and a deploy, and that is not how a marketplace
 * actually operates.
 *
 * Reads are cached in-process for a short TTL so the hot path (every checkout
 * needs the commission rate) does not add a query per request.
 */

export interface SettingsShape {
  /** Commission on a pet sale, basis points. */
  commissionPetSaleBps: number;
  /** Commission on a product order, basis points. */
  commissionProductBps: number;
  /** Commission on a veterinary booking, basis points. */
  commissionAppointmentBps: number;
  /** Commission on a paid breeding arrangement, basis points. */
  commissionBreedingBps: number;

  /** Flat fee added to every transaction, minor units. */
  transactionFeeCents: number;

  /** Hours a pet sale stays in escrow before auto-release. */
  escrowAutoReleaseHours: number;
  /** Days after delivery during which a buyer may open a dispute. */
  disputeWindowDays: number;

  /** Listing lifetime before it expires and stops appearing in search. */
  listingDurationDays: number;
  /** Free-tier ceiling on simultaneously active listings. */
  freeActiveListingLimit: number;
  /** Free-tier ceiling on pending breeding requests. */
  freeBreedingRequestLimit: number;
  /** Free-tier ceiling on saved searches with alerts. */
  freeSavedSearchLimit: number;

  /** Price of a 7-day featured placement, minor units. */
  featuredListing7dCents: number;
  featuredListing30dCents: number;

  /** Listings above this price go to manual review before going live. */
  manualReviewPriceCents: number;
  /** Require every new listing to be reviewed before publication. */
  reviewAllListings: boolean;

  /** Default seller payout hold after delivery, days. */
  payoutHoldDays: number;
  /** Smallest payout a seller may request, minor units. */
  minPayoutCents: number;

  /** Buyers may pay cash on delivery at shops that accept it. */
  codEnabled: boolean;
  /** Largest basket that may be paid on delivery, minor units. */
  codMaxOrderCents: number;

  /** Platform-wide switch for accepting new registrations. */
  registrationOpen: boolean;
  /** Read-only mode for maintenance windows. */
  maintenanceMode: boolean;

  supportEmail: string;
}

export const DEFAULT_SETTINGS: SettingsShape = {
  commissionPetSaleBps: 600, // 6%
  commissionProductBps: 1000, // 10%
  commissionAppointmentBps: 800, // 8%
  commissionBreedingBps: 500, // 5%
  transactionFeeCents: 0,

  escrowAutoReleaseHours: 168, // 7 days
  disputeWindowDays: 14,

  listingDurationDays: 60,
  freeActiveListingLimit: 3,
  freeBreedingRequestLimit: 5,
  freeSavedSearchLimit: 3,

  // Amounts are in the platform currency's minor unit (EGP piastres).
  featuredListing7dCents: 14_900, // EGP 149
  featuredListing30dCents: 44_900, // EGP 449

  manualReviewPriceCents: 10_000_000, // EGP 100,000
  reviewAllListings: false,

  payoutHoldDays: 7,
  minPayoutCents: 20_000, // EGP 200

  codEnabled: true,
  codMaxOrderCents: 500_000, // EGP 5,000

  registrationOpen: true,
  maintenanceMode: false,

  supportEmail: "support@petmate.app",
};

export const SETTING_DESCRIPTIONS: Record<keyof SettingsShape, string> = {
  commissionPetSaleBps: "Commission taken from each pet sale, in basis points (100 = 1%).",
  commissionProductBps: "Commission taken from each product order, in basis points.",
  commissionAppointmentBps: "Commission taken from each vet booking, in basis points.",
  commissionBreedingBps: "Commission taken from paid breeding arrangements, in basis points.",
  transactionFeeCents: "Flat fee added to every transaction, in the currency's minor unit.",
  escrowAutoReleaseHours: "Hours a pet sale is held in escrow before releasing automatically.",
  disputeWindowDays: "Days a buyer has to open a dispute after completion.",
  listingDurationDays: "Days a listing stays active before expiring.",
  freeActiveListingLimit: "Active listings allowed on the free plan.",
  freeBreedingRequestLimit: "Open breeding requests allowed on the free plan.",
  freeSavedSearchLimit: "Saved searches with alerts allowed on the free plan.",
  featuredListing7dCents: "Price of a 7-day featured placement, in the currency's minor unit.",
  featuredListing30dCents: "Price of a 30-day featured placement, in the currency's minor unit.",
  manualReviewPriceCents: "Listings priced above this go to manual review.",
  reviewAllListings: "Send every new listing to manual review before publishing.",
  payoutHoldDays: "Days seller earnings are held before becoming available.",
  minPayoutCents: "Minimum payout a seller can request, in the currency's minor unit.",
  codEnabled: "Allow cash on delivery at shops that accept it.",
  codMaxOrderCents: "Largest basket that can be paid on delivery, in the currency's minor unit.",
  registrationOpen: "Allow new account registrations.",
  maintenanceMode: "Put the platform in read-only maintenance mode.",
  supportEmail: "Address shown to users for support enquiries.",
};

const CACHE_TTL_MS = 30_000;
let cache: { value: SettingsShape; at: number } | null = null;

export async function getSettings(): Promise<SettingsShape> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  try {
    const rows = await db.platformSetting.findMany({ select: { key: true, value: true } });
    const merged = { ...DEFAULT_SETTINGS };

    for (const row of rows) {
      if (!(row.key in DEFAULT_SETTINGS)) continue;
      const key = row.key as keyof SettingsShape;
      const parsed = parseJson<unknown>(row.value, undefined);
      // Type must match the default, or the stored value is ignored. A bad row
      // must not be able to make commission a string and break arithmetic.
      if (typeof parsed === typeof DEFAULT_SETTINGS[key]) {
        (merged as Record<string, unknown>)[key] = parsed;
      }
    }

    cache = { value: merged, at: Date.now() };
    return merged;
  } catch (e) {
    logger.exception("failed to load platform settings, using defaults", e);
    return DEFAULT_SETTINGS;
  }
}

export async function getSetting<K extends keyof SettingsShape>(key: K): Promise<SettingsShape[K]> {
  return (await getSettings())[key];
}

export async function updateSetting<K extends keyof SettingsShape>(
  key: K,
  value: SettingsShape[K],
  updatedById: string,
): Promise<void> {
  if (typeof value !== typeof DEFAULT_SETTINGS[key]) {
    throw new Error(`Setting ${String(key)} must be a ${typeof DEFAULT_SETTINGS[key]}`);
  }

  await db.platformSetting.upsert({
    where: { key: key as string },
    create: {
      key: key as string,
      value: stringifyJson(value),
      description: SETTING_DESCRIPTIONS[key],
      category: settingCategory(key),
      updatedById,
    },
    update: { value: stringifyJson(value), updatedById },
  });

  cache = null;
}

export function invalidateSettingsCache() {
  cache = null;
}

/** Grouping used on the settings row. Exported so the seed writes the same value. */
export function settingCategory(key: keyof SettingsShape): string {
  if (key.startsWith("commission") || key === "transactionFeeCents") return "COMMISSION";
  if (key.startsWith("featured")) return "MONETISATION";
  if (key.startsWith("free")) return "LIMITS";
  if (
    key.startsWith("escrow") ||
    key.startsWith("dispute") ||
    key.startsWith("payout") ||
    key.startsWith("cod") ||
    key === "minPayoutCents"
  )
    return "PAYMENTS";
  if (key.startsWith("listing") || key === "reviewAllListings" || key === "manualReviewPriceCents")
    return "MARKETPLACE";
  return "GENERAL";
}

/**
 * Resolves the commission for a sale. A shop or clinic may negotiate its own
 * rate; `null` on that row means "use the platform default".
 */
export async function resolveCommissionBps(
  kind: "PET_SALE" | "PRODUCT" | "APPOINTMENT" | "BREEDING",
  override?: number | null,
): Promise<number> {
  if (typeof override === "number" && override >= 0 && override <= 5000) return override;

  const s = await getSettings();
  switch (kind) {
    case "PET_SALE":
      return s.commissionPetSaleBps;
    case "PRODUCT":
      return s.commissionProductBps;
    case "APPOINTMENT":
      return s.commissionAppointmentBps;
    case "BREEDING":
      return s.commissionBreedingBps;
  }
}
