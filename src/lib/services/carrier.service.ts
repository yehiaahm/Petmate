import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { badRequest, conflict } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { AuthContext } from "@/lib/auth/session";
import { assertOwnsShop } from "@/lib/auth/rbac";
import { seal, open } from "@/lib/auth/secret-box";
import { clientEnv } from "@/lib/env";
import { distributeCents } from "@/lib/money";
import { normalizePhone } from "@/lib/phone";
import type { DeliveryStatus } from "@/lib/constants";
import { createBostaDelivery, fetchBostaDelivery, mapBostaState, verifyBostaKey, BostaError } from "@/lib/delivery/bosta";
import { applyStatusChange, completeDelivery, deliveryStatusTitle } from "./delivery.service";
import { notify } from "./notification.service";

/**
 * Parcels booked with a courier company (Bosta) instead of delivered by the
 * shop itself.
 *
 * Booking happens in the background once an order reaches the shop, so a
 * slow courier API never holds up a checkout; a failure is recorded on the
 * parcel and retried, and the shop can see why. From then on Bosta tells us
 * where the parcel is by webhook, and each update goes through the same
 * status logic as a manual one — including settling cash on delivery when
 * Bosta reports the parcel delivered. Bosta's courier confirms the handover,
 * so these parcels do not use PetMate's own door code.
 */

const SEAL_PURPOSE = "bosta-api-key";
const TERMINAL: DeliveryStatus[] = ["DELIVERED", "RETURNED", "CANCELLED"];

export const bostaWebhookUrl = (shopId: string) => `${clientEnv.NEXT_PUBLIC_APP_URL}/api/webhooks/bosta/${shopId}`;

export async function connectBosta(auth: AuthContext, shopId: string, apiKey: string) {
  await assertOwnsShop(shopId, auth);
  const key = apiKey.trim();
  if (key.length < 20) throw badRequest("That does not look like a Bosta API key.");
  let valid: boolean;
  try {
    valid = await verifyBostaKey(key);
  } catch (e) {
    logger.exception("bosta key check failed", e, { shopId });
    throw badRequest("We could not reach Bosta to check that key. Try again in a minute.");
  }
  if (!valid) throw badRequest("Bosta did not accept that API key.");

  const webhookSecret = randomBytes(24).toString("base64url");
  await db.shop.update({
    where: { id: shopId },
    data: { shippingProvider: "BOSTA", bostaApiKey: seal(key, SEAL_PURPOSE), bostaWebhookSecret: webhookSecret },
  });
  await audit({ action: "shop.courier_connected", actorId: auth.user.id, entityType: "SHOP", entityId: shopId, summary: "BOSTA" });
  return { webhookUrl: bostaWebhookUrl(shopId), webhookSecret };
}

export async function disconnectBosta(auth: AuthContext, shopId: string) {
  await assertOwnsShop(shopId, auth);
  await db.shop.update({
    where: { id: shopId },
    data: { shippingProvider: "INTERNAL", bostaApiKey: null, bostaWebhookSecret: null },
  });
  await audit({ action: "shop.courier_disconnected", actorId: auth.user.id, entityType: "SHOP", entityId: shopId, summary: "BOSTA" });
  return { provider: "INTERNAL" };
}

export async function getCourierSettings(auth: AuthContext, shopId: string) {
  await assertOwnsShop(shopId, auth);
  const shop = await db.shop.findUniqueOrThrow({
    where: { id: shopId },
    select: { shippingProvider: true, bostaWebhookSecret: true },
  });
  return {
    provider: shop.shippingProvider,
    webhookUrl: bostaWebhookUrl(shopId),
    webhookSecret: shop.shippingProvider === "BOSTA" ? shop.bostaWebhookSecret : null,
  };
}

/**
 * Books one parcel with Bosta. Run by the `delivery.book` job; safe to run
 * again, because a parcel that already has a Bosta tracking number is left alone.
 */
