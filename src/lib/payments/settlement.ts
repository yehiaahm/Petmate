import "server-only";
import { db, type Tx } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { formatMoney, distributeCents } from "@/lib/money";
import { addDays, addMonths, readableCode } from "@/lib/utils";
import { getSettings } from "@/lib/settings";
import { accounts, postTransaction } from "./ledger-core";
import { createInvoice, type InvoiceLine } from "./invoice";
import { notify } from "@/lib/services/notification.service";
import { emailTemplates } from "@/lib/email";
import { enqueueJob } from "@/lib/jobs/queue";
import { clientEnv } from "@/lib/env";
import { createHash } from "node:crypto";

/**
 * Settlement — what actually happens once money is captured.
 *
 * Each purpose runs inside one database transaction, so the business state and
 * the ledger entries either both land or neither does. There is no window in
 * which a customer has paid and the order does not exist.
 *
 * `confirmPayment` guarantees this runs at most once per intent.
 */

const url = (path: string) => `${clientEnv.NEXT_PUBLIC_APP_URL}${path}`;

export async function settlePayment(intentId: string): Promise<void> {
  const intent = await db.paymentIntent.findUnique({
    where: { id: intentId },
    select: {
      id: true,
      userId: true,
      purpose: true,
      amountCents: true,
      currency: true,
      referenceType: true,
      referenceId: true,
      user: { select: { name: true, email: true } },
    },
  });
  if (!intent) throw notFound("That payment");
  if (!intent.referenceId) {
    throw new AppError("INTERNAL", "That payment could not be completed.", {
      internal: `intent ${intentId} has no reference`,
    });
  }

  switch (intent.purpose) {
    case "PRODUCT_ORDER":
      return settleProductOrder(intent);
    case "PET_PURCHASE":
      return settlePetPurchase(intent);
    case "APPOINTMENT":
      return settleAppointment(intent);
    case "SUBSCRIPTION":
      return settleSubscription(intent);
    case "FEATURED_LISTING":
      return settleFeaturedListing(intent);
    case "AD_CAMPAIGN":
      return settleAdCampaign(intent);
    case "WALLET_TOPUP":
      return settleWalletTopUp(intent);
    case "BREEDING_FEE":
      return settleBreedingFee(intent);
    default:
      throw new AppError("INTERNAL", "That payment could not be completed.", {
        internal: `unknown purpose ${intent.purpose}`,
      });
  }
}

type SettlementIntent = {
  id: string;
  userId: string;
  amountCents: number;
  currency: string;
  referenceId: string | null;
  user: { name: string; email: string } | null;
};

// ---------------------------------------------------------------------------
// Product orders
// ---------------------------------------------------------------------------

const ORDER_FOR_FULFILMENT = {
  id: true,
  orderNumber: true,
  buyerId: true,
  status: true,
  paymentMethod: true,
  totalCents: true,
  shippingCents: true,
  subtotalCents: true,
  currency: true,
  shippingName: true,
  shippingLine1: true,
  shippingCity: true,
  shippingCountry: true,
  shippingPhone: true,
  items: {
    select: {
      id: true,
      shopId: true,
      titleSnapshot: true,
      quantity: true,
      totalCents: true,
      commissionCents: true,
      sellerEarningsCents: true,
      fulfillmentStatus: true,
    },
  },
} as const;

type FulfilmentOrder = {
  id: string;
  orderNumber: string;
  buyerId: string;
  shippingCents: number;
  totalCents: number;
  currency: string;
  shippingName: string;
  shippingLine1: string;
  shippingCity: string;
  shippingCountry: string;
  items: { id: string; shopId: string; totalCents: number; sellerEarningsCents: number; commissionCents: number }[];
};

type OrderNotification =
  | { kind: "buyer"; userId: string; orderNumber: string; total: string; itemCount: number; orderId: string; cod: boolean }
  | { kind: "seller"; userId: string; shopName: string; orderNumber: string; orderId: string; cod: boolean };

/** Each shop's share of the shipping charge, split in proportion to its part of the basket. */
function shippingByShop(order: { shippingCents: number; items: { shopId: string; totalCents: number }[] }): Map<string, number> {
  const shopIds = [...new Set(order.items.map((i) => i.shopId))];
  const totals = shopIds.map((id) => order.items.filter((i) => i.shopId === id).reduce((a, i) => a + i.totalCents, 0));
  const split = distributeCents(order.shippingCents, totals);
  return new Map(shopIds.map((id, i) => [id, split[i] ?? 0]));
}

/**
 * Hands a confirmed order to its shops: one delivery per shop (a basket from
 * three sellers is three parcels), the shops' order counts, the items opened
 * for fulfilment, and who to tell. Shared by a paid order and a cash-on-
 * delivery one, which differ only in where the money is.
 */
async function openFulfilment(tx: Tx, order: FulfilmentOrder, cod: boolean): Promise<OrderNotification[]> {
  const shopIds = [...new Set(order.items.map((i) => i.shopId))];

  for (const shopId of shopIds) {
    await tx.delivery.create({
      data: {
        orderId: order.id,
        shopId,
        trackingNumber: `PMD-${readableCode(10)}`,
        status: "PENDING",
        recipientName: order.shippingName,
        addressLine: order.shippingLine1,
        city: order.shippingCity,
        country: order.shippingCountry,
        // A placeholder until dispatch issues the real code to the buyer; only
        // hashes are ever stored.
        otpHash: createHash("sha256").update(readableCode(6)).digest("hex"),
        events: { create: { status: "PENDING", note: "Awaiting seller dispatch" } },
      },
    });
    await tx.shop.update({ where: { id: shopId }, data: { orderCount: { increment: 1 } } });
  }

  await tx.orderItem.updateMany({ where: { orderId: order.id }, data: { fulfillmentStatus: "PENDING" } });

  const sellerOwners = await tx.shop.findMany({
    where: { id: { in: shopIds } },
    select: { id: true, ownerUserId: true, name: true },
  });

  return [
    {
      kind: "buyer",
      userId: order.buyerId,
      orderNumber: order.orderNumber,
      total: formatMoney(order.totalCents, order.currency),
      itemCount: order.items.length,
      orderId: order.id,
      cod,
    },
    ...sellerOwners.map((s) => ({
      kind: "seller" as const,
      userId: s.ownerUserId,
      shopName: s.name,
      orderNumber: order.orderNumber,
      orderId: order.id,
      cod,
    })),
  ];
}

