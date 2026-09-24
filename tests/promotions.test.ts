import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db, makeUser, makeShopWithProduct, resetDatabase } from "./helpers";
import { invalidateSettingsCache, getSettings } from "@/lib/settings";
import { addToCart, createOrder, cancelOrder } from "@/lib/services/commerce.service";
import { createCoupon, evaluateCoupon, listMyCoupons } from "@/lib/services/coupon.service";
import { recordReferral, ensureReferralCode, qualifyReferrals } from "@/lib/services/referral.service";
import { confirmPayment, createPayment } from "@/lib/payments/service";
import { getBalance, accounts } from "@/lib/payments/ledger-core";
import { updateDeliveryStatus, dispatchForDelivery, confirmDeliveryWithCode } from "@/lib/services/delivery.service";
import { applyBps } from "@/lib/money";
import { addDays } from "@/lib/utils";

/**
 * Coupons and referrals are PetMate's money, never the shop's: every test
 * checks that the shop is credited in full and that the difference sits in
 * the promotions account, with the ledger still summing to zero.
 */

const address = { shippingName: "Mona Adel", shippingLine1: "14 Brazil Street", shippingCity: "Cairo", shippingCountry: "Egypt" };

async function ledgerSum(): Promise<number> {
  return (await db.ledgerEntry.aggregate({ _sum: { amountCents: true } }))._sum.amountCents ?? 0;
}

async function basket(priceCents = 30_000, quantity = 1) {
  const seller = await makeUser();
  const buyer = await makeUser();
  const { shopId, variantId } = await makeShopWithProduct(seller.id, { priceCents, stock: 10 });
  await db.shop.update({ where: { id: shopId }, data: { acceptsCod: true } });
  await addToCart(buyer.auth, { variantId, quantity });
  return { seller, buyer, shopId, variantId };
}

async function admin() {
  return (await makeUser({ roles: ["ADMIN"] })).auth;
}

async function payOnline(buyerId: string, order: { id: string; totalCents: number; currency: string }) {
  const payment = await createPayment({
    userId: buyerId,
    purpose: "PRODUCT_ORDER",
    referenceType: "ORDER",
    referenceId: order.id,
    amountCents: order.totalCents,
    currency: order.currency,
    description: "test",
    idempotencyKey: `order:${order.id}:test`,
    returnUrl: "http://localhost/",
  });
  await confirmPayment({ intentId: payment.id, actorId: buyerId, viaSandbox: true });
}

beforeEach(async () => {
  await resetDatabase();
  invalidateSettingsCache();
});
afterEach(() => invalidateSettingsCache());

describe("coupon rules", () => {
  it("caps a percentage and never discounts more than the goods", async () => {
    const staff = await admin();
    await createCoupon(staff, { code: "save20", kind: "PERCENT", percentBps: 2000, maxDiscountCents: 5_000 });
    await createCoupon(staff, { code: "FLAT", kind: "FIXED", amountCents: 100_000 });
    const buyer = await makeUser();
    expect((await evaluateCoupon(buyer.id, "Save20 ", 10_000)).discountCents).toBe(2_000);
    expect((await evaluateCoupon(buyer.id, "SAVE20", 100_000)).discountCents).toBe(5_000);
    expect((await evaluateCoupon(buyer.id, "FLAT", 30_000)).discountCents).toBe(30_000);
  });

  it("explains why a code does not apply", async () => {
    const staff = await admin();
    await createCoupon(staff, { code: "BIG", kind: "FIXED", amountCents: 1_000, minOrderCents: 50_000 });
    await createCoupon(staff, { code: "OLD", kind: "FIXED", amountCents: 1_000, endsAt: addDays(new Date(), -1).toISOString() });
    const buyer = await makeUser();
    await expect(evaluateCoupon(buyer.id, "NOPE", 10_000)).rejects.toThrow(/not valid/);
    await expect(evaluateCoupon(buyer.id, "BIG", 10_000)).rejects.toThrow(/at least/);
    await expect(evaluateCoupon(buyer.id, "OLD", 10_000)).rejects.toThrow(/expired/);
  });
});

