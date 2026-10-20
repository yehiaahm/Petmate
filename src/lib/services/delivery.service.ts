import "server-only";
import { settleCashOnDelivery } from "@/lib/payments/settlement";
import { restockItems } from "./commerce.service";
import { createHash, timingSafeEqual } from "node:crypto";
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { isStaff } from "@/lib/auth/rbac";
import type { AuthContext } from "@/lib/auth/session";
import { readableCode } from "@/lib/utils";
import { notify } from "./notification.service";
import { DELIVERY_STATUS, type DeliveryStatus } from "@/lib/constants";

/**
 * Delivery.
 *
 * PetMate does not operate a courier fleet and this module does not pretend it
 * does. It models the states a parcel actually moves through and exposes a
 * provider seam, so a real carrier integration is a new `DeliveryProvider`
 * rather than a rewrite.
 *
 * The INTERNAL provider is genuine, not a simulation: a seller or an assigned
 * courier moves the parcel through the states by hand from their dashboard, and
 * the buyer's OTP is verified at the door. That is exactly how a local
 * same-city delivery works before a carrier contract exists.
 */

export interface DeliveryProvider {
  readonly name: string;
  createShipment(params: {
    deliveryId: string;
    recipientName: string;
    addressLine: string;
    city: string;
    country: string;
    weightGrams?: number;
  }): Promise<{ carrierRef: string; trackingNumber: string }>;
  getStatus(carrierRef: string): Promise<{ status: DeliveryStatus; updatedAt: Date } | null>;
}

/**
 * Manual fulfilment. Every transition is an explicit action by a real person
 * with an audit row behind it.
 */
const internalProvider: DeliveryProvider = {
  name: "INTERNAL",
  async createShipment(params) {
    return { carrierRef: params.deliveryId, trackingNumber: `PMD-${readableCode(10)}` };
  },
  async getStatus() {
    // Status comes from our own database for this provider; there is nothing
    // external to poll, and inventing a carrier response would be a lie.
    return null;
  },
};

export function deliveryProvider(): DeliveryProvider {
  return internalProvider;
}

// ---------------------------------------------------------------------------
// Seller and courier actions
// ---------------------------------------------------------------------------

const ALLOWED_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  PENDING: ["ASSIGNED", "PICKED_UP", "CANCELLED"],
  ASSIGNED: ["PICKED_UP", "CANCELLED"],
  PICKED_UP: ["IN_TRANSIT", "FAILED", "CANCELLED"],
  IN_TRANSIT: ["OUT_FOR_DELIVERY", "FAILED", "RETURNED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "FAILED"],
  DELIVERED: [],
  FAILED: ["OUT_FOR_DELIVERY", "RETURNED", "CANCELLED"],
  RETURNED: [],
  CANCELLED: [],
};

async function assertDeliveryAccess(auth: AuthContext, deliveryId: string) {
  const delivery = await db.delivery.findUnique({
    where: { id: deliveryId },
    select: {
      id: true,
      status: true,
      shopId: true,
      courierId: true,
      orderId: true,
      trackingNumber: true,
      otpHash: true,
      otpAttempts: true,
      attemptCount: true,
      provider: true,
      carrierTracking: true,
      shop: { select: { ownerUserId: true, name: true } },
      order: { select: { id: true, buyerId: true, orderNumber: true, paymentMethod: true } },
    },
  });
  if (!delivery) throw notFound("That delivery");

  const isSeller = delivery.shop.ownerUserId === auth.user.id;
  const isCourier = delivery.courierId === auth.user.id;

  if (!isSeller && !isCourier && !isStaff(auth.user)) throw notFound("That delivery");
  return { delivery, isSeller, isCourier };
}

/** A parcel booked with a courier company moves only on the courier's word. */
function assertNotCarrierManaged(delivery: { provider: string; carrierTracking: string | null }) {
  if (delivery.provider !== "INTERNAL" && delivery.carrierTracking) {
    throw conflict("Bosta updates this parcel. To change or cancel it, use your Bosta dashboard.");
  }
}