async function sendOrderNotifications(notifications: OrderNotification[]): Promise<void> {
  for (const n of notifications) {
    if (n.kind === "buyer") {
      await notify({
        userId: n.userId,
        category: "ORDER",
        type: "order.confirmed",
        title: `Order ${n.orderNumber} confirmed`,
        body: n.cod
          ? `${n.itemCount} item${n.itemCount === 1 ? "" : "s"} · pay ${n.total} in cash on delivery`
          : `${n.itemCount} item${n.itemCount === 1 ? "" : "s"} · ${n.total}`,
        url: `/dashboard/orders/${n.orderId}`,
        entityType: "ORDER",
        entityId: n.orderId,
        email: () =>
          emailTemplates.orderConfirmation({
            name: "",
            orderNumber: n.orderNumber,
            total: n.total,
            itemCount: n.itemCount,
            url: url(`/dashboard/orders/${n.orderId}`),
          }),
      });
    } else {
      await notify({
        userId: n.userId,
        category: "ORDER",
        type: "order.received",
        title: "You have a new order",
        body: n.cod
          ? `Order ${n.orderNumber} is ready to pack. The buyer pays cash on delivery.`
          : `Order ${n.orderNumber} is ready to pack.`,
        url: `/sell/orders`,
        entityType: "ORDER",
        entityId: n.orderId,
      });
    }
  }
}

async function settleProductOrder(intent: SettlementIntent): Promise<void> {
  const settings = await getSettings();

  const notifications = await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: intent.referenceId! }, select: ORDER_FOR_FULFILMENT });
    if (!order) throw notFound("That order");

    // Conditional transition: a replayed settlement finds nothing to update.
    const claimed = await tx.order.updateMany({
      where: { id: order.id, status: "PENDING_PAYMENT", paymentMethod: "ONLINE" },
      data: { status: "PAID", placedAt: new Date(), paymentIntentId: intent.id },
    });
    if (claimed.count === 0) {
      logger.warn("product order already settled", { orderId: order.id });
      return [];
    }

    // Shipping is revenue for whoever ships the parcel, split across shops in
    // proportion to their share of the basket so the cents always add up.
    const shipping = shippingByShop(order);
    const platformFee = order.items.reduce((a, i) => a + i.commissionCents, 0);

    const entries = [
      { account: accounts.external(order.currency), amountCents: -order.totalCents },
      { account: accounts.platformRevenue(order.currency), amountCents: platformFee },
    ];
    for (const [shopId, shippingShare] of shipping) {
      const earnings =
        order.items.filter((it) => it.shopId === shopId).reduce((a, it) => a + it.sellerEarningsCents, 0) + shippingShare;
      entries.push({ account: accounts.sellerPending(shopId, order.currency), amountCents: earnings });
    }

    await postTransaction(
      {
        kind: "CHARGE",
        description: `Order ${order.orderNumber}`,
        currency: order.currency,
        paymentIntentId: intent.id,
        referenceType: "ORDER",
        referenceId: order.id,
        entries,
      },
      tx,
    );

    const toSend = await openFulfilment(tx, order, false);

    const lines: InvoiceLine[] = order.items.map((i) => ({
      description: `${i.titleSnapshot} x${i.quantity}`,
      amountCents: i.totalCents,
      quantity: i.quantity,
    }));
    if (order.shippingCents > 0) lines.push({ description: "Shipping", amountCents: order.shippingCents });

    await createInvoice(
      {
        paymentIntentId: intent.id,
        userId: order.buyerId,
        totalCents: order.totalCents,
        currency: order.currency,
        lines,
        billingName: order.shippingName,
        billingAddress: `${order.shippingLine1}, ${order.shippingCity}, ${order.shippingCountry}`,
      },
      tx,
    );

    // Seller earnings clear from PENDING to AVAILABLE after the hold window.
    await enqueueJob(
      {
        type: "payouts.release",
        payload: { orderId: order.id },
        runAt: addDays(new Date(), settings.payoutHoldDays),
        uniqueKey: `payouts.release:${order.id}`,
      },
      tx,
    );

    return toSend;
  });

  await sendOrderNotifications(notifications);
}

/**
 * Takes a refund's worth of a paid product order back from the shops that
 * were credited for it, before the gateway refund is issued.
 *
 * At settlement the buyer's money was split: commission to the platform, the
 * rest (goods plus shipping) to each shop's pending balance. A refund paid
 * straight out of platform revenue would leave the shops keeping earnings on
 * a sale that was undone. So the shops' share of the refund — the refund
 * times their share of the order — is moved back to the platform, spread
 * across shops by their earnings; the platform's own share is its commission
 * being reversed. Earnings still in the hold window come back from pending,
 * cleared earnings from available (which may go into debit, netted against
 * the shop's next sales).
 *
 * Item `refundedCents` records the clawed-back earnings so that a hold
 * release that has not run yet releases only what is left.
 */