describe("coupons at checkout", () => {
  it("takes the discount off the total and pays the shop in full", async () => {
    const staff = await admin();
    await createCoupon(staff, { code: "TENOFF", kind: "PERCENT", percentBps: 1000 });
    const { buyer, shopId } = await basket(30_000);

    const order = await createOrder(buyer.auth, { ...address, couponCode: "tenoff" });
    const saved = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    expect(saved.discountCents).toBe(3_000);
    expect(saved.totalCents).toBe(saved.subtotalCents + saved.shippingCents - 3_000);
    expect(saved.items[0]!.discountCents).toBe(3_000);

    await payOnline(buyer.id, order);

    const item = saved.items[0]!;
    expect(await getBalance(accounts.sellerPending(shopId))).toBe(item.sellerEarningsCents + saved.shippingCents);
    expect(await getBalance(accounts.platformPromotions())).toBe(-3_000);
    expect(await getBalance(accounts.platformRevenue())).toBe(item.commissionCents);
    expect(await ledgerSum()).toBe(0);

    const invoice = await db.invoice.findFirstOrThrow({ where: { userId: buyer.id } });
    expect(invoice.lines).toContain("TENOFF");
    expect(invoice.totalCents).toBe(saved.totalCents);
  });

  it("stops at the usage limit, and a cancelled order gives its use back", async () => {
    const staff = await admin();
    await createCoupon(staff, { code: "ONCE", kind: "FIXED", amountCents: 1_000, maxRedemptions: 1, perUserLimit: 1 });
    const first = await basket();
    const second = await basket();

    const order = await createOrder(first.buyer.auth, { ...address, couponCode: "ONCE" });
    await expect(createOrder(second.buyer.auth, { ...address, couponCode: "ONCE" })).rejects.toThrow(/fully used/);
    // The failed checkout rolled back: the second basket is still there, nothing was ordered.
    expect(await db.order.count({ where: { buyerId: second.buyer.id } })).toBe(0);

    await cancelOrder({ orderId: order.id, reason: "changed mind", actorId: first.buyer.id, requireBuyerId: first.buyer.id });
    expect((await db.coupon.findUniqueOrThrow({ where: { code: "ONCE" } })).redemptionCount).toBe(0);
    await createOrder(second.buyer.auth, { ...address, couponCode: "ONCE" });
  });

  it("refunds a paid, discounted order without the platform gaining or losing", async () => {
    const staff = await admin();
    await createCoupon(staff, { code: "HALF", kind: "PERCENT", percentBps: 5000 });
    const { buyer, shopId } = await basket(30_000);
    const order = await createOrder(buyer.auth, { ...address, couponCode: "HALF" });
    await payOnline(buyer.id, order);

    await cancelOrder({ orderId: order.id, reason: "changed mind", actorId: buyer.id, requireBuyerId: buyer.id });

    const intent = await db.paymentIntent.findFirstOrThrow({ where: { referenceId: order.id } });
    expect(intent.refundedCents).toBe(order.totalCents);
    expect(await getBalance(accounts.sellerPending(shopId))).toBe(0);
    // What promotions spent, revenue got back from the shop's reversed earnings.
    const platform = (await getBalance(accounts.platformRevenue())) + (await getBalance(accounts.platformPromotions()));
    expect(platform).toBe(0);
    expect(await ledgerSum()).toBe(0);
  });

  it("credits a cash-on-delivery shop for the coupon when it collects the smaller amount", async () => {
    const staff = await admin();
    await createCoupon(staff, { code: "COD50", kind: "FIXED", amountCents: 5_000 });
    const { seller, buyer, shopId } = await basket(30_000);

    const order = await createOrder(buyer.auth, { ...address, shippingPhone: "01001234567", paymentMethod: "COD", couponCode: "COD50" });
    const delivery = await db.delivery.findFirstOrThrow({ where: { orderId: order.id } });
    await updateDeliveryStatus(seller.auth, delivery.id, "PICKED_UP");
    await dispatchForDelivery(seller.auth, delivery.id);
    const note = await db.notification.findFirstOrThrow({ where: { userId: buyer.id, body: { contains: "this code" } }, orderBy: { createdAt: "desc" } });
    await confirmDeliveryWithCode(seller.auth, delivery.id, note.body!.match(/confirm: (\S+)/)![1]!);

    const saved = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    const item = saved.items[0]!;
    const collection = await db.codCollection.findFirstOrThrow({ where: { orderId: order.id } });
    expect(collection.amountCents).toBe(item.totalCents + saved.shippingCents - 5_000);
    // The shop owes the commission but is owed the coupon.
    expect(await getBalance(accounts.sellerAvailable(shopId))).toBe(5_000 - item.commissionCents);
    expect(await getBalance(accounts.platformPromotions())).toBe(-5_000);
    expect(await ledgerSum()).toBe(0);
  });
});

