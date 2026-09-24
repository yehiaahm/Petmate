import { describe, it, expect, beforeEach } from "vitest";
import { db, makeUser, makeShopWithProduct, makeListing, makePet, resetDatabase } from "./helpers";
import { applyBps, distributeCents, formatMoney, parseMoneyToCents, nextRatingAvgBps } from "@/lib/money";
import {
  accounts,
  postTransaction,
  getBalance,
  assertLedgerBalanced,
} from "@/lib/payments/ledger-core";
import { createPayment, confirmPayment, refundPayment } from "@/lib/payments/service";
import { createOrder, addToCart } from "@/lib/services/commerce.service";
import { createPetOrder, confirmHandover } from "@/lib/services/petorder.service";

describe("money arithmetic", () => {
  it("applies basis points with half-up rounding and never exceeds the amount", () => {
    // 2.5% of 19.99 is 0.49975, which must land on 50 cents, not 49.
    expect(applyBps(1999, 250)).toBe(50);
    expect(applyBps(10_000, 1000)).toBe(1000);
    expect(applyBps(1, 10_000)).toBe(1);
    expect(applyBps(100, 20_000)).toBe(100); // clamped to the amount
    expect(applyBps(0, 500)).toBe(0);
    expect(applyBps(500, 0)).toBe(0);
  });

  it("distributes cents without losing or inventing any", () => {
    // 100 split three ways cannot be done evenly; the total must still be 100.
    const three = distributeCents(100, [1, 1, 1]);
    expect(three.reduce((a, b) => a + b, 0)).toBe(100);

    const weighted = distributeCents(1000, [3, 1]);
    expect(weighted.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(weighted[0]).toBe(750);

    const awkward = distributeCents(1, [1, 1, 1, 1]);
    expect(awkward.reduce((a, b) => a + b, 0)).toBe(1);

    expect(distributeCents(500, [0, 0])).toEqual([0, 0]);
  });

  it("formats and parses money without float drift", () => {
    expect(formatMoney(199_999, "USD")).toBe("$1,999.99");
    expect(formatMoney(0, "USD", { showFree: true })).toBe("Free");
    expect(formatMoney(150_000, "USD", { compact: true })).toBe("$1.5K");

    expect(parseMoneyToCents("19.99")).toBe(1999);
    expect(parseMoneyToCents("$1,200")).toBe(120_000);
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("1.2.3")).toBeNull();
  });

  it("keeps a running rating average exact", () => {
    // Three 5s then a 1 must average 4.0 exactly.
    let avg = 0;
    let count = 0;
    for (const rating of [5, 5, 5, 1]) {
      avg = nextRatingAvgBps(avg, count, rating);
      count++;
    }
    expect(avg).toBe(400);
  });
});

describe("double-entry ledger", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("refuses an unbalanced transaction", async () => {
    await expect(
      postTransaction({
        kind: "CHARGE",
        description: "deliberately unbalanced",
        entries: [
          { account: accounts.external(), amountCents: -1000 },
          { account: accounts.platformRevenue(), amountCents: 900 },
        ],
      }),
    ).rejects.toThrow();

    // Nothing may be written when the invariant fails.
    const count = await db.ledgerTransaction.count();
    expect(count).toBe(0);
  });

  it("refuses a single-sided transaction", async () => {
    await expect(
      postTransaction({
        kind: "CHARGE",
        description: "one entry",
        entries: [{ account: accounts.external(), amountCents: 0 }],
      }),
    ).rejects.toThrow();
  });

  it("records balances that derive from entries", async () => {
    await postTransaction({
      kind: "CHARGE",
      description: "test charge",
      entries: [
        { account: accounts.external(), amountCents: -5000 },
        { account: accounts.platformRevenue(), amountCents: 5000 },
      ],
    });

    expect(await getBalance(accounts.platformRevenue())).toBe(5000);
    expect(await getBalance(accounts.external())).toBe(-5000);

    const check = await assertLedgerBalanced();
    expect(check.ok).toBe(true);
    expect(check.totalCents).toBe(0);
  });
});