export async function clawBackOrderEarnings(
  tx: Tx,
  params: { orderId: string; refundCents: number; actorId: string; reason: string },
): Promise<void> {
  const order = await tx.order.findUnique({
    where: { id: params.orderId },
    select: {
      id: true,
      orderNumber: true,
      totalCents: true,
      shippingCents: true,
      currency: true,
      paymentMethod: true,
      items: { select: { id: true, shopId: true, totalCents: true, sellerEarningsCents: true, commissionCents: true, refundedCents: true } },
    },
  });
  if (!order || order.paymentMethod !== "ONLINE" || order.totalCents <= 0 || params.refundCents <= 0) return;

  const shipping = shippingByShop(order);
  const shopIds = [...shipping.keys()];
  const shopEarnings = shopIds.map(
    (id) =>
      order.items.filter((i) => i.shopId === id).reduce((a, i) => a + i.sellerEarningsCents, 0) + (shipping.get(id) ?? 0),
  );
  const totalEarnings = shopEarnings.reduce((a, b) => a + b, 0);
  const refund = Math.min(params.refundCents, order.totalCents);
  const clawback = Math.round((refund * totalEarnings) / order.totalCents);
  if (clawback <= 0) return;

  const perShop = distributeCents(clawback, shopEarnings);
  const released = await tx.ledgerTransaction.findFirst({
    where: { referenceType: "ORDER", referenceId: order.id, kind: "ADJUSTMENT" },
    select: { id: true },
  });

  const entries: { account: ReturnType<typeof accounts.sellerPending>; amountCents: number }[] = [];
  for (const [i, shopId] of shopIds.entries()) {
    const amount = perShop[i] ?? 0;
    if (amount <= 0) continue;
    entries.push({
      account: released ? accounts.sellerAvailable(shopId, order.currency) : accounts.sellerPending(shopId, order.currency),
      amountCents: -amount,
    });

    // Recorded against the shop's items in proportion to their earnings, so
    // a later hold release subtracts it.
    const items = order.items.filter((it) => it.shopId === shopId);
    const split = distributeCents(amount, items.map((it) => Math.max(1, it.sellerEarningsCents)));
    for (const [j, item] of items.entries()) {
      await tx.orderItem.update({
        where: { id: item.id },
        data: { refundedCents: { increment: split[j] ?? 0 } },
      });
    }
  }
  entries.push({ account: accounts.platformRevenue(order.currency), amountCents: clawback });

  await postTransaction(
    {
      kind: "ADJUSTMENT",
      description: `Earnings reversed for ${order.orderNumber} (${params.reason})`,
      currency: order.currency,
      referenceType: "ORDER_REFUND",
      referenceId: order.id,
      createdById: params.actorId,
      entries,
    },
    tx,
  );
}

// ---------------------------------------------------------------------------
// Cash on delivery
// ---------------------------------------------------------------------------

/**
 * Places a cash-on-delivery order: it goes to the shops straight away, as
 * CONFIRMED rather than PAID, because nobody has paid yet. No ledger entry is
 * written — no money has moved — until a parcel is delivered.
 */
export async function placeCashOnDeliveryOrder(orderId: string): Promise<void> {
  const notifications = await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, select: ORDER_FOR_FULFILMENT });
    if (!order) throw notFound("That order");

    const claimed = await tx.order.updateMany({
      where: { id: order.id, status: "PENDING_PAYMENT", paymentMethod: "COD" },
      data: { status: "CONFIRMED", placedAt: new Date() },
    });
    if (claimed.count === 0) return [];

    return openFulfilment(tx, order, true);
  });

  await sendOrderNotifications(notifications);
}

/**
 * One shop's part of a COD order has been delivered, so the shop (or its
 * courier) holds the buyer's cash — goods, plus that shop's share of the
 * shipping. The platform's commission on it is charged against the shop's
 * balance: it nets against the shop's next online sales, and a shop in debit
 * cannot request a payout until it is cleared.
 *
 * Runs inside the caller's transaction, which is the one that marked the
 * parcel delivered. `CodCollection`'s unique (orderId, shopId) index makes a
 * second call for the same parcel fail rather than charge twice, whichever
 * delivery path reports it first.
 */
export async function settleCashOnDelivery(tx: Tx, orderId: string, shopId: string): Promise<void> {
  const order = await tx.order.findUnique({ where: { id: orderId }, select: ORDER_FOR_FULFILMENT });
  if (!order || order.paymentMethod !== "COD") return;

  // Already collected: re-marking a delivered parcel is a no-op. The unique
  // index below still decides a genuine race between two delivery paths.
  const existing = await tx.codCollection.findUnique({
    where: { orderId_shopId: { orderId, shopId } },
    select: { id: true },
  });
  if (existing) return;

  const items = order.items.filter((i) => i.shopId === shopId && i.fulfillmentStatus !== "CANCELLED");
  if (!items.length) return;

  const shippingShare = shippingByShop(order).get(shopId) ?? 0;
  const collected = items.reduce((a, i) => a + i.totalCents, 0) + shippingShare;
  const commission = items.reduce((a, i) => a + i.commissionCents, 0);

  await tx.codCollection.create({
    data: { orderId, shopId, amountCents: collected, commissionCents: commission, currency: order.currency },
  });

  if (commission > 0) {
    await postTransaction(
      {
        kind: "COMMISSION",
        description: `Commission on cash collected for ${order.orderNumber}`,
        currency: order.currency,
        referenceType: "ORDER",
        referenceId: order.id,
        entries: [
          { account: accounts.sellerAvailable(shopId, order.currency), amountCents: -commission },
          { account: accounts.platformRevenue(order.currency), amountCents: commission },
        ],
      },
      tx,
    );
  }

  // The order counts as paid once every live parcel in it has been delivered
  // and paid for at the door.
  const remaining = await tx.orderItem.count({
    where: { orderId, fulfillmentStatus: { notIn: ["DELIVERED", "CANCELLED"] } },
  });
  if (remaining === 0) {
    await tx.order.updateMany({
      where: { id: orderId, status: { notIn: ["CANCELLED", "REFUNDED"] } },
      data: { status: "DELIVERED" },
    });
  }
}

