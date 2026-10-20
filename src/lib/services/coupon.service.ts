import "server-only";
import { z } from "zod";
import { db, type DbClient, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { badRequest, conflict, notFound } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/session";
import { applyBps, formatMoney } from "@/lib/money";
import { PLATFORM_CURRENCY } from "@/lib/currency";
import { addDays, readableCode } from "@/lib/utils";
import { optionalText } from "@/lib/validation/common";
import { getSettings } from "@/lib/settings";

/**
 * Discount codes for store orders.
 *
 * PetMate pays for every discount: shops earn exactly what they would have at
 * full price, and the difference is booked to the platform's promotions
 * account when the order is paid (or, for cash on delivery, credited to the
 * shop when it collects the smaller amount at the door). A discount applies to
 * the goods only, never to shipping.
 *
 * A redemption is claimed inside the order's own transaction, with the usage
 * cap in the WHERE clause, so the last use of a limited code cannot be taken
 * by two buyers at once. Cancelling the order gives the use back.
 */

export const normalizeCouponCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, "");

export interface CouponQuote {
  couponId: string;
  code: string;
  discountCents: number;
  description: string | null;
}

/** Works out a coupon's discount on a basket, or says exactly why it does not apply. */
export async function evaluateCoupon(
  userId: string,
  rawCode: string,
  subtotalCents: number,
  client: DbClient = db,
): Promise<CouponQuote> {
  const code = normalizeCouponCode(rawCode);
  const coupon = await client.coupon.findUnique({ where: { code } });
  const now = new Date();

  // One message for "no such code" and "someone else's code": neither should
  // help anyone guess which codes exist.
  if (!coupon || !coupon.active || (coupon.assignedUserId && coupon.assignedUserId !== userId)) {
    throw badRequest("That code is not valid.");
  }
  if (coupon.startsAt > now) throw badRequest("That code is not active yet.");
  if (coupon.endsAt && coupon.endsAt <= now) throw badRequest("That code has expired.");
  if (coupon.maxRedemptions != null && coupon.redemptionCount >= coupon.maxRedemptions) {
    throw badRequest("That code has been fully used.");
  }
  if (subtotalCents < coupon.minOrderCents) {
    throw badRequest(`That code needs a basket of at least ${formatMoney(coupon.minOrderCents, coupon.currency)}.`);
  }

  const used = await client.couponRedemption.count({ where: { couponId: coupon.id, userId } });
  if (used >= coupon.perUserLimit) throw badRequest("You have already used that code.");

  if (coupon.firstOrderOnly) {
    const previous = await client.order.count({
      where: { buyerId: userId, status: { notIn: ["PENDING_PAYMENT", "CANCELLED"] } },
    });
    if (previous > 0) throw badRequest("That code is for a first order only.");
  }

  const raw =
    coupon.kind === "PERCENT"
      ? Math.min(applyBps(subtotalCents, coupon.percentBps), coupon.maxDiscountCents ?? Number.MAX_SAFE_INTEGER)
      : coupon.amountCents;
  const discountCents = Math.max(0, Math.min(raw, subtotalCents));
  if (discountCents === 0) throw badRequest("That code is not valid.");

  return { couponId: coupon.id, code: coupon.code, discountCents, description: coupon.description };
}

/**
 * Claims one use of the coupon for an order, inside the order's transaction.
 * Re-checks everything, because the basket preview may be minutes old.
 */
export async function redeemCoupon(
  tx: Tx,
  params: { userId: string; code: string; subtotalCents: number; orderId: string },
): Promise<CouponQuote> {
  const quote = await evaluateCoupon(params.userId, params.code, params.subtotalCents, tx);
  const coupon = await tx.coupon.findUniqueOrThrow({ where: { id: quote.couponId }, select: { maxRedemptions: true } });

  const claimed = await tx.coupon.updateMany({
    where: {
      id: quote.couponId,
      active: true,
      ...(coupon.maxRedemptions != null ? { redemptionCount: { lt: coupon.maxRedemptions } } : {}),
    },
    data: { redemptionCount: { increment: 1 } },
  });
  if (claimed.count === 0) throw conflict("That code has just been fully used.");

  await tx.couponRedemption.create({
    data: { couponId: quote.couponId, userId: params.userId, orderId: params.orderId, discountCents: quote.discountCents },
  });
  return quote;
}