export async function updateDeliveryStatus(
  auth: AuthContext,
  deliveryId: string,
  next: DeliveryStatus,
  extra: { note?: string; lat?: number; lng?: number; failureReason?: string } = {},
) {
  const { delivery } = await assertDeliveryAccess(auth, deliveryId);
  assertNotCarrierManaged(delivery);

  const current = delivery.status as DeliveryStatus;
  if (!ALLOWED_TRANSITIONS[current]?.includes(next)) {
    throw conflict(`A delivery cannot move from ${current.toLowerCase()} to ${next.toLowerCase()}.`);
  }

  // DELIVERED is only reachable through OTP confirmation, never by a seller
  // simply declaring it done.
  if (next === "DELIVERED") {
    throw badRequest("Confirm delivery with the recipient's code.");
  }

  await db.$transaction((tx) => applyStatusChange(tx, delivery, next, { ...extra, actorId: auth.user.id }));

  await notify({
    userId: delivery.order.buyerId,
    category: "DELIVERY",
    type: `delivery.${next.toLowerCase()}`,
    title: deliveryStatusTitle(next),
    body: `Order ${delivery.order.orderNumber} · tracking ${delivery.trackingNumber}`,
    url: `/dashboard/orders/${delivery.orderId}`,
    entityType: "DELIVERY",
    entityId: deliveryId,
  });

  return { status: next };
}

export type DeliveryForUpdate = { id: string; orderId: string; shopId: string; order: { paymentMethod: string } };

/**
 * One status change and everything that follows from it, inside the caller's
 * transaction. Shared by a person moving the parcel by hand and by a
 * carrier's status update, so both have exactly the same effects.
 */
export async function applyStatusChange(
  tx: Tx,
  delivery: DeliveryForUpdate,
  next: DeliveryStatus,
  extra: { note?: string; lat?: number; lng?: number; failureReason?: string; actorId?: string | null },
) {
  await tx.delivery.update({
    where: { id: delivery.id },
    data: {
      status: next,
      ...(next === "PICKED_UP" ? { pickedUpAt: new Date() } : {}),
      ...(next === "FAILED"
        ? {
            failedAt: new Date(),
            failureReason: extra.failureReason?.slice(0, 300) ?? null,
            attemptCount: { increment: 1 },
          }
        : {}),
      ...(extra.lat != null ? { lat: extra.lat } : {}),
      ...(extra.lng != null ? { lng: extra.lng } : {}),
    },
  });

  await tx.deliveryEvent.create({
    data: {
      deliveryId: delivery.id,
      status: next,
      note: extra.note?.slice(0, 300) ?? extra.failureReason?.slice(0, 300) ?? null,
      lat: extra.lat ?? null,
      lng: extra.lng ?? null,
      actorId: extra.actorId ?? null,
    },
  });

  if (next === "PICKED_UP" || next === "IN_TRANSIT") {
    await tx.orderItem.updateMany({
      where: { orderId: delivery.orderId, shopId: delivery.shopId },
      data: { fulfillmentStatus: "SHIPPED" },
    });
  }

  // A cash-on-delivery parcel that comes back was never paid for: the
  // shop's items go back on the shelf and there is nothing to refund.
  if (delivery.order.paymentMethod === "COD" && (next === "RETURNED" || next === "CANCELLED")) {
    const items = await tx.orderItem.findMany({
      where: { orderId: delivery.orderId, shopId: delivery.shopId, fulfillmentStatus: { not: "CANCELLED" } },
      select: { variantId: true, quantity: true },
    });
    await restockItems(tx, items);
    await tx.orderItem.updateMany({
      where: { orderId: delivery.orderId, shopId: delivery.shopId },
      data: { fulfillmentStatus: "CANCELLED" },
    });
    const live = await tx.orderItem.count({
      where: { orderId: delivery.orderId, fulfillmentStatus: { not: "CANCELLED" } },
    });
    if (live === 0) {
      await tx.order.update({
        where: { id: delivery.orderId },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: `Delivery ${next.toLowerCase()}` },
      });
    }
  }
}

/**
 * A parcel has reached the buyer: its items are delivered, and the money side
 * follows — a cash-on-delivery shop is charged its commission, an online
 * order is marked delivered once all of its parcels are.
 */
export async function completeDelivery(
  tx: Tx,
  delivery: DeliveryForUpdate,
  extra: { note: string; lat?: number; lng?: number; actorId?: string | null },
) {
  await tx.deliveryEvent.create({
    data: {
      deliveryId: delivery.id,
      status: "DELIVERED",
      note: extra.note,
      lat: extra.lat ?? null,
      lng: extra.lng ?? null,
      actorId: extra.actorId ?? null,
    },
  });

  await tx.orderItem.updateMany({
    where: { orderId: delivery.orderId, shopId: delivery.shopId },
    data: { fulfillmentStatus: "DELIVERED" },
  });

  if (delivery.order.paymentMethod === "COD") {
    // The courier has the cash; the shop's commission on it is due now.
    await settleCashOnDelivery(tx, delivery.orderId, delivery.shopId);
  } else {
    // The order is delivered only when every parcel in it is.
    const siblings = await tx.orderItem.findMany({
      where: { orderId: delivery.orderId },
      select: { fulfillmentStatus: true },
    });
    if (siblings.every((s) => s.fulfillmentStatus === "DELIVERED")) {
      await tx.order.update({ where: { id: delivery.orderId }, data: { status: "DELIVERED" } });
    }
  }
}

