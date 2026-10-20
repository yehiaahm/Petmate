import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db, makeUser, makeShopWithProduct, resetDatabase } from "./helpers";
import { invalidateSettingsCache } from "@/lib/settings";
import { addToCart, createOrder, updateFulfillment } from "@/lib/services/commerce.service";
import { createCoupon } from "@/lib/services/coupon.service";
import {
  connectBosta,
  bookCarrierShipment,
  applyCarrierState,
  authenticateBostaWebhook,
} from "@/lib/services/carrier.service";
import { updateDeliveryStatus } from "@/lib/services/delivery.service";
import { mapBostaState, bostaCity } from "@/lib/delivery/bosta";
import { getBalance, accounts } from "@/lib/payments/ledger-core";

/**
 * Bosta is faked at the HTTP boundary; booking, webhooks and the cash-on-
 * delivery settlement they trigger all run for real.
 */

const address = { shippingName: "Mona Adel", shippingLine1: "14 Brazil Street", shippingCity: "Maadi", shippingCountry: "Egypt" };
const KEY = "bosta-test-api-key-000000000000000";

type Call = { url: string; method: string; body: Record<string, unknown> | null; auth: string | null };

function fakeBosta(opts: { failCreate?: number } = {}) {
  const calls: Call[] = [];
  let n = 0;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const call: Call = {
      url: String(url),
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(String(init.body)) : null,
      auth: new Headers(init.headers).get("authorization"),
    };
    calls.push(call);
    if (call.url.endsWith("/cities")) return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 });
    if (call.url.endsWith("/deliveries") && call.method === "POST") {
      if (opts.failCreate) return new Response(JSON.stringify({ success: false, message: "Invalid phone" }), { status: opts.failCreate });
      n++;
      return new Response(JSON.stringify({ success: true, data: { _id: `bosta-${n}`, trackingNumber: 70000 + n } }), { status: 200 });
    }
    return new Response(JSON.stringify({ success: false }), { status: 404 });
  });
  return calls;
}

async function codOrderAtBostaShop(opts: { coupon?: string } = {}) {
  const seller = await makeUser();
  const buyer = await makeUser();
  const { shopId, variantId } = await makeShopWithProduct(seller.id, { priceCents: 30_000, stock: 5 });
  await db.shop.update({ where: { id: shopId }, data: { acceptsCod: true } });
  fakeBosta();
  const { webhookSecret } = await connectBosta(seller.auth, shopId, KEY);
  await addToCart(buyer.auth, { variantId, quantity: 1 });
  const order = await createOrder(buyer.auth, {
    ...address,
    shippingPhone: "01001234567",
    paymentMethod: "COD",
    couponCode: opts.coupon,
  });
  const delivery = await db.delivery.findFirstOrThrow({ where: { orderId: order.id } });
  return { seller, buyer, shopId, order, delivery, webhookSecret };
}

beforeEach(async () => {
  await resetDatabase();
  invalidateSettingsCache();
});
afterEach(() => vi.unstubAllGlobals());

describe("mapping", () => {
  it("maps Bosta's states and leaves unknown ones alone", () => {
    expect(mapBostaState(21)).toBe("PICKED_UP");
    expect(mapBostaState("41")).toBe("OUT_FOR_DELIVERY");
    expect(mapBostaState(45)).toBe("DELIVERED");
    expect(mapBostaState(46)).toBe("RETURNED");
    expect(mapBostaState(999)).toBeNull();
    expect(mapBostaState(null)).toBeNull();
  });

  it("uses Bosta's city names for everyday and Arabic spellings", () => {
    expect(bostaCity("Maadi")).toBe("Cairo");
    expect(bostaCity("الإسكندرية")).toBe("Alexandria");
    expect(bostaCity("Kafr El Sheikh")).toBe("Kafr El Sheikh");
  });
});

describe("connecting", () => {
  it("checks the key with Bosta and stores it encrypted", async () => {
    const seller = await makeUser();
    const { shopId } = await makeShopWithProduct(seller.id);
    const calls = fakeBosta();
    const result = await connectBosta(seller.auth, shopId, KEY);
    expect(calls[0]!.auth).toBe(KEY);
    expect(result.webhookUrl).toMatch(new RegExp(`/api/webhooks/bosta/${shopId}$`));
    const shop = await db.shop.findUniqueOrThrow({ where: { id: shopId } });
    expect(shop.shippingProvider).toBe("BOSTA");
    expect(shop.bostaApiKey).not.toContain(KEY);
  });

  it("refuses someone else's shop", async () => {
    const seller = await makeUser();
    const { shopId } = await makeShopWithProduct(seller.id);
    const stranger = await makeUser();
    fakeBosta();
    await expect(connectBosta(stranger.auth, shopId, KEY)).rejects.toThrow();
  });
});