/** Gives a cancelled order's use of its code back. */
export async function releaseCoupon(tx: Tx, orderId: string): Promise<void> {
  const redemption = await tx.couponRedemption.findUnique({ where: { orderId }, select: { id: true, couponId: true } });
  if (!redemption) return;
  await tx.couponRedemption.delete({ where: { id: redemption.id } });
  await tx.coupon.updateMany({
    where: { id: redemption.couponId, redemptionCount: { gt: 0 } },
    data: { redemptionCount: { decrement: 1 } },
  });
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const couponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3)
      .max(30)
      .transform(normalizeCouponCode)
      .refine((c) => /^[A-Z0-9_-]+$/.test(c), "Use letters, numbers, dashes and underscores only."),
    description: optionalText(200),
    kind: z.enum(["PERCENT", "FIXED"]),
    percentBps: z.number().int().min(1).max(9000).optional(),
    amountCents: z.number().int().positive().optional(),
    maxDiscountCents: z.number().int().positive().optional(),
    minOrderCents: z.number().int().min(0).default(0),
    endsAt: z.string().datetime({ offset: true }).optional(),
    maxRedemptions: z.number().int().positive().optional(),
    perUserLimit: z.number().int().min(1).max(100).default(1),
    firstOrderOnly: z.boolean().default(false),
  })
  .refine((c) => (c.kind === "PERCENT" ? Boolean(c.percentBps) : Boolean(c.amountCents)), {
    message: "Set the percentage or the amount.",
    path: ["kind"],
  });

export async function createCoupon(staff: AuthContext, raw: z.input<typeof couponSchema>) {
  const input = couponSchema.parse(raw);
  const exists = await db.coupon.findUnique({ where: { code: input.code }, select: { id: true } });
  if (exists) throw conflict("A coupon with that code already exists.");

  const coupon = await db.coupon.create({
    data: {
      code: input.code,
      description: input.description ?? null,
      kind: input.kind,
      percentBps: input.kind === "PERCENT" ? input.percentBps! : 0,
      amountCents: input.kind === "FIXED" ? input.amountCents! : 0,
      maxDiscountCents: input.kind === "PERCENT" ? (input.maxDiscountCents ?? null) : null,
      minOrderCents: input.minOrderCents,
      currency: PLATFORM_CURRENCY,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      maxRedemptions: input.maxRedemptions ?? null,
      perUserLimit: input.perUserLimit,
      firstOrderOnly: input.firstOrderOnly,
      createdById: staff.user.id,
    },
    select: { id: true, code: true },
  });
  await audit({ action: "coupon.created", actorId: staff.user.id, entityType: "COUPON", entityId: coupon.id, summary: coupon.code });
  return coupon;
}

export async function setCouponActive(staff: AuthContext, couponId: string, active: boolean) {
  const coupon = await db.coupon.findUnique({ where: { id: couponId }, select: { id: true, code: true } });
  if (!coupon) throw notFound("That coupon");
  await db.coupon.update({ where: { id: couponId }, data: { active } });
  await audit({
    action: "coupon.updated",
    actorId: staff.user.id,
    entityType: "COUPON",
    entityId: couponId,
    summary: `${coupon.code} ${active ? "enabled" : "disabled"}`,
  });
  return { active };
}

export async function listCoupons() {
  const coupons = await db.coupon.findMany({
    where: { source: "ADMIN" },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const totals = await db.couponRedemption.groupBy({
    by: ["couponId"],
    where: { couponId: { in: coupons.map((c) => c.id) } },
    _sum: { discountCents: true },
  });
  const spent = new Map(totals.map((t) => [t.couponId, t._sum.discountCents ?? 0]));
  return coupons.map((c) => ({ ...c, spentCents: spent.get(c.id) ?? 0 }));
}

/** A new member's personal first-order discount, made when a referral is recorded. */
export async function issueWelcomeCoupon(client: DbClient, userId: string) {
  const settings = await getSettings();
  return client.coupon.create({
    data: {
      code: `WELCOME-${readableCode(6)}`,
      description: "Welcome discount on your first order",
      kind: "PERCENT",
      percentBps: settings.referralWelcomeBps,
      maxDiscountCents: settings.referralWelcomeMaxCents,
      currency: PLATFORM_CURRENCY,
      endsAt: addDays(new Date(), 60),
      maxRedemptions: 1,
      perUserLimit: 1,
      firstOrderOnly: true,
      assignedUserId: userId,
      source: "REFERRAL_WELCOME",
    },
    select: { id: true, code: true },
  });
}

/** Personal codes a member can still use, shown in their basket. */
export async function listMyCoupons(userId: string) {
  return db.coupon.findMany({
    where: {
      assignedUserId: userId,
      active: true,
      OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
      redemptions: { none: {} },
    },
    select: { code: true, description: true, kind: true, percentBps: true, maxDiscountCents: true, amountCents: true, endsAt: true },
  });
}
