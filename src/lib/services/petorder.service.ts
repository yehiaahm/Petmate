import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { badRequest, conflict, notFound } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/session";
import { applyBps, formatMoney } from "@/lib/money";
import { resolveCommissionBps, getSettings } from "@/lib/settings";
import { generateOrderNumber } from "@/lib/utils";
import { getEntitlements } from "@/lib/billing/entitlements";
import { notify } from "./notification.service";
import { getOrCreateConversation, postSystemMessage } from "./chat.service";
import { releaseEscrow } from "@/lib/payments/settlement";

/**
 * Buying a pet.
 *
 * This is the transaction PetMate exists to make safe. Cash in a car park has
 * no recourse; a bank transfer to a stranger has none either. Here:
 *
 *   buyer pays -> money is held in escrow -> they meet the animal ->
 *   both confirm the handover -> the seller is paid and the passport transfers
 *
 * If the buyer does not confirm and does not dispute, escrow releases after the
 * configured window so a seller cannot be held hostage by silence. If they do
 * dispute, the money stays put until a human resolves it.
 */

export async function createPetOrder(auth: AuthContext, listingId: string) {
  const listing = await db.listing.findFirst({
    where: { id: listingId, deletedAt: null },
    select: {
      id: true,
      status: true,
      intent: true,
      sellerId: true,
      petId: true,
      title: true,
      priceCents: true,
      currency: true,
      pet: { select: { id: true, name: true } },
      seller: { select: { id: true, name: true } },
    },
  });

  if (!listing) throw notFound("That listing");
  if (listing.intent !== "SALE") throw badRequest("This listing is not for sale.");
  if (listing.status !== "ACTIVE") throw conflict("This pet is no longer available.");
  if (listing.sellerId === auth.user.id) throw badRequest("This is your own listing.");
  if (listing.priceCents <= 0) throw badRequest("This listing has no price set.");

  const existing = await db.petOrder.findFirst({
    where: {
      listingId,
      buyerId: auth.user.id,
      status: { in: ["PENDING_PAYMENT", "IN_ESCROW", "HANDOVER_PENDING"] },
    },
    select: { id: true, status: true, amountCents: true, currency: true, orderNumber: true },
  });
  if (existing) return { ...existing, reused: true };

  // Someone else already has money in escrow on this animal.
  const claimed = await db.petOrder.findFirst({
    where: { listingId, status: { in: ["IN_ESCROW", "HANDOVER_PENDING"] } },
    select: { id: true },
  });
  if (claimed) throw conflict("Someone else is already completing a purchase for this pet.");

  const entitlements = await getEntitlements(listing.sellerId);
  const baseBps = await resolveCommissionBps("PET_SALE");
  const commissionBps = Math.max(0, baseBps - entitlements.commissionDiscountBps);

  // The price is read from the listing row. Nothing about it comes from input.
  const amountCents = listing.priceCents;
  const platformFeeCents = applyBps(amountCents, commissionBps);

  const order = await db.petOrder.create({
    data: {
      orderNumber: generateOrderNumber("PMP"),
      listingId: listing.id,
      petId: listing.petId,
      buyerId: auth.user.id,
      sellerId: listing.sellerId,
      status: "PENDING_PAYMENT",
      amountCents,
      currency: listing.currency,
      platformFeeCents,
      sellerPayoutCents: amountCents - platformFeeCents,
    },
    select: { id: true, orderNumber: true, amountCents: true, currency: true, status: true },
  });

  await audit({
    action: "petorder.created",
    actorId: auth.user.id,
    entityType: "PET_ORDER",
    entityId: order.id,
    summary: `${listing.title} — ${formatMoney(amountCents, listing.currency)}`,
  });

  return { ...order, reused: false };
}

/**
 * A party confirms the handover happened. When both have, escrow releases and
 * ownership of the animal moves with the money.
 */