// ---------------------------------------------------------------------------
// Pet purchases — escrowed
// ---------------------------------------------------------------------------

async function settlePetPurchase(intent: SettlementIntent): Promise<void> {
  const settings = await getSettings();

  const result = await db.$transaction(async (tx) => {
    const petOrder = await tx.petOrder.findUnique({
      where: { id: intent.referenceId! },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        buyerId: true,
        sellerId: true,
        listingId: true,
        petId: true,
        amountCents: true,
        currency: true,
        listing: { select: { title: true, id: true, petId: true } },
      },
    });
    if (!petOrder) throw notFound("That purchase");

    const autoReleaseAt = new Date(Date.now() + settings.escrowAutoReleaseHours * 3_600_000);

    const claimed = await tx.petOrder.updateMany({
      where: { id: petOrder.id, status: "PENDING_PAYMENT" },
      data: { status: "IN_ESCROW", paymentIntentId: intent.id, autoReleaseAt },
    });
    if (claimed.count === 0) {
      logger.warn("pet order already settled", { petOrderId: petOrder.id });
      return null;
    }

    // The money sits in escrow. Neither party holds it until handover is
    // confirmed — that is the whole reason a buyer would pay on PetMate rather
    // than hand over cash in a car park.
    await postTransaction(
      {
        kind: "ESCROW_HOLD",
        description: `Escrow for ${petOrder.orderNumber}`,
        currency: petOrder.currency,
        paymentIntentId: intent.id,
        referenceType: "PET_ORDER",
        referenceId: petOrder.id,
        entries: [
          { account: accounts.external(petOrder.currency), amountCents: -petOrder.amountCents },
          { account: accounts.escrow(petOrder.currency), amountCents: petOrder.amountCents },
        ],
      },
      tx,
    );

    await tx.listing.update({
      where: { id: petOrder.listingId },
      data: { status: "RESERVED" },
    });
    await tx.pet.update({
      where: { id: petOrder.listing.petId },
      data: { status: "RESERVED" },
    });

    await createInvoice(
      {
        paymentIntentId: intent.id,
        userId: petOrder.buyerId,
        totalCents: petOrder.amountCents,
        currency: petOrder.currency,
        lines: [{ description: petOrder.listing.title, amountCents: petOrder.amountCents }],
        billingName: intent.user?.name ?? "PetMate member",
      },
      tx,
    );

    await enqueueJob(
      {
        type: "escrow.autoRelease",
        payload: { petOrderId: petOrder.id },
        runAt: autoReleaseAt,
        uniqueKey: `escrow.autoRelease:${petOrder.id}`,
      },
      tx,
    );

    return petOrder;
  });

  if (!result) return;

  await notify({
    userId: result.sellerId,
    category: "ORDER",
    type: "petorder.paid",
    title: "Your listing has been paid for",
    body: `${formatMoney(result.amountCents, result.currency)} is held securely until you both confirm handover.`,
    url: `/dashboard/sales/${result.id}`,
    entityType: "PET_ORDER",
    entityId: result.id,
  });

  await notify({
    userId: result.buyerId,
    category: "ORDER",
    type: "petorder.escrow",
    title: "Payment held securely",
    body: "Your money stays in escrow until you confirm you have met the pet and everything is as described.",
    url: `/dashboard/purchases/${result.id}`,
    entityType: "PET_ORDER",
    entityId: result.id,
  });
}

// ---------------------------------------------------------------------------
// Veterinary appointments
// ---------------------------------------------------------------------------

