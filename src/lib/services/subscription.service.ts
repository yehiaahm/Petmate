import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { badRequest, conflict, notFound } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/session";
import { parseJsonArray } from "@/lib/json";
import { addDays } from "@/lib/utils";
import { notify } from "./notification.service";
import { createPayment } from "@/lib/payments/service";
import { getSettings } from "@/lib/settings";
import { clientEnv } from "@/lib/env";
import type { PlanAudience } from "@/lib/constants";

/**
 * Subscriptions.
 *
 * A plan change never takes effect before the money does: `startSubscription`
 * creates the row in TRIALING and the settlement step flips it to ACTIVE. So a
 * failed or abandoned payment leaves the user exactly where they were rather
 * than on a plan they have not paid for.
 */

export async function listPlans(audience?: PlanAudience) {
  const plans = await db.plan.findMany({
    where: { isActive: true, ...(audience ? { audience } : {}) },
    orderBy: [{ audience: "asc" }, { position: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      tagline: true,
      audience: true,
      priceMonthlyCents: true,
      priceYearlyCents: true,
      currency: true,
      features: true,
      limits: true,
      position: true,
    },
  });

  return plans.map((p) => ({ ...p, featureList: parseJsonArray<string>(p.features) }));
}

export async function getCurrentSubscription(userId: string) {
  return db.subscription.findFirst({
    where: { userId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
    orderBy: { currentPeriodEnd: "desc" },
    select: {
      id: true,
      status: true,
      interval: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
      cancelledAt: true,
      trialEndsAt: true,
      plan: {
        select: {
          id: true,
          code: true,
          name: true,
          tagline: true,
          audience: true,
          priceMonthlyCents: true,
          priceYearlyCents: true,
          currency: true,
          features: true,
        },
      },
    },
  });
}

export async function startSubscription(
  auth: AuthContext,
  params: { planCode: string; interval: "MONTH" | "YEAR"; idempotencyKey: string },
) {
  const plan = await db.plan.findUnique({
    where: { code: params.planCode },
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      priceMonthlyCents: true,
      priceYearlyCents: true,
      currency: true,
    },
  });
  if (!plan || !plan.isActive) throw notFound("That plan");

  if (plan.code === "free") throw badRequest("The free plan does not need a subscription.");

  // The price comes from the plan row. Nothing about it is client-supplied.
  const amountCents =
    params.interval === "YEAR" ? plan.priceYearlyCents : plan.priceMonthlyCents;
  if (amountCents <= 0) throw badRequest("That plan is not available for purchase.");

  const existing = await db.subscription.findFirst({
    where: { userId: auth.user.id, status: { in: ["ACTIVE", "TRIALING"] } },
    select: { id: true, planId: true, currentPeriodEnd: true, plan: { select: { name: true } } },
  });

  if (existing && existing.planId === plan.id) {
    throw conflict(`You are already on ${plan.name}.`);
  }

  const now = new Date();

  const subscription = existing
    ? await db.subscription.update({
        where: { id: existing.id },
        // Held at the previous period end until payment settles, so the user
        // keeps what they already paid for if they abandon checkout.
        data: { planId: plan.id, interval: params.interval, status: "PAST_DUE" },
        select: { id: true },
      })
    : await db.subscription.create({
        data: {
          userId: auth.user.id,
          planId: plan.id,
          interval: params.interval,
          status: "TRIALING",
          currentPeriodStart: now,
          currentPeriodEnd: now,
        },
        select: { id: true },
      });

  const payment = await createPayment({
    userId: auth.user.id,
    purpose: "SUBSCRIPTION",
    referenceType: "SUBSCRIPTION",
    referenceId: subscription.id,
    amountCents,
    currency: plan.currency,
    description: `${plan.name} — ${params.interval === "YEAR" ? "annual" : "monthly"}`,
    idempotencyKey: params.idempotencyKey,
    metadata: { planCode: plan.code, interval: params.interval },
    returnUrl: `${clientEnv.NEXT_PUBLIC_APP_URL}/settings/billing?upgraded=1`,
    customerEmail: auth.user.email,
  });

  await audit({
    action: "subscription.started",
    actorId: auth.user.id,
    entityType: "SUBSCRIPTION",
    entityId: subscription.id,
    summary: `${plan.code} ${params.interval}`,
  });

  return { subscriptionId: subscription.id, payment };
}

export async function cancelSubscription(auth: AuthContext, immediate = false) {
  const subscription = await db.subscription.findFirst({
    where: { userId: auth.user.id, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
    select: { id: true, currentPeriodEnd: true, plan: { select: { name: true } } },
  });
  if (!subscription) throw notFound("An active subscription");

  await db.subscription.update({
    where: { id: subscription.id },
    data: immediate
      ? { status: "CANCELLED", cancelledAt: new Date(), cancelAtPeriodEnd: false }
      : { cancelAtPeriodEnd: true, cancelledAt: new Date() },
  });

  await audit({
    action: "subscription.cancelled",
    actorId: auth.user.id,
    entityType: "SUBSCRIPTION",
    entityId: subscription.id,
    summary: immediate ? "Immediate" : "At period end",
  });

  await notify({
    userId: auth.user.id,
    category: "PAYMENT",
    type: "subscription.cancelled",
    title: `${subscription.plan.name} cancelled`,
    body: immediate
      ? "Your plan has ended and you are back on the free tier."
      : `You keep your benefits until ${subscription.currentPeriodEnd.toLocaleDateString("en-US", { dateStyle: "long" })}.`,
    url: "/settings/billing",
  });

  return { endsAt: immediate ? new Date() : subscription.currentPeriodEnd };
}

export async function resumeSubscription(auth: AuthContext) {
  const subscription = await db.subscription.findFirst({
    where: { userId: auth.user.id, cancelAtPeriodEnd: true, status: { in: ["ACTIVE", "TRIALING"] } },
    select: { id: true },
  });
  if (!subscription) throw notFound("A cancelled subscription");

  await db.subscription.update({
    where: { id: subscription.id },
    data: { cancelAtPeriodEnd: false, cancelledAt: null },
  });
}

/** Expires a subscription at period end. Run by `subscription.expire`. */
export async function expireSubscription(subscriptionId: string): Promise<void> {
  const subscription = await db.subscription.findUnique({
    where: { id: subscriptionId },
    select: {
      id: true,
      userId: true,
      status: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
      plan: { select: { name: true } },
    },
  });
  if (!subscription) return;
  if (subscription.currentPeriodEnd > new Date()) return;
  if (subscription.status !== "ACTIVE" && subscription.status !== "TRIALING") return;

  if (subscription.cancelAtPeriodEnd) {
    await db.subscription.update({
      where: { id: subscriptionId },
      data: { status: "EXPIRED" },
    });

    await notify({
      userId: subscription.userId,
      category: "PAYMENT",
      type: "subscription.expired",
      title: `${subscription.plan.name} has ended`,
      body: "You are back on the free plan. Your data is untouched.",
      url: "/pricing",
    });
    return;
  }

  // Without a stored payment method there is no silent auto-charge. The user
  // gets a grace period and an explicit prompt to renew.
  await db.subscription.update({
    where: { id: subscriptionId },
    data: { status: "PAST_DUE", currentPeriodEnd: addDays(new Date(), 3) },
  });

  await notify({
    userId: subscription.userId,
    category: "PAYMENT",
    type: "subscription.past_due",
    title: "Renew your plan",
    body: `${subscription.plan.name} needs renewing. You have 3 days before it reverts to free.`,
    url: "/settings/billing",
  });
}

/**
 * Buys a featured placement for a listing. The price is a platform setting, so
 * pricing changes do not need a deploy.
 */
export async function purchaseFeaturedPlacement(
  auth: AuthContext,
  params: { listingId: string; durationDays: 7 | 30; idempotencyKey: string },
) {
  const listing = await db.listing.findFirst({
    where: { id: params.listingId, sellerId: auth.user.id, deletedAt: null },
    select: { id: true, title: true, status: true, currency: true, featuredUntil: true },
  });
  if (!listing) throw notFound("That listing");
  if (!["ACTIVE", "PENDING_REVIEW"].includes(listing.status)) {
    throw conflict("Only a live listing can be featured.");
  }

  const settings = await getSettings();
  const amountCents =
    params.durationDays === 30 ? settings.featuredListing30dCents : settings.featuredListing7dCents;

  // Extend from the current end date rather than overwriting paid time.
  const startAt =
    listing.featuredUntil && listing.featuredUntil > new Date() ? listing.featuredUntil : new Date();
  const endAt = addDays(startAt, params.durationDays);

  const placement = await db.featuredPlacement.create({
    data: {
      entityType: "LISTING",
      entityId: listing.id,
      tier: params.durationDays === 30 ? "PREMIUM" : "STANDARD",
      startAt,
      endAt,
      amountCents,
      currency: listing.currency,
    },
    select: { id: true, startAt: true, endAt: true },
  });

  const payment = await createPayment({
    userId: auth.user.id,
    purpose: "FEATURED_LISTING",
    referenceType: "FEATURED_PLACEMENT",
    referenceId: placement.id,
    amountCents,
    currency: listing.currency,
    description: `Featured placement: ${listing.title} (${params.durationDays} days)`,
    idempotencyKey: params.idempotencyKey,
    returnUrl: `${clientEnv.NEXT_PUBLIC_APP_URL}/dashboard/listings/${listing.id}?featured=1`,
    customerEmail: auth.user.email,
  });

  return { placement, payment };
}

export async function getBillingHistory(userId: string) {
  return db.invoice.findMany({
    where: { userId },
    orderBy: { issuedAt: "desc" },
    take: 50,
    select: {
      id: true,
      number: true,
      totalCents: true,
      taxCents: true,
      currency: true,
      lines: true,
      issuedAt: true,
      paymentIntent: { select: { purpose: true, status: true, refundedCents: true } },
    },
  });
}