export async function confirmHandover(auth: AuthContext, petOrderId: string, note?: string) {
  const order = await db.petOrder.findUnique({
    where: { id: petOrderId },
    select: {
      id: true,
      status: true,
      buyerId: true,
      sellerId: true,
      petId: true,
      amountCents: true,
      currency: true,
      buyerConfirmedAt: true,
      sellerConfirmedAt: true,
      orderNumber: true,
    },
  });
  if (!order) throw notFound("That purchase");

  const isBuyer = order.buyerId === auth.user.id;
  const isSeller = order.sellerId === auth.user.id;
  if (!isBuyer && !isSeller) throw notFound("That purchase");

  if (!["IN_ESCROW", "HANDOVER_PENDING"].includes(order.status)) {
    throw conflict("This purchase is not awaiting handover.");
  }

  const updated = await db.petOrder.update({
    where: { id: petOrderId },
    data: {
      ...(isBuyer ? { buyerConfirmedAt: new Date() } : { sellerConfirmedAt: new Date() }),
      status: "HANDOVER_PENDING",
      ...(note ? { meetingNote: note.slice(0, 500) } : {}),
    },
    select: { buyerConfirmedAt: true, sellerConfirmedAt: true },
  });

  const bothConfirmed = Boolean(updated.buyerConfirmedAt && updated.sellerConfirmedAt);

  if (bothConfirmed) {
    await releaseEscrow({
      petOrderId,
      reason: "HANDOVER_CONFIRMED",
      actorId: auth.user.id,
    });
    return { bothConfirmed: true };
  }

  const otherUserId = isBuyer ? order.sellerId : order.buyerId;
  await notify({
    userId: otherUserId,
    category: "ORDER",
    type: "petorder.handover_confirmed",
    title: `${auth.user.name} confirmed the handover`,
    body: "Confirm from your side to release the payment.",
    url: isBuyer ? `/dashboard/sales/${petOrderId}` : `/dashboard/purchases/${petOrderId}`,
    entityType: "PET_ORDER",
    entityId: petOrderId,
  });

  return { bothConfirmed: false };
}

export async function cancelPetOrder(auth: AuthContext, petOrderId: string, reason: string) {
  const order = await db.petOrder.findUnique({
    where: { id: petOrderId },
    select: {
      id: true,
      status: true,
      buyerId: true,
      sellerId: true,
      listingId: true,
      petId: true,
      amountCents: true,
      currency: true,
      paymentIntentId: true,
      orderNumber: true,
    },
  });
  if (!order) throw notFound("That purchase");

  const isParty = order.buyerId === auth.user.id || order.sellerId === auth.user.id;
  if (!isParty) throw notFound("That purchase");

  if (!["PENDING_PAYMENT", "IN_ESCROW", "HANDOVER_PENDING"].includes(order.status)) {
    throw conflict("This purchase can no longer be cancelled.");
  }

  const wasPaid = order.status !== "PENDING_PAYMENT";

  await db.$transaction(async (tx) => {
    const claimed = await tx.petOrder.updateMany({
      where: { id: order.id, status: { in: ["PENDING_PAYMENT", "IN_ESCROW", "HANDOVER_PENDING"] } },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason.slice(0, 300) },
    });
    if (claimed.count === 0) throw conflict("This purchase has already been resolved.");

    // The pet goes back on the market.
    await tx.listing.updateMany({
      where: { id: order.listingId, status: "RESERVED" },
      data: { status: "ACTIVE" },
    });
    await tx.pet.updateMany({
      where: { id: order.petId, status: "RESERVED" },
      data: { status: "LISTED" },
    });
  });

  // Money in escrow returns to the buyer in full. Nobody has to ask for it.
  if (wasPaid && order.paymentIntentId) {
    const { refundPayment } = await import("@/lib/payments/service");
    const { postTransaction, accounts } = await import("@/lib/payments/ledger-core");

    await postTransaction({
      kind: "ESCROW_RELEASE",
      description: `Escrow returned for cancelled ${order.orderNumber}`,
      currency: order.currency,
      referenceType: "PET_ORDER",
      referenceId: order.id,
      createdById: auth.user.id,
      entries: [
        { account: accounts.escrow(order.currency), amountCents: -order.amountCents },
        { account: accounts.platformRevenue(order.currency), amountCents: order.amountCents },
      ],
    });

    await refundPayment({
      intentId: order.paymentIntentId,
      amountCents: order.amountCents,
      reason: "CANCELLED_ORDER",
      approvedById: auth.user.id,
      note: `Purchase ${order.orderNumber} cancelled: ${reason}`,
    });
  }

  await audit({
    action: "order.cancelled",
    actorId: auth.user.id,
    entityType: "PET_ORDER",
    entityId: petOrderId,
    summary: reason,
  });

  const otherUserId = order.buyerId === auth.user.id ? order.sellerId : order.buyerId;
  await notify({
    userId: otherUserId,
    category: "ORDER",
    type: "petorder.cancelled",
    title: "Purchase cancelled",
    body: wasPaid ? `${reason} — the payment has been refunded in full.` : reason,
    url: "/dashboard",
    entityType: "PET_ORDER",
    entityId: petOrderId,
  });

  return { refunded: wasPaid };
}

/** Auto-release after the escrow window. Run by `escrow.autoRelease`. */
export async function autoReleaseEscrow(petOrderId: string): Promise<void> {
  const order = await db.petOrder.findUnique({
    where: { id: petOrderId },
    select: { id: true, status: true, autoReleaseAt: true },
  });
  if (!order) return;

  // A dispute freezes the money. Only a human resolves it from there.
  if (!["IN_ESCROW", "HANDOVER_PENDING"].includes(order.status)) return;
  if (order.autoReleaseAt && order.autoReleaseAt > new Date()) return;

  const openDispute = await db.dispute.findFirst({
    where: { petOrderId, status: { in: ["OPEN", "AWAITING_RESPONSE", "IN_REVIEW"] } },
    select: { id: true },
  });
  if (openDispute) return;

  await releaseEscrow({ petOrderId, reason: "AUTO_RELEASE" });
}