describe("product order money flow", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("charges the database price, not the requested one, and balances the book", async () => {
    const seller = await makeUser({ roles: ["USER", "SELLER"] });
    const buyer = await makeUser();
    const { variantId } = await makeShopWithProduct(seller.id, { priceCents: 2_500, stock: 5 });

    await addToCart(buyer.auth, { variantId, quantity: 2 });

    const order = await createOrder(buyer.auth, {
      shippingName: "Test Buyer",
      shippingLine1: "1 Test Street",
      shippingCity: "Cairo",
      shippingCountry: "Egypt",
    });

    // 2 x 2500 + 500 shipping
    expect(order.totalCents).toBe(5_500);

    const payment = await createPayment({
      userId: buyer.id,
      purpose: "PRODUCT_ORDER",
      referenceType: "ORDER",
      referenceId: order.id,
      amountCents: order.totalCents,
      currency: order.currency,
      description: "test order",
      idempotencyKey: `test-${order.id}`,
      returnUrl: "/",
    });

    await confirmPayment({ intentId: payment.id, actorId: buyer.id, viaSandbox: true });

    const settled = await db.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true, platformFeeCents: true, items: { select: { sellerEarningsCents: true, commissionCents: true } } },
    });

    expect(settled.status).toBe("PAID");

    // Commission plus seller earnings must reconstruct the item total exactly.
    const item = settled.items[0]!;
    expect(item.commissionCents + item.sellerEarningsCents).toBe(5_000);

    const check = await assertLedgerBalanced();
    expect(check.ok).toBe(true);
    expect(check.unbalanced).toHaveLength(0);
  });

  it("is exactly-once under a replayed confirmation", async () => {
    const seller = await makeUser({ roles: ["USER", "SELLER"] });
    const buyer = await makeUser();
    const { variantId } = await makeShopWithProduct(seller.id, { priceCents: 1_000, stock: 5 });

    await addToCart(buyer.auth, { variantId, quantity: 1 });
    const order = await createOrder(buyer.auth, {
      shippingName: "Test Buyer",
      shippingLine1: "1 Test Street",
      shippingCity: "Cairo",
      shippingCountry: "Egypt",
    });

    const payment = await createPayment({
      userId: buyer.id,
      purpose: "PRODUCT_ORDER",
      referenceType: "ORDER",
      referenceId: order.id,
      amountCents: order.totalCents,
      currency: order.currency,
      description: "test order",
      idempotencyKey: `test-replay-${order.id}`,
      returnUrl: "/",
    });

    const first = await confirmPayment({ intentId: payment.id, actorId: buyer.id, viaSandbox: true });
    const second = await confirmPayment({ intentId: payment.id, actorId: buyer.id, viaSandbox: true });

    expect(first.alreadySettled).toBe(false);
    expect(second.alreadySettled).toBe(true);

    // One settlement means one charge transaction, not two.
    const charges = await db.ledgerTransaction.count({
      where: { kind: "CHARGE", referenceId: order.id },
    });
    expect(charges).toBe(1);

    const check = await assertLedgerBalanced();
    expect(check.ok).toBe(true);
  });

  it("returns the same intent for a repeated idempotency key", async () => {
    const buyer = await makeUser();

    const key = `stable-key-${Date.now()}`;
    const first = await createPayment({
      userId: buyer.id,
      purpose: "WALLET_TOPUP",
      referenceType: "USER",
      referenceId: buyer.id,
      amountCents: 1_000,
      currency: "USD",
      description: "top up",
      idempotencyKey: key,
      returnUrl: "/",
    });

    const second = await createPayment({
      userId: buyer.id,
      purpose: "WALLET_TOPUP",
      referenceType: "USER",
      referenceId: buyer.id,
      amountCents: 1_000,
      currency: "USD",
      description: "top up",
      idempotencyKey: key,
      returnUrl: "/",
    });

    expect(second.id).toBe(first.id);
    expect(await db.paymentIntent.count()).toBe(1);
  });

  it("rejects a repeated key from a different user", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const key = `shared-key-${Date.now()}`;

    await createPayment({
      userId: a.id,
      purpose: "WALLET_TOPUP",
      referenceType: "USER",
      referenceId: a.id,
      amountCents: 1_000,
      currency: "USD",
      description: "top up",
      idempotencyKey: key,
      returnUrl: "/",
    });

    await expect(
      createPayment({
        userId: b.id,
        purpose: "WALLET_TOPUP",
        referenceType: "USER",
        referenceId: b.id,
        amountCents: 1_000,
        currency: "USD",
        description: "top up",
        idempotencyKey: key,
        returnUrl: "/",
      }),
    ).rejects.toThrow();
  });
});

