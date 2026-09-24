import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, badRequest, conflict, notFound } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { AuthContext } from "@/lib/auth/session";
import { countOnce, enforceRateLimit } from "@/lib/rate-limit";
import { getSettings, type SettingsShape } from "@/lib/settings";
import { formatMoney } from "@/lib/money";
import { clientEnv } from "@/lib/env";
import { PLATFORM_CURRENCY } from "@/lib/currency";
import { AD_SLOTS, type AdSlot } from "@/lib/constants";
import { addDays } from "@/lib/utils";
import { startOfZonedDay, endOfZonedDay, zonedToday } from "@/lib/timezone";
import { accounts, postTransaction } from "@/lib/payments/ledger-core";
import { createPayment, refundPayment } from "@/lib/payments/service";
import { safeText, optionalText } from "@/lib/validation/common";
import { notify } from "./notification.service";

/**
 * Self-serve advertising.
 *
 * An advertiser writes a campaign, pays its whole budget up front, and staff
 * review it before it runs. It is billed per thousand impressions at the price
 * fixed when it was bought, and it ends when the budget is delivered or the end
 * date passes; any budget not delivered goes back to the advertiser's wallet.
 *
 *   DRAFT ─ paid ─▶ PENDING_REVIEW ─┬─ approved ─▶ ACTIVE ⇄ PAUSED ─▶ COMPLETED
 *     │                             └─ rejected ─▶ REJECTED (refunded)
 *     └─ abandoned ─▶ CANCELLED
 *
 * Ads are chosen by the slot a page renders, never by who is looking: there is
 * no profile, cookie or history behind the choice, which is what lets the
 * privacy policy keep saying advertisers get no personal data.
 */

export const MAX_CAMPAIGN_DAYS = 90;
const AD_COUNT_WINDOW_SECONDS = 1800;

export function cpmForSlot(slot: AdSlot, settings: SettingsShape): number {
  switch (slot) {
    case "HOME_HERO":
      return settings.adCpmHomeCents;
    case "SEARCH_INLINE":
      return settings.adCpmSearchCents;
    case "CLINIC_SIDEBAR":
      return settings.adCpmClinicsCents;
  }
}

/** What a campaign has cost for a number of impressions, never above its budget. */
export function adSpend(impressions: number, cpmCents: number, budgetCents: number): number {
  return Math.min(budgetCents, Math.floor((impressions * cpmCents) / 1000));
}

/** Impressions a budget buys at a price. */
export function impressionsForBudget(budgetCents: number, cpmCents: number): number {
  return cpmCents > 0 ? Math.floor((budgetCents * 1000) / cpmCents) : 0;
}