async function settleAppointment(intent: SettlementIntent): Promise<void> {
  const result = await db.$transaction(async (tx) => {
    const appointment = await tx.appointment.findUnique({
      where: { id: intent.referenceId! },
      select: {
        id: true,
        reference: true,
        status: true,
        userId: true,
        clinicId: true,
        petId: true,
        startAt: true,
        priceCents: true,
        commissionCents: true,
        currency: true,
        clinic: { select: { name: true, ownerUserId: true } },
        pet: { select: { name: true } },
        service: { select: { name: true } },
      },
    });
    if (!appointment) throw notFound("That appointment");

    const claimed = await tx.appointment.updateMany({
      where: { id: appointment.id, status: "PENDING_PAYMENT" },
      data: { status: "CONFIRMED", paidAt: new Date(), paymentIntentId: intent.id },
    });
    if (claimed.count === 0) return null;

    const clinicEarnings = appointment.priceCents - appointment.commissionCents;

    await postTransaction(
      {
        kind: "CHARGE",
        description: `Appointment ${appointment.reference}`,
        currency: appointment.currency,
        paymentIntentId: intent.id,
        referenceType: "APPOINTMENT",
        referenceId: appointment.id,
        entries: [
          { account: accounts.external(appointment.currency), amountCents: -appointment.priceCents },
          { account: accounts.platformRevenue(appointment.currency), amountCents: appointment.commissionCents },
          { account: accounts.clinicPending(appointment.clinicId, appointment.currency), amountCents: clinicEarnings },
        ],
      },
      tx,
    );

    await tx.clinic.update({
      where: { id: appointment.clinicId },
      data: { bookingCount: { increment: 1 } },
    });

    await createInvoice(
      {
        paymentIntentId: intent.id,
        userId: appointment.userId,
        totalCents: appointment.priceCents,
        currency: appointment.currency,
        lines: [
          {
            description: `${appointment.service.name} — ${appointment.clinic.name}`,
            amountCents: appointment.priceCents,
          },
        ],
        billingName: intent.user?.name ?? "PetMate member",
      },
      tx,
    );

    // Reminders are jobs, not a cron that scans every appointment every minute.
    const reminder24h = new Date(appointment.startAt.getTime() - 24 * 3_600_000);
    if (reminder24h > new Date()) {
      await enqueueJob(
        {
          type: "appointment.remind",
          payload: { appointmentId: appointment.id, window: "24h" },
          runAt: reminder24h,
          uniqueKey: `appointment.remind:24h:${appointment.id}`,
        },
        tx,
      );
    }
    const reminder2h = new Date(appointment.startAt.getTime() - 2 * 3_600_000);
    if (reminder2h > new Date()) {
      await enqueueJob(
        {
          type: "appointment.remind",
          payload: { appointmentId: appointment.id, window: "2h" },
          runAt: reminder2h,
          uniqueKey: `appointment.remind:2h:${appointment.id}`,
        },
        tx,
      );
    }

    return appointment;
  });

  if (!result) return;

  const when = result.startAt.toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  await notify({
    userId: result.userId,
    category: "APPOINTMENT",
    type: "appointment.confirmed",
    title: "Appointment confirmed",
    body: `${result.pet.name} at ${result.clinic.name} — ${when}`,
    url: `/dashboard/appointments/${result.id}`,
    entityType: "APPOINTMENT",
    entityId: result.id,
    email: () =>
      emailTemplates.appointmentConfirmed({
        name: "",
        clinicName: result.clinic.name,
        petName: result.pet.name,
        when,
        serviceName: result.service.name,
        url: url(`/dashboard/appointments/${result.id}`),
      }),
  });

  await notify({
    userId: result.clinic.ownerUserId,
    category: "APPOINTMENT",
    type: "appointment.booked",
    title: "New booking",
    body: `${result.service.name} for ${result.pet.name} — ${when}`,
    url: `/clinic/appointments`,
    entityType: "APPOINTMENT",
    entityId: result.id,
  });
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

async function settleSubscription(intent: SettlementIntent): Promise<void> {
  const result = await db.$transaction(async (tx) => {
    const subscription = await tx.subscription.findUnique({
      where: { id: intent.referenceId! },
      select: {
        id: true,
        userId: true,
        status: true,
        interval: true,
        planId: true,
        plan: { select: { name: true, code: true } },
      },
    });
    if (!subscription) throw notFound("That subscription");

    const now = new Date();
    const periodEnd = subscription.interval === "YEAR" ? addMonths(now, 12) : addMonths(now, 1);

    const claimed = await tx.subscription.updateMany({
      where: { id: subscription.id, status: { in: ["TRIALING", "PAST_DUE", "CANCELLED", "EXPIRED"] } },
      data: {
        status: "ACTIVE",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        cancelledAt: null,
        paymentIntentId: intent.id,
      },
    });

    // An already-ACTIVE subscription being renewed just extends the period.
    if (claimed.count === 0) {
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { currentPeriodStart: now, currentPeriodEnd: periodEnd, paymentIntentId: intent.id },
      });
    }

    await postTransaction(
      {
        kind: "SUBSCRIPTION",
        description: `${subscription.plan.name} subscription`,
        currency: intent.currency,
        paymentIntentId: intent.id,
        referenceType: "SUBSCRIPTION",
        referenceId: subscription.id,
        entries: [
          { account: accounts.external(intent.currency), amountCents: -intent.amountCents },
          { account: accounts.platformRevenue(intent.currency), amountCents: intent.amountCents },
        ],
      },
      tx,
    );

    await createInvoice(
      {
        paymentIntentId: intent.id,
        userId: subscription.userId,
        totalCents: intent.amountCents,
        currency: intent.currency,
        lines: [
          {
            description: `${subscription.plan.name} — ${subscription.interval === "YEAR" ? "12 months" : "1 month"}`,
            amountCents: intent.amountCents,
          },
        ],
        billingName: intent.user?.name ?? "PetMate member",
      },
      tx,
    );

    await enqueueJob(
      {
        type: "subscription.expire",
        payload: { subscriptionId: subscription.id },
        runAt: periodEnd,
        uniqueKey: `subscription.expire:${subscription.id}:${periodEnd.getTime()}`,
      },
      tx,
    );

    return { ...subscription, periodEnd };
  });

  await notify({
    userId: result.userId,
    category: "PAYMENT",
    type: "subscription.active",
    title: `${result.plan.name} is active`,
    body: `Your plan renews on ${result.periodEnd.toLocaleDateString("en-US", { dateStyle: "long" })}.`,
    url: "/settings/billing",
  });
}

// ---------------------------------------------------------------------------
// Featured placements & ads
// ---------------------------------------------------------------------------

async function settleFeaturedListing(intent: SettlementIntent): Promise<void> {
  const result = await db.$transaction(async (tx) => {
    const placement = await tx.featuredPlacement.findUnique({
      where: { id: intent.referenceId! },
      select: { id: true, entityType: true, entityId: true, startAt: true, endAt: true },
    });
    if (!placement) throw notFound("That placement");

    await tx.featuredPlacement.update({
      where: { id: placement.id },
      data: { paymentIntentId: intent.id },
    });

    if (placement.entityType === "LISTING") {
      await tx.listing.update({
        where: { id: placement.entityId },
        data: { featuredUntil: placement.endAt, boostScore: 100 },
      });
    }

    await postTransaction(
      {
        kind: "CHARGE",
        description: "Featured placement",
        currency: intent.currency,
        paymentIntentId: intent.id,
        referenceType: "FEATURED_PLACEMENT",
        referenceId: placement.id,
        entries: [
          { account: accounts.external(intent.currency), amountCents: -intent.amountCents },
          { account: accounts.platformRevenue(intent.currency), amountCents: intent.amountCents },
        ],
      },
      tx,
    );

    return placement;
  });

  await notify({
    userId: intent.userId,
    category: "LISTING",
    type: "listing.featured",
    title: "Your listing is now featured",
    body: `It will appear at the top of search until ${result.endAt.toLocaleDateString("en-US", { dateStyle: "medium" })}.`,
    url: "/dashboard/listings",
  });
}