describe("pet purchase escrow", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("holds funds in escrow, then releases them and transfers ownership", async () => {
    const seller = await makeUser();
    const buyer = await makeUser();
    const pet = await makePet(seller.id, { name: "Escrow Dog" });
    const listing = await makeListing(seller.id, pet.id, { priceCents: 100_000 });

    const order = await createPetOrder(buyer.auth, listing.id);
    expect(order.amountCents).toBe(100_000);

    const payment = await createPayment({
      userId: buyer.id,
      purpose: "PET_PURCHASE",
      referenceType: "PET_ORDER",
      referenceId: order.id,
      amountCents: order.amountCents,
      currency: order.currency,
      description: "pet purchase",
      idempotencyKey: `escrow-${order.id}`,
      returnUrl: "/",
    });

    await confirmPayment({ intentId: payment.id, actorId: buyer.id, viaSandbox: true });

    // In escrow: neither party has the money.
    const held = await db.petOrder.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true, autoReleaseAt: true, sellerPayoutCents: true },
    });
    expect(held.status).toBe("IN_ESCROW");
    expect(held.autoReleaseAt).not.toBeNull();
    expect(await getBalance(accounts.escrow())).toBe(100_000);
    expect(await getBalance(accounts.userAvailable(seller.id))).toBe(0);

    // One-sided confirmation must not release anything.
    const partial = await confirmHandover(buyer.auth, order.id);
    expect(partial.bothConfirmed).toBe(false);
    expect(await getBalance(accounts.escrow())).toBe(100_000);

    // Both sides confirm: money moves, ownership moves.
    const complete = await confirmHandover(seller.auth, order.id);
    expect(complete.bothConfirmed).toBe(true);

    expect(await getBalance(accounts.escrow())).toBe(0);
    expect(await getBalance(accounts.userAvailable(seller.id))).toBe(held.sellerPayoutCents);

    const transferred = await db.pet.findUniqueOrThrow({
      where: { id: pet.id },
      select: { ownerId: true, status: true },
    });
    expect(transferred.ownerId).toBe(buyer.id);

    const transfer = await db.petTransfer.findFirst({
      where: { petId: pet.id },
      select: { fromUserId: true, toUserId: true, status: true },
    });
    expect(transfer).toMatchObject({
      fromUserId: seller.id,
      toUserId: buyer.id,
      status: "ACCEPTED",
    });

    const check = await assertLedgerBalanced();
    expect(check.ok).toBe(true);
  });

  it("refuses a second buyer while funds are in escrow", async () => {
    const seller = await makeUser();
    const buyerA = await makeUser();
    const buyerB = await makeUser();
    const pet = await makePet(seller.id);
    const listing = await makeListing(seller.id, pet.id, { priceCents: 50_000 });

    const order = await createPetOrder(buyerA.auth, listing.id);
    const payment = await createPayment({
      userId: buyerA.id,
      purpose: "PET_PURCHASE",
      referenceType: "PET_ORDER",
      referenceId: order.id,
      amountCents: order.amountCents,
      currency: order.currency,
      description: "pet purchase",
      idempotencyKey: `contest-${order.id}`,
      returnUrl: "/",
    });
    await confirmPayment({ intentId: payment.id, actorId: buyerA.id, viaSandbox: true });

    // Escrow moves the listing to RESERVED, so the second buyer is stopped by
    // the availability guard before the escrow guard is even reached. Either
    // way the invariant that matters holds: one live order per pet.
    await expect(createPetOrder(buyerB.auth, listing.id)).rejects.toThrow(
      /no longer available|already completing a purchase/i,
    );

    const orders = await db.petOrder.count({ where: { listingId: listing.id } });
    expect(orders).toBe(1);
  });

  it("will not let a seller buy their own listing", async () => {
    const seller = await makeUser();
    const pet = await makePet(seller.id);
    const listing = await makeListing(seller.id, pet.id);

    await expect(createPetOrder(seller.auth, listing.id)).rejects.toThrow(/your own listing/i);
  });
});