export function deliveryStatusTitle(status: DeliveryStatus): string {
  const titles: Record<DeliveryStatus, string> = {
    PENDING: "Your order is being prepared",
    ASSIGNED: "A courier has been assigned",
    PICKED_UP: "Your parcel has been collected",
    IN_TRANSIT: "Your parcel is on its way",
    OUT_FOR_DELIVERY: "Out for delivery today",
    DELIVERED: "Delivered",
    FAILED: "Delivery attempt unsuccessful",
    RETURNED: "Your parcel is being returned",
    CANCELLED: "Delivery cancelled",
  };
  return titles[status];
}

/**
 * Issues the one-time code to the buyer and puts the parcel out for delivery.
 * Only the hash is stored, so the code cannot be read out of the database.
 */
export async function dispatchForDelivery(auth: AuthContext, deliveryId: string) {
  const { delivery } = await assertDeliveryAccess(auth, deliveryId);
  assertNotCarrierManaged(delivery);

  if (!["PICKED_UP", "IN_TRANSIT", "FAILED"].includes(delivery.status)) {
    throw conflict("This parcel is not ready to go out for delivery.");
  }

  const code = readableCode(6);

  await db.$transaction(async (tx) => {
    await tx.delivery.update({
      where: { id: deliveryId },
      data: {
        status: "OUT_FOR_DELIVERY",
        otpHash: createHash("sha256").update(code).digest("hex"),
        otpAttempts: 0,
      },
    });
    await tx.deliveryEvent.create({
      data: { deliveryId, status: "OUT_FOR_DELIVERY", actorId: auth.user.id },
    });
  });

  await notify({
    userId: delivery.order.buyerId,
    category: "DELIVERY",
    type: "delivery.out_for_delivery",
    title: "Out for delivery today",
    body: `Give the courier this code to confirm: ${code}`,
    url: `/dashboard/orders/${delivery.orderId}`,
    entityType: "DELIVERY",
    entityId: deliveryId,
  });

  return { dispatched: true };
}

/** The courier enters the buyer's code. Proof of delivery, not a checkbox. */
export async function confirmDeliveryWithCode(
  auth: AuthContext,
  deliveryId: string,
  code: string,
  extra: { signedBy?: string; proofFileId?: string; lat?: number; lng?: number } = {},
) {
  const { delivery } = await assertDeliveryAccess(auth, deliveryId);

  if (delivery.status !== "OUT_FOR_DELIVERY") {
    throw conflict("This parcel is not out for delivery.");
  }
  if (!delivery.otpHash) throw conflict("No delivery code has been issued.");

  // Brute force on a 6-character code is cheap without a limit.
  if (delivery.otpAttempts >= 5) {
    throw forbidden("Too many incorrect codes. Contact support to continue.");
  }

  const provided = createHash("sha256").update(code.trim().toUpperCase()).digest();
  const expected = Buffer.from(delivery.otpHash, "hex");
  const matches = provided.length === expected.length && timingSafeEqual(provided, expected);

  if (!matches) {
    await db.delivery.update({
      where: { id: deliveryId },
      data: { otpAttempts: { increment: 1 } },
    });
    throw badRequest("That code is not correct.");
  }

  await db.$transaction(async (tx) => {
    const claimed = await tx.delivery.updateMany({
      where: { id: deliveryId, status: "OUT_FOR_DELIVERY" },
      data: {
        status: "DELIVERED",
        deliveredAt: new Date(),
        signedBy: extra.signedBy?.slice(0, 120) ?? null,
        proofFileId: extra.proofFileId ?? null,
        otpHash: null,
        ...(extra.lat != null ? { lat: extra.lat } : {}),
        ...(extra.lng != null ? { lng: extra.lng } : {}),
      },
    });
    if (claimed.count === 0) throw conflict("This delivery has already been completed.");

    await completeDelivery(tx, delivery, {
      note: extra.signedBy ? `Signed by ${extra.signedBy}` : "Confirmed with recipient code",
      lat: extra.lat,
      lng: extra.lng,
      actorId: auth.user.id,
    });
  });

  await audit({
    action: "order.fulfilled",
    actorId: auth.user.id,
    entityType: "DELIVERY",
    entityId: deliveryId,
    summary: "Delivered and confirmed by recipient code",
  });

  await notify({
    userId: delivery.order.buyerId,
    category: "DELIVERY",
    type: "delivery.delivered",
    title: "Delivered",
    body: `Order ${delivery.order.orderNumber} has arrived. How was it?`,
    url: `/dashboard/orders/${delivery.orderId}`,
    entityType: "DELIVERY",
    entityId: deliveryId,
  });

  return { delivered: true };
}