/**
 * The whole budget is paid up front and booked as revenue; whatever is not
 * delivered is returned to the advertiser's wallet when the campaign ends
 * (`completeCampaign`). A payment for a draft that was discarded meanwhile is
 * refunded rather than kept.
 */
async function settleAdCampaign(intent: SettlementIntent): Promise<void> {
  const claimed = await db.$transaction(async (tx) => {
    const moved = await tx.adCampaign.updateMany({
      where: { id: intent.referenceId!, status: "DRAFT", advertiserId: intent.userId, budgetCents: intent.amountCents },
      data: { status: "PENDING_REVIEW", paymentIntentId: intent.id },
    });

    await postTransaction(
      {
        kind: "CHARGE",
        description: moved.count ? "Ad campaign funding" : "Ad campaign payment after the draft was discarded",
        currency: intent.currency,
        paymentIntentId: intent.id,
        referenceType: "AD_CAMPAIGN",
        referenceId: intent.referenceId!,
        entries: [
          { account: accounts.external(intent.currency), amountCents: -intent.amountCents },
          { account: accounts.platformRevenue(intent.currency), amountCents: intent.amountCents },
        ],
      },
      tx,
    );

    if (moved.count) {
      await createInvoice(
        {
          paymentIntentId: intent.id,
          userId: intent.userId,
          totalCents: intent.amountCents,
          currency: intent.currency,
          lines: [{ description: "Advertising budget", amountCents: intent.amountCents }],
          billingName: intent.user?.name ?? "PetMate member",
        },
        tx,
      );
    }
    return moved.count > 0;
  });

  if (!claimed) {
    const { refundPayment } = await import("./service");
    try {
      await refundPayment({
        intentId: intent.id,
        amountCents: intent.amountCents,
        reason: "CANCELLED_ORDER",
        approvedById: intent.userId,
        note: "Payment for a discarded ad campaign",
        idempotencyKey: `ad_orphan_${intent.id}`,
      });
    } catch (e) {
      logger.exception("orphaned ad payment could not be refunded", e, { intentId: intent.id });
    }
    return;
  }

  await notify({
    userId: intent.userId,
    category: "PAYMENT",
    type: "ad.funded",
    title: "Campaign submitted for review",
    body: "We review every campaign before it goes live. This usually takes a few hours.",
    url: "/dashboard/advertising",
  });
}

async function settleWalletTopUp(intent: SettlementIntent): Promise<void> {
  await postTransaction({
    kind: "CHARGE",
    description: "Wallet top-up",
    currency: intent.currency,
    paymentIntentId: intent.id,
    referenceType: "USER",
    referenceId: intent.userId,
    entries: [
      { account: accounts.external(intent.currency), amountCents: -intent.amountCents },
      { account: accounts.userAvailable(intent.userId, intent.currency), amountCents: intent.amountCents },
    ],
  });

  await notify({
    userId: intent.userId,
    category: "PAYMENT",
    type: "wallet.topup",
    title: `${formatMoney(intent.amountCents, intent.currency)} added to your wallet`,
    url: "/dashboard/wallet",
  });
}

// ---------------------------------------------------------------------------
// Breeding fees
// ---------------------------------------------------------------------------

/**
 * A stud fee paid through PetMate goes into escrow, exactly like a pet sale:
 * the stud's owner sees that the money is there, and the payer knows it only
 * moves once the breeding has happened.
 *
 * The claim is conditional on the fee still being owed, by this payer, at this
 * amount. A payment that lands after the breeding was cancelled or the terms
 * changed is booked and refunded in full straight away, rather than left as
 * money nobody is holding for anything.
 */
async function settleBreedingFee(intent: SettlementIntent): Promise<void> {
  const result = await db.$transaction(async (tx) => {
    const request = await tx.breedingRequest.findUnique({
      where: { id: intent.referenceId! },
      select: {
        id: true,
        feeCents: true,
        currency: true,
        feePayerUserId: true,
        feePayeeUserId: true,
        feePaymentIntentId: true,
        conversationId: true,
        initiatorPet: { select: { name: true } },
        receiverPet: { select: { name: true } },
      },
    });
    if (!request) throw notFound("That breeding request");

    const claimed = await tx.breedingRequest.updateMany({
      where: {
        id: request.id,
        status: { in: ["AGREED", "SCHEDULED"] },
        feeStatus: "DUE",
        feePayerUserId: intent.userId,
        feeCents: intent.amountCents,
        currency: intent.currency,
      },
      data: { feeStatus: "HELD", feePaymentIntentId: intent.id, feePaidAt: new Date() },
    });

    if (claimed.count === 0) {
      if (request.feePaymentIntentId === intent.id) return { kind: "duplicate" as const };

      // Nothing is owed any more, but the money is real. Book it so the
      // refund below has a balance to come out of.
      await postTransaction(
        {
          kind: "CHARGE",
          description: "Breeding fee received after it was no longer due",
          currency: intent.currency,
          paymentIntentId: intent.id,
          referenceType: "BREEDING_REQUEST",
          referenceId: request.id,
          entries: [
            { account: accounts.external(intent.currency), amountCents: -intent.amountCents },
            { account: accounts.platformRevenue(intent.currency), amountCents: intent.amountCents },
          ],
        },
        tx,
      );
      return { kind: "orphan" as const };
    }

    const pairing = `${request.initiatorPet.name} × ${request.receiverPet.name}`;

    await postTransaction(
      {
        kind: "ESCROW_HOLD",
        description: `Breeding fee held for ${pairing}`,
        currency: request.currency,
        paymentIntentId: intent.id,
        referenceType: "BREEDING_REQUEST",
        referenceId: request.id,
        entries: [
          { account: accounts.external(request.currency), amountCents: -request.feeCents },
          { account: accounts.escrow(request.currency), amountCents: request.feeCents },
        ],
      },
      tx,
    );

    await createInvoice(
      {
        paymentIntentId: intent.id,
        userId: intent.userId,
        totalCents: request.feeCents,
        currency: request.currency,
        lines: [{ description: `Stud fee — ${pairing}`, amountCents: request.feeCents }],
        billingName: intent.user?.name ?? "PetMate member",
      },
      tx,
    );

    return { kind: "held" as const, request, pairing };
  });

  if (result.kind === "duplicate") return;

  if (result.kind === "orphan") {
    const { refundPayment } = await import("./service");
    try {
      await refundPayment({
        intentId: intent.id,
        amountCents: intent.amountCents,
        reason: "CANCELLED_ORDER",
        approvedById: intent.userId,
        note: "Breeding fee paid after it was no longer due",
        idempotencyKey: `breeding_orphan_${intent.id}`,
      });
    } catch (e) {
      // The charge is booked to platform revenue, so it shows up in the
      // refund queue rather than disappearing.
      logger.exception("orphaned breeding fee could not be refunded", e, { intentId: intent.id });
    }
    await notify({
      userId: intent.userId,
      category: "BREEDING",
      type: "breeding.fee_refunded",
      title: "Breeding fee refunded",
      body: "This breeding was no longer waiting for a fee, so your payment is being returned in full.",
      url: `/dashboard/breeding/requests/${intent.referenceId}`,
      entityType: "BREEDING_REQUEST",
      entityId: intent.referenceId ?? undefined,
    });
    return;
  }

  const { request } = result;
  const amount = formatMoney(request.feeCents, request.currency);

  if (request.feePayeeUserId) {
    await notify({
      userId: request.feePayeeUserId,
      category: "BREEDING",
      type: "breeding.fee_paid",
      title: "Stud fee paid",
      body: `${amount} is held by PetMate and is paid to you once the breeding is recorded.`,
      url: `/dashboard/breeding/requests/${request.id}`,
      entityType: "BREEDING_REQUEST",
      entityId: request.id,
    });
  }
  await notify({
    userId: intent.userId,
    category: "BREEDING",
    type: "breeding.fee_held",
    title: "Stud fee held securely",
    body: "The other owner is paid only after the breeding is recorded. If it is cancelled, you get it back.",
    url: `/dashboard/breeding/requests/${request.id}`,
    entityType: "BREEDING_REQUEST",
    entityId: request.id,
  });
}