describe("refunds", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("cannot refund more than was paid, and keeps the book balanced", async () => {
    const staff = await makeUser({ roles: ["USER", "ADMIN"] });
    const buyer = await makeUser();

    const payment = await createPayment({
      userId: buyer.id,
      purpose: "WALLET_TOPUP",
      referenceType: "USER",
      referenceId: buyer.id,
      amountCents: 10_000,
      currency: "USD",
      description: "top up",
      idempotencyKey: `refund-test-${Date.now()}`,
      returnUrl: "/",
    });

    await confirmPayment({ intentId: payment.id, actorId: buyer.id, viaSandbox: true });

    await refundPayment({
      intentId: payment.id,
      amountCents: 4_000,
      reason: "REQUESTED_BY_CUSTOMER",
      approvedById: staff.id,
      idempotencyKey: `refund-a-${payment.id}`,
    });

    const partial = await db.paymentIntent.findUniqueOrThrow({
      where: { id: payment.id },
      select: { status: true, refundedCents: true },
    });
    expect(partial.status).toBe("PARTIALLY_REFUNDED");
    expect(partial.refundedCents).toBe(4_000);

    // Only 6,000 remains refundable.
    await expect(
      refundPayment({
        intentId: payment.id,
        amountCents: 7_000,
        reason: "REQUESTED_BY_CUSTOMER",
        approvedById: staff.id,
        idempotencyKey: `refund-b-${payment.id}`,
      }),
    ).rejects.toThrow(/can still be refunded/i);

    const check = await assertLedgerBalanced();
    expect(check.ok).toBe(true);
  });

  it("is idempotent on a repeated refund key", async () => {
    const staff = await makeUser({ roles: ["USER", "ADMIN"] });
    const buyer = await makeUser();

    const payment = await createPayment({
      userId: buyer.id,
      purpose: "WALLET_TOPUP",
      referenceType: "USER",
      referenceId: buyer.id,
      amountCents: 5_000,
      currency: "USD",
      description: "top up",
      idempotencyKey: `refund-idem-${Date.now()}`,
      returnUrl: "/",
    });
    await confirmPayment({ intentId: payment.id, actorId: buyer.id, viaSandbox: true });

    const key = `refund-same-key-${payment.id}`;
    const first = await refundPayment({
      intentId: payment.id,
      amountCents: 1_000,
      reason: "DUPLICATE",
      approvedById: staff.id,
      idempotencyKey: key,
    });
    const second = await refundPayment({
      intentId: payment.id,
      amountCents: 1_000,
      reason: "DUPLICATE",
      approvedById: staff.id,
      idempotencyKey: key,
    });

    expect(second.refundId).toBe(first.refundId);
    expect(await db.refund.count({ where: { paymentIntentId: payment.id } })).toBe(1);
  });
});