/** A link an ad may send people to: our own pages, or a secure external site. */
const destinationSchema = z
  .string()
  .trim()
  .max(500)
  .refine((value) => {
    if (/^\/(?!\/)/.test(value)) return true;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Use a page on PetMate or a secure https:// link.");

const imageSchema = z
  .string()
  .trim()
  .max(500)
  .refine((value) => /^\/(?!\/)/.test(value) || value.startsWith("https://"), "Use an uploaded image or a secure https:// link.");

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");

export const adCampaignSchema = z
  .object({
    name: safeText(80, 3),
    slot: z.enum(AD_SLOTS),
    headline: safeText(70, 5),
    body: optionalText(140),
    imageUrl: imageSchema.optional(),
    destinationUrl: destinationSchema,
    budgetCents: z.number().int().positive().max(100_000_000),
    startDate: dateOnly,
    endDate: dateOnly,
  })
  // ISO dates compare correctly as strings.
  .refine((c) => c.endDate >= c.startDate, { message: "The end date cannot be before the start date.", path: ["endDate"] })
  .refine((c) => endOfZonedDay(c.endDate).getTime() - startOfZonedDay(c.startDate).getTime() <= MAX_CAMPAIGN_DAYS * 86_400_000, {
    message: `A campaign can run for up to ${MAX_CAMPAIGN_DAYS} days.`,
    path: ["endDate"],
  });

/**
 * Creates the campaign and its checkout together. The price per thousand is
 * the one in force now, written onto the campaign so a later price change
 * never re-prices a budget that has already been paid.
 */
export async function createAdCampaign(
  auth: AuthContext,
  raw: z.input<typeof adCampaignSchema>,
  idempotencyKey: string,
) {
  await enforceRateLimit("adCampaign", auth.user.id);
  const parsed = adCampaignSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", "Please check the highlighted fields.", {
      fields: parsed.error.issues.map((i) => ({ field: `campaign.${i.path.join(".")}`, message: i.message })),
    });
  }
  const input = parsed.data;
  const settings = await getSettings();

  if (input.startDate < zonedToday()) throw badRequest("The start date cannot be in the past.");
  if (input.budgetCents < settings.adMinBudgetCents) {
    throw badRequest(`The smallest budget is ${formatMoney(settings.adMinBudgetCents, PLATFORM_CURRENCY)}.`);
  }

  const cpmCents = cpmForSlot(input.slot, settings);

  const campaign = await db.adCampaign.create({
    data: {
      advertiserId: auth.user.id,
      name: input.name,
      slot: input.slot,
      status: "DRAFT",
      budgetCents: input.budgetCents,
      cpmCents,
      currency: PLATFORM_CURRENCY,
      headline: input.headline,
      body: input.body ?? null,
      imageUrl: input.imageUrl ?? null,
      destinationUrl: input.destinationUrl,
      // The whole of both days, in the platform's time zone.
      startAt: startOfZonedDay(input.startDate),
      endAt: endOfZonedDay(input.endDate),
    },
    select: { id: true, name: true, budgetCents: true, currency: true },
  });

  await audit({
    action: "ad.created",
    actorId: auth.user.id,
    entityType: "AD_CAMPAIGN",
    entityId: campaign.id,
    summary: `${input.slot} ${formatMoney(input.budgetCents, PLATFORM_CURRENCY)}`,
  });

  const payment = await createPayment({
    userId: auth.user.id,
    purpose: "AD_CAMPAIGN",
    referenceType: "AD_CAMPAIGN",
    referenceId: campaign.id,
    amountCents: campaign.budgetCents,
    currency: campaign.currency,
    description: `Ad campaign: ${campaign.name}`,
    idempotencyKey: `ad:${campaign.id}:${idempotencyKey}`.slice(0, 120),
    returnUrl: `${clientEnv.NEXT_PUBLIC_APP_URL}/dashboard/advertising`,
    customerEmail: auth.user.email,
  });

  return { campaign, payment };
}

/** Pays for a draft that was abandoned at checkout. */
export async function payForDraft(auth: AuthContext, campaignId: string) {
  const campaign = await db.adCampaign.findFirst({
    where: { id: campaignId, advertiserId: auth.user.id },
    select: { id: true, name: true, status: true, budgetCents: true, currency: true },
  });
  if (!campaign) throw notFound("That campaign");
  if (campaign.status !== "DRAFT") throw conflict("This campaign has already been paid for.");

  const payment = await createPayment({
    userId: auth.user.id,
    purpose: "AD_CAMPAIGN",
    referenceType: "AD_CAMPAIGN",
    referenceId: campaign.id,
    amountCents: campaign.budgetCents,
    currency: campaign.currency,
    description: `Ad campaign: ${campaign.name}`,
    idempotencyKey: `ad:${campaign.id}:draft`,
    returnUrl: `${clientEnv.NEXT_PUBLIC_APP_URL}/dashboard/advertising`,
    customerEmail: auth.user.email,
  });
  return { payment };
}

/** An unpaid draft can be thrown away; a payment that lands later is refunded. */
export async function cancelDraft(auth: AuthContext, campaignId: string) {
  const { count } = await db.adCampaign.updateMany({
    where: { id: campaignId, advertiserId: auth.user.id, status: "DRAFT" },
    data: { status: "CANCELLED" },
  });
  if (count === 0) throw conflict("Only an unpaid draft can be discarded.");
  return { ok: true };
}

export async function setCampaignPaused(auth: AuthContext, campaignId: string, paused: boolean) {
  const { count } = await db.adCampaign.updateMany({
    where: { id: campaignId, advertiserId: auth.user.id, status: paused ? "ACTIVE" : "PAUSED" },
    data: { status: paused ? "PAUSED" : "ACTIVE" },
  });
  if (count === 0) {
    throw conflict(paused ? "Only a running campaign can be paused." : "Only a paused campaign can be resumed.");
  }
  return { status: paused ? "PAUSED" : "ACTIVE" };
}