export async function getPetOrder(auth: AuthContext, petOrderId: string) {
  const order = await db.petOrder.findUnique({
    where: { id: petOrderId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      amountCents: true,
      currency: true,
      platformFeeCents: true,
      sellerPayoutCents: true,
      buyerId: true,
      sellerId: true,
      buyerConfirmedAt: true,
      sellerConfirmedAt: true,
      autoReleaseAt: true,
      escrowReleasedAt: true,
      createdAt: true,
      meetingNote: true,
      paymentIntentId: true,
      listing: {
        select: {
          id: true,
          slug: true,
          title: true,
          city: true,
          country: true,
          pet: {
            select: {
              id: true,
              name: true,
              species: true,
              passportNo: true,
              breed: { select: { name: true } },
              photos: { where: { isPrimary: true }, take: 1, select: { url: true } },
            },
          },
          seller: { select: { id: true, name: true, handle: true, avatarUrl: true, trustScore: true } },
        },
      },
    },
  });

  if (!order) throw notFound("That purchase");
  if (order.buyerId !== auth.user.id && order.sellerId !== auth.user.id) {
    throw notFound("That purchase");
  }

  const isBuyer = order.buyerId === auth.user.id;

  // PetOrder stores the two parties as ids rather than relations, so the buyer
  // is one primary-key lookup. Resolving the counterparty here rather than in
  // the page means neither side can ever be shown itself as the other party.
  const [settings, buyer] = await Promise.all([
    getSettings(),
    isBuyer
      ? null
      : db.user.findUnique({
          where: { id: order.buyerId },
          select: { id: true, name: true, handle: true, avatarUrl: true, trustScore: true },
        }),
  ]);

  return {
    ...order,
    isBuyer,
    counterparty: isBuyer
      ? order.listing.seller
      : (buyer ?? {
          id: order.buyerId,
          name: "Deleted member",
          handle: "deleted",
          avatarUrl: null,
          trustScore: 0,
        }),
    iConfirmed:
      order.buyerId === auth.user.id ? Boolean(order.buyerConfirmedAt) : Boolean(order.sellerConfirmedAt),
    theyConfirmed:
      order.buyerId === auth.user.id ? Boolean(order.sellerConfirmedAt) : Boolean(order.buyerConfirmedAt),
    escrowWindowHours: settings.escrowAutoReleaseHours,
  };
}

export async function listPurchases(auth: AuthContext) {
  return db.petOrder.findMany({
    where: { buyerId: auth.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      orderNumber: true,
      status: true,
      amountCents: true,
      currency: true,
      createdAt: true,
      autoReleaseAt: true,
      listing: {
        select: {
          title: true,
          slug: true,
          pet: {
            select: { name: true, photos: { where: { isPrimary: true }, take: 1, select: { url: true } } },
          },
          seller: { select: { id: true, name: true, avatarUrl: true } },
        },
      },
    },
  });
}

export async function listSales(auth: AuthContext) {
  return db.petOrder.findMany({
    where: { sellerId: auth.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      orderNumber: true,
      status: true,
      amountCents: true,
      sellerPayoutCents: true,
      currency: true,
      createdAt: true,
      escrowReleasedAt: true,
      listing: {
        select: {
          title: true,
          slug: true,
          pet: {
            select: { name: true, photos: { where: { isPrimary: true }, take: 1, select: { url: true } } },
          },
        },
      },
    },
  });
}

/** Opens the buyer/seller thread once a purchase exists. */
export async function openPurchaseConversation(auth: AuthContext, petOrderId: string) {
  const order = await db.petOrder.findUnique({
    where: { id: petOrderId },
    select: {
      id: true,
      buyerId: true,
      sellerId: true,
      orderNumber: true,
      listing: { select: { id: true, title: true } },
    },
  });
  if (!order) throw notFound("That purchase");
  if (order.buyerId !== auth.user.id && order.sellerId !== auth.user.id) throw notFound("That purchase");

  const conversation = await getOrCreateConversation({
    type: "ORDER",
    participantIds: [order.buyerId, order.sellerId],
    contextType: "PET_ORDER",
    contextId: order.id,
    listingId: order.listing.id,
    subject: `Purchase ${order.orderNumber}`,
    createdById: auth.user.id,
  });

  if (conversation.created) {
    await postSystemMessage({
      conversationId: conversation.id,
      systemType: "petorder.opened",
      body: "Payment is held securely until you both confirm the handover. Arrange to meet here.",
      data: { petOrderId: order.id },
    });
  }

  return conversation;
}