describe("referrals", () => {
  async function invited() {
    const referrer = await makeUser({ name: "Referrer" });
    const code = await ensureReferralCode(referrer.id);
    const referee = await makeUser({ name: "Friend Invited" });
    const result = await recordReferral(referee.id, code);
    return { referrer, referee, code, result };
  }

  it("gives the new member a personal first-order code", async () => {
    const { referee, result } = await invited();
    expect(result?.welcomeCode).toMatch(/^WELCOME-/);
    const mine = await listMyCoupons(referee.id);
    expect(mine.map((c) => c.code)).toEqual([result!.welcomeCode]);

    const settings = await getSettings();
    const quote = await evaluateCoupon(referee.id, result!.welcomeCode, 30_000);
    expect(quote.discountCents).toBe(Math.min(applyBps(30_000, settings.referralWelcomeBps), settings.referralWelcomeMaxCents));

    // Nobody else can use it.
    const stranger = await makeUser();
    await expect(evaluateCoupon(stranger.id, result!.welcomeCode, 30_000)).rejects.toThrow(/not valid/);
  });

  it("ignores self-invites and unknown codes, and records an invite only once", async () => {
    const user = await makeUser();
    const code = await ensureReferralCode(user.id);
    expect(await ensureReferralCode(user.id)).toBe(code);
    expect(await recordReferral(user.id, code)).toBeNull();
    expect(await recordReferral(user.id, "ZZZZZZZ")).toBeNull();

    const { referee, code: other } = await invited();
    expect(await recordReferral(referee.id, other)).toBeNull();
    expect(await db.referral.count({ where: { refereeId: referee.id } })).toBe(1);
  });

  it("pays the inviter once the first order has been delivered for two weeks and the phone is verified", async () => {
    const { referrer, referee } = await invited();
    const seller = await makeUser();
    const { variantId } = await makeShopWithProduct(seller.id, { priceCents: 30_000, stock: 5 });
    await addToCart(referee.auth, { variantId, quantity: 1 });
    const order = await createOrder(referee.auth, { ...address });
    await payOnline(referee.id, order);
    await db.order.update({ where: { id: order.id }, data: { status: "DELIVERED" } });

    // Delivered, but too recently.
    expect(await qualifyReferrals()).toBe(0);
    await db.order.update({ where: { id: order.id }, data: { placedAt: addDays(new Date(), -20) } });
    // Old enough, but the new account has no verified phone.
    expect(await qualifyReferrals()).toBe(0);
    await db.user.update({ where: { id: referee.id }, data: { phone: "+201012345678", phoneVerifiedAt: new Date() } });

    expect(await qualifyReferrals()).toBe(1);
    const settings = await getSettings();
    expect(await getBalance(accounts.userAvailable(referrer.id))).toBe(settings.referralRewardCents);
    // Running again pays nothing more.
    expect(await qualifyReferrals()).toBe(0);
    expect(await getBalance(accounts.userAvailable(referrer.id))).toBe(settings.referralRewardCents);
    expect(await ledgerSum()).toBe(0);
  });

  it("voids an invite whose account was closed", async () => {
    const { referee } = await invited();
    await db.user.update({ where: { id: referee.id }, data: { status: "BANNED" } });
    await qualifyReferrals();
    expect((await db.referral.findUniqueOrThrow({ where: { refereeId: referee.id } })).status).toBe("VOID");
  });
});