/** The advertiser stops a campaign early; what was not delivered is returned. */
export async function endCampaignEarly(auth: AuthContext, campaignId: string) {
  const campaign = await db.adCampaign.findFirst({
    where: { id: campaignId, advertiserId: auth.user.id },
    select: { status: true },
  });
  if (!campaign) throw notFound("That campaign");
  if (campaign.status !== "ACTIVE" && campaign.status !== "PAUSED") {
    throw conflict("Only a running or paused campaign can be ended.");
  }
  return completeCampaign(campaignId, "ENDED_BY_ADVERTISER", auth.user.id);
}

/**
 * Closes a campaign and returns undelivered budget to the advertiser's wallet.
 * The status claim makes it safe to call from the job, the advertiser and the
 * impression path at once: only one of them books the return.
 */
export async function completeCampaign(
  campaignId: string,
  reason: "BUDGET_DELIVERED" | "END_DATE" | "ENDED_BY_ADVERTISER",
  actorId?: string,
): Promise<{ returnedCents: number }> {
  const result = await db.$transaction(async (tx) => {
    const campaign = await tx.adCampaign.findUnique({
      where: { id: campaignId },
      select: { id: true, advertiserId: true, name: true, budgetCents: true, impressions: true, cpmCents: true, currency: true },
    });
    if (!campaign) return null;

    const spentCents = adSpend(campaign.impressions, campaign.cpmCents, campaign.budgetCents);
    const returnedCents = campaign.budgetCents - spentCents;

    const claimed = await tx.adCampaign.updateMany({
      where: { id: campaignId, status: { in: ["ACTIVE", "PAUSED"] } },
      data: { status: "COMPLETED", completedAt: new Date(), spentCents, returnedCents },
    });
    if (claimed.count === 0) return null;

    if (returnedCents > 0) {
      await postTransaction(
        {
          kind: "ADJUSTMENT",
          description: `Undelivered ad budget returned: ${campaign.name}`,
          currency: campaign.currency,
          referenceType: "AD_CAMPAIGN",
          referenceId: campaign.id,
          createdById: actorId,
          entries: [
            { account: accounts.platformRevenue(campaign.currency), amountCents: -returnedCents },
            { account: accounts.userAvailable(campaign.advertiserId, campaign.currency), amountCents: returnedCents },
          ],
        },
        tx,
      );
    }
    return { ...campaign, spentCents, returnedCents };
  });

  if (!result) return { returnedCents: 0 };

  await audit({
    action: "ad.completed",
    actorId: actorId ?? result.advertiserId,
    entityType: "AD_CAMPAIGN",
    entityId: campaignId,
    summary: `${reason}: spent ${result.spentCents}, returned ${result.returnedCents}`,
  });

  await notify({
    userId: result.advertiserId,
    category: "PAYMENT",
    type: "ad.completed",
    title: "Your campaign has finished",
    body:
      result.returnedCents > 0
        ? `${formatMoney(result.returnedCents, result.currency)} of budget that was not delivered is back in your wallet.`
        : "Your whole budget was delivered.",
    url: "/dashboard/advertising",
    entityType: "AD_CAMPAIGN",
    entityId: campaignId,
  });

  return { returnedCents: result.returnedCents };
}