export async function bookCarrierShipment(deliveryId: string): Promise<"booked" | "skipped"> {
  const delivery = await db.delivery.findUnique({
    where: { id: deliveryId },
    select: {
      id: true,
      status: true,
      shopId: true,
      orderId: true,
      carrierTracking: true,
      shop: { select: { shippingProvider: true, bostaApiKey: true, name: true } },
      order: {
        select: {
          orderNumber: true,
          paymentMethod: true,
          shippingName: true,
          shippingPhone: true,
          shippingLine1: true,
          shippingLine2: true,
          shippingCity: true,
          shippingNote: true,
          shippingCents: true,
          buyer: { select: { email: true, phone: true, phoneVerifiedAt: true } },
          items: { select: { shopId: true, totalCents: true, discountCents: true, quantity: true, titleSnapshot: true, fulfillmentStatus: true } },
        },
      },
    },
  });
  if (!delivery || delivery.carrierTracking || delivery.status !== "PENDING") return "skipped";
  if (delivery.shop.shippingProvider !== "BOSTA" || !delivery.shop.bostaApiKey) return "skipped";

  const order = delivery.order;
  const items = order.items.filter((i) => i.shopId === delivery.shopId && i.fulfillmentStatus !== "CANCELLED");
  const phone =
    normalizePhone(order.shippingPhone ?? "") ??
    (order.buyer.phoneVerifiedAt && order.buyer.phone ? order.buyer.phone : null);
  if (!phone) {
    await db.delivery.update({ where: { id: deliveryId }, data: { bookingError: "The buyer gave no valid mobile number." } });
    return "skipped";
  }

  // This shop's share of the cash to collect: its goods and shipping, less its
  // part of any coupon — the same figure the COD settlement uses.
  let codCents = 0;
  if (order.paymentMethod === "COD") {
    const shopIds = [...new Set(order.items.map((i) => i.shopId))];
    const totals = shopIds.map((id) => order.items.filter((i) => i.shopId === id).reduce((a, i) => a + i.totalCents, 0));
    const shipping = distributeCents(order.shippingCents, totals)[shopIds.indexOf(delivery.shopId)] ?? 0;
    codCents = items.reduce((a, i) => a + i.totalCents - i.discountCents, 0) + shipping;
  }

  try {
    const shipment = await createBostaDelivery(open(delivery.shop.bostaApiKey, SEAL_PURPOSE), {
      businessReference: `${order.orderNumber}-${delivery.id.slice(-6)}`,
      receiver: { name: order.shippingName, phone, email: order.buyer.email },
      address: { city: order.shippingCity, line1: order.shippingLine1, line2: order.shippingLine2 },
      codCents,
      itemsCount: items.reduce((a, i) => a + i.quantity, 0),
      description: items.map((i) => i.titleSnapshot).join(", "),
      notes: order.shippingNote,
    });

    await db.$transaction(async (tx) => {
      await tx.delivery.update({
        where: { id: deliveryId },
        data: { provider: "BOSTA", carrierRef: shipment.id, carrierTracking: shipment.trackingNumber, bookingError: null },
      });
      await tx.deliveryEvent.create({
        data: { deliveryId, status: "PENDING", note: `Booked with Bosta, tracking ${shipment.trackingNumber}` },
      });
    });
    return "booked";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.delivery.update({ where: { id: deliveryId }, data: { bookingError: message.slice(0, 300) } });
    // A rejected request (bad address, bad phone) will not fix itself; anything
    // else is thrown so the job retries it.
    if (e instanceof BostaError && e.permanent) return "skipped";
    throw e;
  }
}

/**
 * Applies a courier's status to our parcel. Unknown states are recorded but
 * move nothing, a finished parcel never moves again, and a repeated state
 * is a no-op — so webhooks delivered twice or out of order are harmless.
 */