export async function assignCourier(auth: AuthContext, deliveryId: string, courierId: string) {
  const { delivery, isSeller } = await assertDeliveryAccess(auth, deliveryId);
  if (!isSeller && !isStaff(auth.user)) throw forbidden("Only the seller can assign a courier.");

  const courier = await db.user.findFirst({
    where: { id: courierId, deletedAt: null, status: "ACTIVE", roles: { some: { role: "COURIER" } } },
    select: { id: true, name: true },
  });
  if (!courier) throw badRequest("That member is not registered as a courier.");

  await db.$transaction(async (tx) => {
    await tx.delivery.update({
      where: { id: deliveryId },
      data: { courierId, status: "ASSIGNED", assignedAt: new Date() },
    });
    await tx.deliveryEvent.create({
      data: { deliveryId, status: "ASSIGNED", note: `Assigned to ${courier.name}`, actorId: auth.user.id },
    });
  });

  await notify({
    userId: courierId,
    category: "DELIVERY",
    type: "delivery.assigned",
    title: "New delivery assigned",
    body: `${delivery.shop.name} — ${delivery.trackingNumber}`,
    url: "/courier",
    entityType: "DELIVERY",
    entityId: deliveryId,
  });
}

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

export async function trackDelivery(trackingNumber: string, viewerId?: string) {
  const delivery = await db.delivery.findUnique({
    where: { trackingNumber },
    select: {
      id: true,
      trackingNumber: true,
      status: true,
      provider: true,
      recipientName: true,
      city: true,
      country: true,
      assignedAt: true,
      pickedUpAt: true,
      deliveredAt: true,
      attemptCount: true,
      failureReason: true,
      orderId: true,
      order: { select: { buyerId: true, orderNumber: true } },
      shop: { select: { name: true, slug: true } },
      courier: { select: { name: true, avatarUrl: true } },
      events: {
        orderBy: { createdAt: "asc" },
        select: { status: true, note: true, createdAt: true },
      },
    },
  });
  if (!delivery) throw notFound("That tracking number");

  const isBuyer = viewerId === delivery.order.buyerId;

  return {
    trackingNumber: delivery.trackingNumber,
    status: delivery.status,
    statusLabel: deliveryStatusTitle(delivery.status as DeliveryStatus),
    // A tracking number is semi-public: someone with the number can see the
    // progress, but the full name and address stay with the buyer.
    recipientName: isBuyer ? delivery.recipientName : maskName(delivery.recipientName),
    destination: `${delivery.city}, ${delivery.country}`,
    shop: delivery.shop,
    courier: delivery.courier,
    orderNumber: isBuyer ? delivery.order.orderNumber : null,
    orderId: isBuyer ? delivery.orderId : null,
    timeline: delivery.events.map((e) => ({
      status: e.status,
      label: deliveryStatusTitle(e.status as DeliveryStatus),
      note: e.note,
      at: e.createdAt,
    })),
    attemptCount: delivery.attemptCount,
    failureReason: isBuyer ? delivery.failureReason : null,
    deliveredAt: delivery.deliveredAt,
  };
}

function maskName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.map((p) => `${p[0]?.toUpperCase() ?? ""}${"*".repeat(Math.max(1, p.length - 1))}`).join(" ");
}

export async function listShopDeliveries(auth: AuthContext, shopId: string) {
  const shop = await db.shop.findFirst({
    where: { id: shopId, ownerUserId: auth.user.id, deletedAt: null },
    select: { id: true },
  });
  if (!shop && !isStaff(auth.user)) throw notFound("That shop");

  return db.delivery.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      trackingNumber: true,
      status: true,
      recipientName: true,
      city: true,
      country: true,
      createdAt: true,
      deliveredAt: true,
      courier: { select: { id: true, name: true } },
      order: { select: { id: true, orderNumber: true, buyer: { select: { name: true } } } },
    },
  });
}

export async function listCourierDeliveries(auth: AuthContext) {
  if (!auth.user.roles.includes("COURIER") && !isStaff(auth.user)) {
    throw forbidden("This area is for couriers.");
  }

  return db.delivery.findMany({
    where: {
      courierId: auth.user.id,
      status: { in: ["ASSIGNED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "FAILED"] },
    },
    orderBy: { assignedAt: "asc" },
    select: {
      id: true,
      trackingNumber: true,
      status: true,
      recipientName: true,
      addressLine: true,
      city: true,
      country: true,
      lat: true,
      lng: true,
      attemptCount: true,
      shop: { select: { name: true } },
      order: { select: { orderNumber: true, shippingPhone: true } },
    },
  });
}

export { DELIVERY_STATUS };
