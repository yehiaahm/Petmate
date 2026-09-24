import { describe, it, expect, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { db, makeUser, makeShopWithProduct, resetDatabase, subscribeUser } from "./helpers";
import { resetEnvForTests } from "@/lib/env";
import { invalidateSettingsCache, getSettings } from "@/lib/settings";
import {
  paymobHmacMessage,
  verifyPaymobHmac,
  paymobProvider,
} from "@/lib/payments/provider";
import { handleProviderWebhook } from "@/lib/payments/webhooks";
import { createPayment } from "@/lib/payments/service";
import { addToCart, createOrder, cancelOrder, getCart, updateFulfillment } from "@/lib/services/commerce.service";
import {
  updateDeliveryStatus,
  dispatchForDelivery,
  confirmDeliveryWithCode,
} from "@/lib/services/delivery.service";
import { getBalance, accounts } from "@/lib/payments/ledger-core";
import { applyBps } from "@/lib/money";

const address = {
  shippingName: "Mona Adel",
  shippingLine1: "14 Brazil Street",
  shippingCity: "Cairo",
  shippingCountry: "Egypt",
};

async function ledgerSum(): Promise<number> {
  return (await db.ledgerEntry.aggregate({ _sum: { amountCents: true } }))._sum.amountCents ?? 0;
}

// ---------------------------------------------------------------------------
// Paymob signatures
// ---------------------------------------------------------------------------

describe("Paymob HMAC", () => {
  // Paymob's own worked example.
  const sample = {
    amount_cents: 100,
    created_at: "2020-03-25T18:39:44.719228",
    currency: "EGP",
    error_occured: false,
    has_parent_transaction: false,
    id: 2556706,
    integration_id: 6741,
    is_3d_secure: true,
    is_auth: false,
    is_capture: false,
    is_refunded: false,
    is_standalone_payment: true,
    is_voided: false,
    order: { id: 4778239 },
    owner: 4705,
    pending: false,
    source_data: { pan: "2346", sub_type: "MasterCard", type: "card" },
    success: true,
  };

  it("concatenates exactly the fields Paymob documents, in its order", () => {
    expect(paymobHmacMessage(sample)).toBe(
      "1002020-03-25T18:39:44.719228EGPfalsefalse25567066741truefalsefalsefalsetruefalse47782394705false2346MasterCardcardtrue",
    );
  });

  it("accepts the right signature and rejects anything else", () => {
    const secret = "merchant-hmac-secret";
    const good = createHmac("sha512", secret).update(paymobHmacMessage(sample)).digest("hex");
    expect(verifyPaymobHmac(sample, good, secret)).toBe(true);
    expect(verifyPaymobHmac(sample, good.toUpperCase(), secret)).toBe(true);
    expect(verifyPaymobHmac(sample, good, "another-secret")).toBe(false);
    expect(verifyPaymobHmac({ ...sample, amount_cents: 1 }, good, secret)).toBe(false);
    expect(verifyPaymobHmac(sample, null, secret)).toBe(false);
    expect(verifyPaymobHmac(sample, "short", secret)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Paymob end to end, with the network replaced
// ---------------------------------------------------------------------------

describe("Paymob checkout", () => {
  const HMAC = "test-hmac-secret";
  const saved: Record<string, string | undefined> = {};
  const keys = ["PAYMENT_PROVIDER", "PAYMOB_SECRET_KEY", "PAYMOB_PUBLIC_KEY", "PAYMOB_HMAC_SECRET", "PAYMOB_INTEGRATION_IDS"];
  const realFetch = globalThis.fetch;
  let calls: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  let nextOrderId = 900_000;

  beforeAll(() => {
    for (const k of keys) saved[k] = process.env[k];
    Object.assign(process.env, {
      PAYMENT_PROVIDER: "paymob",
      PAYMOB_SECRET_KEY: "egy_sk_test_secret",
      PAYMOB_PUBLIC_KEY: "egy_pk_test_public",
      PAYMOB_HMAC_SECRET: HMAC,
      PAYMOB_INTEGRATION_IDS: "111, 222",
    });
    resetEnvForTests();

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? "{}"));
      calls.push({ url, init: init!, body });
      if (url.endsWith("/v1/intention/")) {
        nextOrderId += 1;
        return new Response(
          JSON.stringify({ id: `int_${nextOrderId}`, client_secret: `csk_test_${nextOrderId}`, intention_order_id: nextOrderId }),
          { status: 201 },
        );
      }
      if (url.endsWith("/api/acceptance/void_refund/refund")) {
        return new Response(JSON.stringify({ id: 7_000_001, success: true, pending: false }), { status: 200 });
      }
      return new Response("not mocked", { status: 500 });
    }) as typeof fetch;
  });

  afterAll(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetEnvForTests();
    globalThis.fetch = realFetch;
  });

  beforeEach(async () => {
    await resetDatabase();
    calls = [];
  });

  async function paidOrderSetup() {
    const seller = await makeUser();
    const buyer = await makeUser({ name: "Mona Adel" });
    await db.user.update({ where: { id: buyer.id }, data: { phone: "+201001234567" } });
    const { shopId, variantId } = await makeShopWithProduct(seller.id, { priceCents: 25_000, stock: 5 });
    await addToCart(buyer.auth, { variantId, quantity: 2 });
    const order = await createOrder(buyer.auth, address);
    const payment = await createPayment({
      userId: buyer.id,
      purpose: "PRODUCT_ORDER",
      referenceType: "ORDER",
      referenceId: order.id,
      amountCents: order.totalCents,
      currency: order.currency,
      description: `Order ${order.orderNumber}`,
      idempotencyKey: `order:${order.id}:test`,
      returnUrl: `http://localhost:3000/dashboard/orders/${order.id}`,
    });
    return { seller, buyer, shopId, order, payment };
  }

  function callback(orderRef: string, overrides: Record<string, unknown> = {}) {
    const obj = {
      amount_cents: 0,
      created_at: "2026-09-24T12:00:00.000000",
      currency: "EGP",
      error_occured: false,
      has_parent_transaction: false,
      id: 5_550_001,
      integration_id: 111,
      is_3d_secure: true,
      is_auth: false,
      is_capture: false,
      is_refunded: false,
      is_standalone_payment: true,
      is_voided: false,
      order: { id: Number(orderRef), merchant_order_id: "ref" },
      owner: 4705,
      pending: false,
      source_data: { pan: "2346", sub_type: "MasterCard", type: "card" },
      success: true,
      ...overrides,
    };
    const hmac = createHmac("sha512", HMAC).update(paymobHmacMessage(obj)).digest("hex");
    return { body: JSON.stringify({ type: "TRANSACTION", obj }), hmac };
  }

  it("creates an intention with the account's details and sends the buyer to Unified Checkout", async () => {
    const { payment, order } = await paidOrderSetup();

    const intention = calls.find((c) => c.url.endsWith("/v1/intention/"))!;
    expect(intention.url).toBe("https://accept.paymob.com/v1/intention/");
    expect((intention.init.headers as Record<string, string>).Authorization).toBe("Token egy_sk_test_secret");
    expect(intention.body).toMatchObject({
      amount: order.totalCents,
      currency: "EGP",
      payment_methods: [111, 222],
      notification_url: "http://localhost:3000/api/webhooks/paymob",
      redirection_url: `http://localhost:3000/dashboard/orders/${order.id}`,
      billing_data: { first_name: "Mona", last_name: "Adel", phone_number: "+201001234567", country: "EGY" },
    });
    expect(String(intention.body.special_reference)).toMatch(/^pm_[0-9a-f]{32}$/);
    // Paymob rejects an intention whose items do not add up to the amount.
    const items = intention.body.items as { amount: number; quantity: number }[];
    expect(items.reduce((a, i) => a + i.amount * i.quantity, 0)).toBe(order.totalCents);

    expect(payment.provider).toBe("paymob");
    expect(payment.redirectUrl).toBe(
      `https://accept.paymob.com/unifiedcheckout/?publicKey=egy_pk_test_public&clientSecret=csk_test_${nextOrderId}`,
    );
  });

  it("settles on a signed callback, once, and keeps the transaction id for refunds", async () => {
    const { payment, order, shopId } = await paidOrderSetup();
    const intent = await db.paymentIntent.findUniqueOrThrow({ where: { id: payment.id } });

    const { body, hmac } = callback(intent.providerRef!, { amount_cents: order.totalCents });
    const first = await handleProviderWebhook(paymobProvider, body, hmac);
    expect(first.status).toBe(200);

    const settled = await db.paymentIntent.findUniqueOrThrow({ where: { id: payment.id } });
    expect(settled.status).toBe("SUCCEEDED");
    expect(settled.providerChargeRef).toBe("5550001");
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PAID");
    expect(await getBalance(accounts.sellerPending(shopId))).toBeGreaterThan(0);

    const replay = await handleProviderWebhook(paymobProvider, body, hmac);
    expect(await replay.json()).toMatchObject({ duplicate: true });
    expect(await ledgerSum()).toBe(0);
  });

  it("rejects an unsigned or tampered callback and never settles it", async () => {
    const { payment, order } = await paidOrderSetup();
    const intent = await db.paymentIntent.findUniqueOrThrow({ where: { id: payment.id } });
    const { body } = callback(intent.providerRef!, { amount_cents: order.totalCents });

    expect((await handleProviderWebhook(paymobProvider, body, "0".repeat(128))).status).toBe(400);
    expect((await handleProviderWebhook(paymobProvider, body, null)).status).toBe(400);
    expect((await db.paymentIntent.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("REQUIRES_PAYMENT");
  });

  it("flags a correctly signed callback for the wrong amount instead of settling it", async () => {
    const { payment, order } = await paidOrderSetup();
    const intent = await db.paymentIntent.findUniqueOrThrow({ where: { id: payment.id } });
    const { body, hmac } = callback(intent.providerRef!, { amount_cents: order.totalCents - 100 });

    expect((await handleProviderWebhook(paymobProvider, body, hmac)).status).toBe(200);
    const flagged = await db.paymentIntent.findUniqueOrThrow({ where: { id: payment.id } });
    expect(flagged.status).toBe("REQUIRES_PAYMENT");
    expect(flagged.failureCode).toBe("AMOUNT_MISMATCH");
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING_PAYMENT");
  });

  it("ignores a refund reported back as a transaction", async () => {
    const { payment, order } = await paidOrderSetup();
    const intent = await db.paymentIntent.findUniqueOrThrow({ where: { id: payment.id } });
    const { body, hmac } = callback(intent.providerRef!, { amount_cents: order.totalCents, is_refunded: true });
    await handleProviderWebhook(paymobProvider, body, hmac);
    expect((await db.paymentIntent.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("REQUIRES_PAYMENT");
  });

  it("refunds a cancelled paid order through Paymob and takes the shop's earnings back", async () => {
    const { payment, order, shopId, buyer } = await paidOrderSetup();
    const intent = await db.paymentIntent.findUniqueOrThrow({ where: { id: payment.id } });
    const { body, hmac } = callback(intent.providerRef!, { amount_cents: order.totalCents });
    await handleProviderWebhook(paymobProvider, body, hmac);

    const revenueBefore = await getBalance(accounts.platformRevenue());
    expect(await cancelOrder({ orderId: order.id, reason: "Changed my mind", actorId: buyer.id, requireBuyerId: buyer.id })).toBe(true);

    const refund = calls.find((c) => c.url.endsWith("/api/acceptance/void_refund/refund"))!;
    expect(refund.body).toEqual({ transaction_id: 5_550_001, amount_cents: order.totalCents });

    expect((await db.paymentIntent.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("REFUNDED");
    expect(await getBalance(accounts.sellerPending(shopId))).toBe(0);
    // The platform gives back its commission too: it keeps nothing on a sale that did not happen.
    expect(revenueBefore).toBeGreaterThan(0);
    expect(await getBalance(accounts.platformRevenue())).toBe(0);
    expect(await ledgerSum()).toBe(0);

    // The stock is back on the shelf.
    const product = await db.product.findFirstOrThrow({ where: { shopId } });
    expect(product.stock).toBe(5);
  });

  it("resumes the same hosted checkout when the buyer comes back", async () => {
    const { payment, order, buyer } = await paidOrderSetup();
    const again = await createPayment({
      userId: buyer.id,
      purpose: "PRODUCT_ORDER",
      referenceType: "ORDER",
      referenceId: order.id,
      amountCents: order.totalCents,
      currency: order.currency,
      description: `Order ${order.orderNumber}`,
      idempotencyKey: `order:${order.id}:test`,
      returnUrl: "http://localhost:3000/",
    });
    expect(again.id).toBe(payment.id);
    expect(again.redirectUrl).toBe(payment.redirectUrl);
    expect(calls.filter((c) => c.url.endsWith("/v1/intention/"))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Cash on delivery
// ---------------------------------------------------------------------------

describe("cash on delivery", () => {
  beforeEach(async () => {
    await resetDatabase();
    await db.platformSetting.deleteMany({ where: { key: { in: ["codEnabled", "codMaxOrderCents"] } } });
    invalidateSettingsCache();
  });

  afterEach(() => invalidateSettingsCache());

  async function codBasket(opts: { acceptsCod?: boolean; priceCents?: number; quantity?: number } = {}) {
    const seller = await makeUser();
    const buyer = await makeUser();
    const { shopId, variantId, productId } = await makeShopWithProduct(seller.id, {
      priceCents: opts.priceCents ?? 30_000,
      stock: 10,
    });
    await db.shop.update({ where: { id: shopId }, data: { acceptsCod: opts.acceptsCod ?? true } });
    await addToCart(buyer.auth, { variantId, quantity: opts.quantity ?? 1 });
    return { seller, buyer, shopId, variantId, productId };
  }

  it("is offered only when every shop takes cash and the basket is under the cap", async () => {
    const ok = await codBasket();
    expect((await getCart(ok.buyer.id)).cashOnDelivery).toEqual({ available: true, reason: null });

    const refusing = await codBasket({ acceptsCod: false });
    const cart = await getCart(refusing.buyer.id);
    expect(cart.cashOnDelivery.available).toBe(false);
    expect(cart.cashOnDelivery.reason).toMatch(/does not take cash on delivery/);
    await expect(createOrder(refusing.buyer.auth, { ...address, shippingPhone: "01001234567", paymentMethod: "COD" })).rejects.toMatchObject({
      code: "CONFLICT",
    });

    const settings = await getSettings();
    const big = await codBasket({ priceCents: settings.codMaxOrderCents + 1 });
    expect((await getCart(big.buyer.id)).cashOnDelivery.available).toBe(false);
  });

  it("needs a phone number, then goes straight to the shop with nothing on the ledger", async () => {
    const { buyer } = await codBasket();
    await expect(createOrder(buyer.auth, { ...address, paymentMethod: "COD" })).rejects.toMatchObject({ code: "UNPROCESSABLE" });

    const order = await createOrder(buyer.auth, { ...address, shippingPhone: "01001234567", paymentMethod: "COD" });
    const saved = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { deliveries: true } });
    expect(saved.status).toBe("CONFIRMED");
    expect(saved.paymentMethod).toBe("COD");
    expect(saved.deliveries).toHaveLength(1);
    expect(await db.ledgerTransaction.count({ where: { referenceId: order.id } })).toBe(0);
  });

  it("charges the shop its commission once, when the courier confirms delivery with the code", async () => {
    const { seller, buyer, shopId } = await codBasket({ quantity: 2 });
    const order = await createOrder(buyer.auth, { ...address, shippingPhone: "01001234567", paymentMethod: "COD" });
    const delivery = await db.delivery.findFirstOrThrow({ where: { orderId: order.id } });

    await updateDeliveryStatus(seller.auth, delivery.id, "PICKED_UP");
    await dispatchForDelivery(seller.auth, delivery.id);
    const note = await db.notification.findFirstOrThrow({
      where: { userId: buyer.id, body: { contains: "this code" } },
      orderBy: { createdAt: "desc" },
    });
    const code = note.body!.match(/confirm: (\S+)/)![1]!;

    await confirmDeliveryWithCode(seller.auth, delivery.id, code);

    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    const collection = await db.codCollection.findUniqueOrThrow({ where: { orderId_shopId: { orderId: order.id, shopId } } });
    expect(collection.amountCents).toBe(item.totalCents + (await db.order.findUniqueOrThrow({ where: { id: order.id } })).shippingCents);
    expect(collection.commissionCents).toBe(item.commissionCents);
    expect(await getBalance(accounts.sellerAvailable(shopId))).toBe(-item.commissionCents);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("DELIVERED");

    // Marking it delivered again from the shop's own queue changes nothing.
    await updateFulfillment(seller.auth, item.id, "DELIVERED");
    expect(await getBalance(accounts.sellerAvailable(shopId))).toBe(-item.commissionCents);
    expect(await db.codCollection.count({ where: { orderId: order.id } })).toBe(1);
    expect(await ledgerSum()).toBe(0);
  });

  it("settles when a shop that delivers its own parcels marks them delivered", async () => {
    const { seller, buyer, shopId } = await codBasket();
    const order = await createOrder(buyer.auth, { ...address, shippingPhone: "01001234567", paymentMethod: "COD" });
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } });

    await updateFulfillment(seller.auth, item.id, "PACKED");
    expect(await db.codCollection.count()).toBe(0);
    await updateFulfillment(seller.auth, item.id, "DELIVERED");
    expect(await getBalance(accounts.sellerAvailable(shopId))).toBe(-item.commissionCents);
  });

  it("puts a refused parcel back on the shelf with nothing to refund", async () => {
    const { seller, buyer, productId } = await codBasket({ quantity: 3 });
    const order = await createOrder(buyer.auth, { ...address, shippingPhone: "01001234567", paymentMethod: "COD" });
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(7);

    const delivery = await db.delivery.findFirstOrThrow({ where: { orderId: order.id } });
    await updateDeliveryStatus(seller.auth, delivery.id, "PICKED_UP");
    await updateDeliveryStatus(seller.auth, delivery.id, "FAILED", { failureReason: "Refused at the door" });
    await updateDeliveryStatus(seller.auth, delivery.id, "RETURNED");

    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(10);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("CANCELLED");
    expect(await db.ledgerEntry.count()).toBe(0);
  });

  it("can be cancelled before it ships, with nothing charged", async () => {
    const { buyer, productId } = await codBasket();
    const order = await createOrder(buyer.auth, { ...address, shippingPhone: "01001234567", paymentMethod: "COD" });
    expect(await cancelOrder({ orderId: order.id, reason: "Ordered twice", actorId: buyer.id, requireBuyerId: buyer.id })).toBe(true);
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(10);
    expect(await db.ledgerEntry.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Whose plan lowers the commission
// ---------------------------------------------------------------------------

describe("product commission discounts", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("come from the shop owner's plan, not the buyer's", async () => {
    const settings = await getSettings();

    const proSeller = await makeUser();
    await subscribeUser(proSeller.id, { commissionDiscountBps: 150 });
    const regularSeller = await makeUser();
    const proBuyer = await makeUser();
    await subscribeUser(proBuyer.id, { commissionDiscountBps: 150 });

    const pro = await makeShopWithProduct(proSeller.id, { priceCents: 10_000 });
    const regular = await makeShopWithProduct(regularSeller.id, { priceCents: 10_000 });
    await addToCart(proBuyer.auth, { variantId: pro.variantId, quantity: 1 });
    await addToCart(proBuyer.auth, { variantId: regular.variantId, quantity: 1 });
    const order = await createOrder(proBuyer.auth, address);

    const items = await db.orderItem.findMany({ where: { orderId: order.id } });
    const proItem = items.find((i) => i.shopId === pro.shopId)!;
    const regularItem = items.find((i) => i.shopId === regular.shopId)!;
    expect(proItem.commissionCents).toBe(applyBps(10_000, settings.commissionProductBps - 150));
    expect(regularItem.commissionCents).toBe(applyBps(10_000, settings.commissionProductBps));
  });
});