/** Run by `ads.settle`: closes campaigns whose time or money has run out. */
export async function settleFinishedCampaigns(now = new Date()): Promise<number> {
  const finished = await db.adCampaign.findMany({
    where: { status: { in: ["ACTIVE", "PAUSED"] }, endAt: { lte: now } },
    select: { id: true },
    take: 200,
  });
  for (const c of finished) await completeCampaign(c.id, "END_DATE");
  return finished.length;
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

export async function reviewAdCampaign(
  staff: AuthContext,
  campaignId: string,
  decision: "APPROVE" | "REJECT",
  note: string,
) {
  const campaign = await db.adCampaign.findUnique({
    where: { id: campaignId },
    select: { id: true, advertiserId: true, status: true, paymentIntentId: true, budgetCents: true, currency: true, name: true },
  });
  if (!campaign) throw notFound("That campaign");

  const { count } = await db.adCampaign.updateMany({
    where: { id: campaignId, status: "PENDING_REVIEW" },
    data: {
      status: decision === "APPROVE" ? "ACTIVE" : "REJECTED",
      reviewNote: note.slice(0, 500),
      reviewedById: staff.user.id,
      reviewedAt: new Date(),
    },
  });
  if (count === 0) throw conflict("This campaign has already been reviewed.");

  if (decision === "REJECT" && campaign.paymentIntentId) {
    try {
      await refundPayment({
        intentId: campaign.paymentIntentId,
        amountCents: campaign.budgetCents,
        reason: "CANCELLED_ORDER",
        approvedById: staff.user.id,
        note: `Ad campaign rejected: ${note}`.slice(0, 300),
        idempotencyKey: `ad_reject_${campaign.id}`,
      });
    } catch (e) {
      // The rejection stands; the refund is retried from the finance queue.
      logger.exception("rejected ad campaign could not be refunded", e, { campaignId });
    }
  }

  await audit({
    action: "ad.reviewed",
    actorId: staff.user.id,
    entityType: "AD_CAMPAIGN",
    entityId: campaignId,
    summary: `${decision}: ${note}`,
  });

  await notify({
    userId: campaign.advertiserId,
    category: "PAYMENT",
    type: decision === "APPROVE" ? "ad.approved" : "ad.rejected",
    title: decision === "APPROVE" ? "Your campaign is approved" : "Your campaign was not approved",
    body:
      decision === "APPROVE"
        ? "It starts showing on its start date."
        : `${note} Your budget of ${formatMoney(campaign.budgetCents, campaign.currency)} is being refunded.`,
    url: "/dashboard/advertising",
    entityType: "AD_CAMPAIGN",
    entityId: campaignId,
  });

  return { status: decision === "APPROVE" ? "ACTIVE" : "REJECTED" };
}

export async function listCampaignsForReview() {
  return db.adCampaign.findMany({
    where: { status: "PENDING_REVIEW" },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: {
      id: true,
      name: true,
      slot: true,
      headline: true,
      body: true,
      imageUrl: true,
      destinationUrl: true,
      budgetCents: true,
      currency: true,
      startAt: true,
      endAt: true,
      createdAt: true,
      advertiser: { select: { id: true, name: true, email: true } },
    },
  });
}

// ---------------------------------------------------------------------------
// Serving
// ---------------------------------------------------------------------------

export interface ServedAd {
  id: string;
  headline: string;
  body: string | null;
  imageUrl: string | null;
  destinationUrl: string;
  external: boolean;
}

/**
 * The ad for a slot right now: of the campaigns running, the one furthest
 * behind its even pace (share of budget spent against share of time elapsed),
 * so every advertiser's budget is spread over their whole date range instead
 * of the biggest one taking every impression on day one.
 */
export async function selectAd(slot: AdSlot, now = new Date()): Promise<ServedAd | null> {
  const running = await db.adCampaign.findMany({
    where: { slot, status: "ACTIVE", startAt: { lte: now }, endAt: { gt: now } },
    select: {
      id: true,
      headline: true,
      body: true,
      imageUrl: true,
      destinationUrl: true,
      budgetCents: true,
      spentCents: true,
      startAt: true,
      endAt: true,
    },
    take: 50,
  });
  const eligible = running.filter((c) => c.spentCents < c.budgetCents);
  if (eligible.length === 0) return null;

  const pace = (c: (typeof eligible)[number]) => {
    const elapsed = (now.getTime() - c.startAt.getTime()) / Math.max(1, c.endAt.getTime() - c.startAt.getTime());
    return c.spentCents / c.budgetCents - elapsed;
  };
  const lowest = Math.min(...eligible.map(pace));
  // Campaigns within a whisker of each other share the slot at random.
  const tied = eligible.filter((c) => pace(c) - lowest < 0.02);
  const pick = tied[Math.floor(Math.random() * tied.length)]!;

  return {
    id: pick.id,
    headline: pick.headline,
    body: pick.body,
    imageUrl: pick.imageUrl,
    destinationUrl: pick.destinationUrl,
    external: !pick.destinationUrl.startsWith("/"),
  };
}

/**
 * Counts one impression and bills it. A visitor counts once per campaign per
 * half hour, so reloading a page cannot run up an advertiser's bill.
 */
export async function recordImpression(
  campaignId: string,
  visitorKey: string,
  ip: string | null,
): Promise<{ counted: boolean }> {
  // One billable impression per visitor per campaign per half hour, so a
  // refresh loop cannot drain a competitor's budget, and a ceiling per network
  // for a script that throws its cookies away.
  if (!(await countOnce(`ad-imp:${campaignId}:${visitorKey}`, AD_COUNT_WINDOW_SECONDS))) return { counted: false };
  if (ip && !(await countOnce(`ad-imp-ip:${campaignId}:${ip}`, AD_COUNT_WINDOW_SECONDS, 40))) {
    return { counted: false };
  }

  const now = new Date();
  const outcome = await db.$transaction(async (tx) => {
    const bumped = await tx.adCampaign.updateMany({
      where: { id: campaignId, status: "ACTIVE", startAt: { lte: now }, endAt: { gt: now } },
      data: { impressions: { increment: 1 } },
    });
    if (bumped.count === 0) return null;
    const c = await tx.adCampaign.findUniqueOrThrow({
      where: { id: campaignId },
      select: { impressions: true, cpmCents: true, budgetCents: true },
    });
    const spentCents = adSpend(c.impressions, c.cpmCents, c.budgetCents);
    await tx.adCampaign.update({ where: { id: campaignId }, data: { spentCents } });
    return spentCents >= c.budgetCents;
  });

  if (outcome === null) return { counted: false };
  if (outcome) await completeCampaign(campaignId, "BUDGET_DELIVERED");
  return { counted: true };
}

/** Counts a click (once per visitor per half hour) and returns where it goes. */
export async function recordClick(campaignId: string, visitorKey: string): Promise<string | null> {
  const campaign = await db.adCampaign.findUnique({
    where: { id: campaignId },
    select: { destinationUrl: true, status: true },
  });
  // A finished campaign's link still works for someone who saw it earlier;
  // one that never ran, or was rejected, goes nowhere.
  if (!campaign || !["ACTIVE", "PAUSED", "COMPLETED"].includes(campaign.status)) return null;

  if (campaign.status === "ACTIVE" && (await countOnce(`ad-click:${campaignId}:${visitorKey}`, AD_COUNT_WINDOW_SECONDS))) {
    await db.adCampaign.update({ where: { id: campaignId }, data: { clicks: { increment: 1 } } });
  }
  return campaign.destinationUrl;
}

// ---------------------------------------------------------------------------
// The advertiser's dashboard
// ---------------------------------------------------------------------------

export async function listMyCampaigns(auth: AuthContext) {
  const campaigns = await db.adCampaign.findMany({
    where: { advertiserId: auth.user.id, status: { not: "CANCELLED" } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      name: true,
      slot: true,
      status: true,
      headline: true,
      body: true,
      imageUrl: true,
      destinationUrl: true,
      budgetCents: true,
      spentCents: true,
      returnedCents: true,
      cpmCents: true,
      currency: true,
      impressions: true,
      clicks: true,
      startAt: true,
      endAt: true,
      reviewNote: true,
      createdAt: true,
    },
  });
  return campaigns.map((c) => ({
    ...c,
    ctr: c.impressions > 0 ? c.clicks / c.impressions : 0,
    plannedImpressions: impressionsForBudget(c.budgetCents, c.cpmCents),
  }));
}

/** Prices for the campaign form, straight from settings. */
export async function adPricing() {
  const settings = await getSettings();
  return {
    currency: PLATFORM_CURRENCY,
    minBudgetCents: settings.adMinBudgetCents,
    maxDays: MAX_CAMPAIGN_DAYS,
    cpm: Object.fromEntries(AD_SLOTS.map((slot) => [slot, cpmForSlot(slot, settings)])) as Record<AdSlot, number>,
    today: zonedToday(),
    defaultEnd: zonedToday(undefined, addDays(new Date(), 14)),
  };
}