/**
 * Pays a held stud fee to the stud's owner, less PetMate's commission (the
 * amounts were fixed when the payment was started, so a plan change in between
 * cannot move them).
 *
 * `FROZEN` is only released by staff resolving the payer's report; a plain
 * release after the review window never touches a fee someone has disputed.
 */
export async function releaseBreedingFee(params: {
  requestId: string;
  reason: "PAYER_CONFIRMED" | "AUTO_RELEASE" | "STAFF_DECISION";
  actorId?: string;
}): Promise<{ released: boolean }> {
  const fromStatuses = params.reason === "STAFF_DECISION" ? ["HELD", "FROZEN"] : ["HELD"];

  const result = await db.$transaction(async (tx) => {
    const request = await tx.breedingRequest.findUnique({
      where: { id: params.requestId },
      select: {
        id: true,
        feeCents: true,
        currency: true,
        feeCommissionCents: true,
        feePayoutCents: true,
        feePayeeUserId: true,
        feePayerUserId: true,
      },
    });
    if (!request) throw notFound("That breeding request");
    if (!request.feePayeeUserId) return null;

    const claimed = await tx.breedingRequest.updateMany({
      where: { id: request.id, feeStatus: { in: fromStatuses } },
      data: { feeStatus: "RELEASED", feeReleasedAt: new Date(), feeReleaseAt: null },
    });
    if (claimed.count === 0) return null;

    await postTransaction(
      {
        kind: "ESCROW_RELEASE",
        description: `Breeding fee release (${params.reason})`,
        currency: request.currency,
        referenceType: "BREEDING_REQUEST",
        referenceId: request.id,
        createdById: params.actorId,
        entries: [
          { account: accounts.escrow(request.currency), amountCents: -request.feeCents },
          { account: accounts.platformRevenue(request.currency), amountCents: request.feeCommissionCents },
          { account: accounts.userAvailable(request.feePayeeUserId, request.currency), amountCents: request.feePayoutCents },
        ],
      },
      tx,
    );

    return request;
  });

  if (!result) return { released: false };

  await notify({
    userId: result.feePayeeUserId!,
    category: "BREEDING",
    type: "breeding.fee_released",
    title: `${formatMoney(result.feePayoutCents, result.currency)} added to your wallet`,
    body: "The stud fee for this breeding has been paid out, after PetMate's commission.",
    url: "/dashboard/wallet",
    entityType: "BREEDING_REQUEST",
    entityId: result.id,
  });

  return { released: true };
}

// ---------------------------------------------------------------------------
// Escrow release
// ---------------------------------------------------------------------------

/**
 * Releases a held pet payment to the seller, taking the platform commission.
 *
 * Triggered by both parties confirming handover, by the auto-release job after
 * the escrow window, or by an admin resolving a dispute in the seller's favour.
 */