export async function applyCarrierState(params: {
  shopId: string;
  trackingNumber: string;
  stateCode: number | string | null;
  stateLabel?: string | null;
  reason?: string | null;
}): Promise<"applied" | "ignored" | "unknown"> {
  const delivery = await db.delivery.findFirst({
    where: { shopId: params.shopId, carrierTracking: params.trackingNumber },
    select: { id: true, status: true, orderId: true, shopId: true, trackingNumber: true, order: { select: { paymentMethod: true, buyerId: true, orderNumber: true } } },
  });
  if (!delivery) return "unknown";

  const next = mapBostaState(params.stateCode);
  const current = delivery.status as DeliveryStatus;
  const label = `${params.stateCode ?? "?"}${params.stateLabel ? ` ${params.stateLabel}` : ""}`.slice(0, 100);

  if (!next || next === current || TERMINAL.includes(current)) {
    await db.delivery.update({ where: { id: delivery.id }, data: { carrierState: label } });
    return "ignored";
  }

  await db.$transaction(async (tx) => {
    // Claim the transition: a second, simultaneous delivery of the same
    // webhook finds the status already changed and stops here.
    const moved = await tx.delivery.updateMany({
      where: { id: delivery.id, status: current },
      data: {
        carrierState: label,
        ...(next === "DELIVERED" ? { status: "DELIVERED", deliveredAt: new Date(), otpHash: null } : {}),
      },
    });
    if (moved.count === 0) return;

    if (next === "DELIVERED") {
      await completeDelivery(tx, delivery, { note: "Delivered by Bosta" });
    } else {
      await applyStatusChange(tx, delivery, next, {
        note: `Bosta: ${params.stateLabel ?? next.toLowerCase()}`,
        failureReason: next === "FAILED" ? (params.reason ?? params.stateLabel ?? undefined) : undefined,
      });
    }
  });

  await notify({
    userId: delivery.order.buyerId,
    category: "DELIVERY",
    type: `delivery.${next.toLowerCase()}`,
    title: deliveryStatusTitle(next),
    body: `Order ${delivery.order.orderNumber} · tracking ${params.trackingNumber}`,
    url: `/dashboard/orders/${delivery.orderId}`,
    entityType: "DELIVERY",
    entityId: delivery.id,
  });
  return "applied";
}

/** Checks the secret Bosta sends with every webhook against the shop's own. */
export async function authenticateBostaWebhook(shopId: string, presented: string | null): Promise<boolean> {
  if (!presented) return false;
  const shop = await db.shop.findUnique({ where: { id: shopId }, select: { bostaWebhookSecret: true } });
  const expected = shop?.bostaWebhookSecret;
  if (!expected) return false;
  const given = presented.replace(/^Bearer\s+/i, "").trim();
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/**
 * Catches up parcels whose webhooks were missed. Run by `delivery.sync`;
 * asks Bosta about parcels that have been quiet for a few hours.
 */
export async function syncCarrierShipments(limit = 100): Promise<number> {
  const stale = await db.delivery.findMany({
    where: {
      provider: "BOSTA",
      carrierTracking: { not: null },
      status: { notIn: TERMINAL },
      updatedAt: { lt: new Date(Date.now() - 3 * 3_600_000) },
    },
    select: { shopId: true, carrierTracking: true, shop: { select: { bostaApiKey: true } } },
    take: limit,
  });
  let moved = 0;
  for (const d of stale) {
    if (!d.shop.bostaApiKey || !d.carrierTracking) continue;
    try {
      const state = await fetchBostaDelivery(open(d.shop.bostaApiKey, SEAL_PURPOSE), d.carrierTracking);
      const result = await applyCarrierState({ shopId: d.shopId, trackingNumber: d.carrierTracking, stateCode: state.code, stateLabel: state.label });
      if (result === "applied") moved++;
    } catch (e) {
      logger.warn("bosta sync failed", { tracking: d.carrierTracking, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return moved;
}

/** The shop asks to try booking again after fixing the problem. */
export async function retryBooking(auth: AuthContext, deliveryId: string) {
  const delivery = await db.delivery.findUnique({ where: { id: deliveryId }, select: { shopId: true, carrierTracking: true } });
  if (!delivery) throw badRequest("That delivery could not be found.");
  await assertOwnsShop(delivery.shopId, auth);
  if (delivery.carrierTracking) throw conflict("This parcel is already booked with Bosta.");
  return { result: await bookCarrierShipment(deliveryId) };
}