describe("booking", () => {
  it("books a cash-on-delivery parcel for the amount the shop collects", async () => {
    const staff = (await makeUser({ roles: ["ADMIN"] })).auth;
    await createCoupon(staff, { code: "TEN", kind: "FIXED", amountCents: 1_000 });
    const { delivery, order } = await codOrderAtBostaShop({ coupon: "TEN" });
    // The order queued the booking rather than calling Bosta in the checkout.
    expect(await db.job.count({ where: { type: "delivery.book" } })).toBe(1);

    const calls = fakeBosta();
    expect(await bookCarrierShipment(delivery.id)).toBe("booked");
    const create = calls.find((c) => c.url.endsWith("/deliveries"))!;
    const saved = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(create.body).toMatchObject({
      type: 10,
      cod: (saved.subtotalCents + saved.shippingCents - 1_000) / 100,
      dropOffAddress: { city: "Cairo", firstLine: "14 Brazil Street" },
      receiver: { firstName: "Mona", lastName: "Adel", phone: "+201001234567" },
    });

    const booked = await db.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(booked.provider).toBe("BOSTA");
    expect(booked.carrierTracking).toBe("70001");

    // Booking twice does not create a second Bosta parcel.
    expect(await bookCarrierShipment(delivery.id)).toBe("skipped");
  });

  it("records why Bosta refused, and does not retry a bad request", async () => {
    const { delivery } = await codOrderAtBostaShop();
    fakeBosta({ failCreate: 400 });
    expect(await bookCarrierShipment(delivery.id)).toBe("skipped");
    expect((await db.delivery.findUniqueOrThrow({ where: { id: delivery.id } })).bookingError).toMatch(/Invalid phone/);

    fakeBosta({ failCreate: 503 });
    await expect(bookCarrierShipment(delivery.id)).rejects.toThrow(/503/);
  });
});

describe("status updates", () => {
  it("authenticates webhooks with the shop's secret", async () => {
    const { shopId, webhookSecret } = await codOrderAtBostaShop();
    expect(await authenticateBostaWebhook(shopId, webhookSecret)).toBe(true);
    expect(await authenticateBostaWebhook(shopId, `Bearer ${webhookSecret}`)).toBe(true);
    expect(await authenticateBostaWebhook(shopId, "guess")).toBe(false);
    expect(await authenticateBostaWebhook(shopId, null)).toBe(false);
  });

  it("settles cash on delivery when Bosta reports it delivered, once", async () => {
    const { delivery, shopId, order, seller } = await codOrderAtBostaShop();
    fakeBosta();
    await bookCarrierShipment(delivery.id);
    const tracking = "70001";

    expect(await applyCarrierState({ shopId, trackingNumber: tracking, stateCode: 21, stateLabel: "Picked up" })).toBe("applied");
    expect((await db.delivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe("PICKED_UP");
    expect(await applyCarrierState({ shopId, trackingNumber: tracking, stateCode: 41 })).toBe("applied");

    // The seller can no longer move a Bosta parcel by hand.
    await expect(updateDeliveryStatus(seller.auth, delivery.id, "FAILED")).rejects.toThrow(/Bosta updates this parcel/);
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    await expect(updateFulfillment(seller.auth, item.id, "DELIVERED")).rejects.toThrow(/Bosta updates this parcel/);

    expect(await applyCarrierState({ shopId, trackingNumber: tracking, stateCode: 45, stateLabel: "Delivered" })).toBe("applied");
    const collection = await db.codCollection.findFirstOrThrow({ where: { orderId: order.id } });
    expect(await getBalance(accounts.sellerAvailable(shopId))).toBe(-collection.commissionCents);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("DELIVERED");

    // A repeated or late webhook changes nothing.
    expect(await applyCarrierState({ shopId, trackingNumber: tracking, stateCode: 45 })).toBe("ignored");
    expect(await applyCarrierState({ shopId, trackingNumber: tracking, stateCode: 41 })).toBe("ignored");
    expect(await db.codCollection.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("puts a returned cash-on-delivery parcel back on the shelf", async () => {
    const { delivery, shopId, order } = await codOrderAtBostaShop();
    fakeBosta();
    await bookCarrierShipment(delivery.id);
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    const before = await db.productVariant.findUniqueOrThrow({ where: { id: item.variantId } });

    await applyCarrierState({ shopId, trackingNumber: "70001", stateCode: 46, stateLabel: "Returned to business" });
    const after = await db.productVariant.findUniqueOrThrow({ where: { id: item.variantId } });
    expect(after.stock).toBe(before.stock + item.quantity);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("CANCELLED");
    expect(await db.codCollection.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("ignores parcels that are not this shop's", async () => {
    const { delivery } = await codOrderAtBostaShop();
    fakeBosta();
    await bookCarrierShipment(delivery.id);
    const other = await makeUser();
    const { shopId: otherShop } = await makeShopWithProduct(other.id);
    expect(await applyCarrierState({ shopId: otherShop, trackingNumber: "70001", stateCode: 45 })).toBe("unknown");
    expect((await db.delivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe("PENDING");
  });
});