export async function releaseEscrow(params: {
  petOrderId: string;
  reason: "HANDOVER_CONFIRMED" | "AUTO_RELEASE" | "DISPUTE_RESOLVED";
  actorId?: string;
}): Promise<{ released: boolean; payoutCents: number }> {
  const settings = await getSettings();

  const result = await db.$transaction(async (tx) => {
    const order = await tx.petOrder.findUnique({
      where: { id: params.petOrderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        buyerId: true,
        sellerId: true,
        petId: true,
        listingId: true,
        amountCents: true,
        platformFeeCents: true,
        sellerPayoutCents: true,
        currency: true,
      },
    });
    if (!order) throw notFound("That purchase");

    const claimed = await tx.petOrder.updateMany({
      where: { id: order.id, status: { in: ["IN_ESCROW", "HANDOVER_PENDING"] } },
      data: { status: "COMPLETED", escrowReleasedAt: new Date() },
    });
    if (claimed.count === 0) return null;

    await postTransaction(
      {
        kind: "ESCROW_RELEASE",
        description: `Escrow release for ${order.orderNumber} (${params.reason})`,
        currency: order.currency,
        referenceType: "PET_ORDER",
        referenceId: order.id,
        createdById: params.actorId,
        entries: [
          { account: accounts.escrow(order.currency), amountCents: -order.amountCents },
          { account: accounts.platformRevenue(order.currency), amountCents: order.platformFeeCents },
          {
            account: accounts.userAvailable(order.sellerId, order.currency),
            amountCents: order.sellerPayoutCents,
          },
        ],
      },
      tx,
    );

    await tx.listing.update({
      where: { id: order.listingId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    await tx.user.update({
      where: { id: order.sellerId },
      data: { completedSales: { increment: 1 } },
    });
    await tx.user.update({
      where: { id: order.buyerId },
      data: { completedBuys: { increment: 1 } },
    });

    // Ownership of the animal moves with the money. The pet's passport, its
    // health history and its lineage follow it to the new owner.
    const transfer = await tx.petTransfer.create({
      data: {
        petId: order.petId,
        fromUserId: order.sellerId,
        toUserId: order.buyerId,
        reason: "SALE",
        listingId: order.listingId,
        status: "ACCEPTED",
        respondedAt: new Date(),
        note: `Completed sale ${order.orderNumber}`,
      },
      select: { id: true },
    });

    await tx.pet.update({
      where: { id: order.petId },
      data: {
        ownerId: order.buyerId,
        status: "ACTIVE",
        availability: "NOT_AVAILABLE",
      },
    });

    await tx.petOrder.update({
      where: { id: order.id },
      data: { transferId: transfer.id },
    });

    return order;
  });

  if (!result) return { released: false, payoutCents: 0 };

  const { awardTrustSignal } = await import("@/lib/services/trust.service");
  await Promise.all([
    awardTrustSignal(result.sellerId, "SALE_COMPLETED", { reference: result.id }),
    awardTrustSignal(result.buyerId, "PURCHASE_COMPLETED", { reference: result.id }),
  ]);

  await notify({
    userId: result.sellerId,
    category: "PAYMENT",
    type: "escrow.released",
    title: `${formatMoney(result.sellerPayoutCents, result.currency)} released to you`,
    body:
      params.reason === "AUTO_RELEASE"
        ? `The ${settings.escrowAutoReleaseHours / 24}-day escrow window closed without a dispute.`
        : "Both of you confirmed the handover.",
    url: "/dashboard/earnings",
    entityType: "PET_ORDER",
    entityId: result.id,
  });

  await notify({
    userId: result.buyerId,
    category: "ORDER",
    type: "petorder.completed",
    title: "Your purchase is complete",
    body: "The pet's passport and full health record are now in your account.",
    url: `/dashboard/pets`,
    entityType: "PET_ORDER",
    entityId: result.id,
  });

  return { released: true, payoutCents: result.sellerPayoutCents };
}

/**
 * Moves seller earnings from PENDING to AVAILABLE once the hold window passes.
 * Run by the `payouts.release` job scheduled at settlement.
 */
export async function releaseSellerHold(orderId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        currency: true,
        shippingCents: true,
        items: { select: { shopId: true, sellerEarningsCents: true, totalCents: true, refundedCents: true } },
      },
    });
    if (!order) return;

    // A refunded or cancelled order never clears to available.
    if (!["PAID", "PROCESSING", "SHIPPED", "DELIVERED"].includes(order.status)) {
      logger.info("skipping seller hold release for non-active order", {
        orderId,
        status: order.status,
      });
      return;
    }

    const shopIds = [...new Set(order.items.map((i) => i.shopId))];
    const shopTotals = shopIds.map((id) =>
      order.items.filter((i) => i.shopId === id).reduce((a, i) => a + i.totalCents, 0),
    );
    const shippingSplit = distributeCents(order.shippingCents, shopTotals);

    for (const [i, shopId] of shopIds.entries()) {
      const earnings =
        order.items
          .filter((it) => it.shopId === shopId)
          .reduce((a, it) => a + it.sellerEarningsCents - it.refundedCents, 0) + (shippingSplit[i] ?? 0);

      if (earnings <= 0) continue;

      await postTransaction(
        {
          kind: "ADJUSTMENT",
          description: `Earnings cleared for ${order.orderNumber}`,
          currency: order.currency,
          referenceType: "ORDER",
          referenceId: order.id,
          entries: [
            { account: accounts.sellerPending(shopId, order.currency), amountCents: -earnings },
            { account: accounts.sellerAvailable(shopId, order.currency), amountCents: earnings },
          ],
        },
        tx,
      );
    }
  });
}

/** Clears a clinic's pending balance after a completed appointment. */
export async function releaseClinicHold(appointmentId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const appointment = await tx.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        reference: true,
        status: true,
        clinicId: true,
        priceCents: true,
        commissionCents: true,
        currency: true,
      },
    });
    if (!appointment || appointment.status !== "COMPLETED") return;

    const earnings = appointment.priceCents - appointment.commissionCents;
    if (earnings <= 0) return;

    await postTransaction(
      {
        kind: "ADJUSTMENT",
        description: `Earnings cleared for ${appointment.reference}`,
        currency: appointment.currency,
        referenceType: "APPOINTMENT",
        referenceId: appointment.id,
        entries: [
          { account: accounts.clinicPending(appointment.clinicId, appointment.currency), amountCents: -earnings },
          { account: accounts.clinicAvailable(appointment.clinicId, appointment.currency), amountCents: earnings },
        ],
      },
      tx,
    );
  });
}
