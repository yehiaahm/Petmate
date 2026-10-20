import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { conflict, notFound } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { AuthContext } from "@/lib/auth/session";
import { getEntitlements } from "@/lib/billing/entitlements";
import { getSettings, resolveCommissionBps } from "@/lib/settings";
import { applyBps, formatMoney } from "@/lib/money";
import { clientEnv } from "@/lib/env";
import { enqueueJob } from "@/lib/jobs/queue";
import { accounts, postTransaction } from "@/lib/payments/ledger-core";
import { createPayment, refundPayment, type PaymentHandle } from "@/lib/payments/service";
import { releaseBreedingFee } from "@/lib/payments/settlement";
import { notify } from "./notification.service";
import { createSupportTicket } from "./support.service";
import { postSystemMessage } from "./chat.service";

/**
 * Stud fees, collected and held by PetMate.
 *
 * Once both owners agree paid terms, the dam's owner pays the fee into escrow.
 * The stud's owner is paid (less commission) when the breeding is recorded:
 * straight away if the payer records it, or after the review window if the
 * stud's owner does, so the payer always has the chance to say it never
 * happened. A cancelled breeding returns the fee in full.
 *
 *   NONE ─ agree paid terms ─▶ DUE ─ pay ─▶ HELD ─┬─ release ─▶ RELEASED
 *                                                 ├─ cancel ──▶ REFUNDED
 *                                                 └─ report ──▶ FROZEN ─ staff ─▶ RELEASED | REFUNDED
 *
 * Every transition is a conditional update on `feeStatus`, so a double click,
 * a retried job and a staff decision racing each other move the money once.
 */

export const FEE_REVIEW_HOURS_FALLBACK = 72;

/** The owner of the male is paid the stud fee; the other owner pays it. */
export function feeParties(request: {
  initiatorUserId: string;
  receiverUserId: string;
  initiatorPetSex: string;
}): { payerUserId: string; payeeUserId: string } {
  return request.initiatorPetSex === "MALE"
    ? { payerUserId: request.receiverUserId, payeeUserId: request.initiatorUserId }
    : { payerUserId: request.initiatorUserId, payeeUserId: request.receiverUserId };
}

/** A paid arrangement is a stud fee with an amount; the rest settle between the owners. */
export function isPaidArrangement(request: { feeType: string; feeCents: number }): boolean {
  return request.feeType === "FEE" && request.feeCents > 0;
}

/** Commission on a stud fee, after the stud owner's plan discount. */
export async function breedingCommission(payeeUserId: string, feeCents: number) {
  const [baseBps, entitlements] = await Promise.all([
    resolveCommissionBps("BREEDING"),
    getEntitlements(payeeUserId),
  ]);
  const bps = Math.max(0, baseBps - entitlements.commissionDiscountBps);
  const commissionCents = applyBps(feeCents, bps);
  return { bps, commissionCents, payoutCents: feeCents - commissionCents };
}

/** How long a payer has to object after the stud's owner records the breeding. */
export async function feeReviewHours(): Promise<number> {
  const settings = await getSettings();
  // The pet-sale escrow window is the platform's one "time to object" setting;
  // a breeding is quicker to confirm than a handover, so it is capped at 3 days.
  return Math.min(settings.escrowAutoReleaseHours || FEE_REVIEW_HOURS_FALLBACK, FEE_REVIEW_HOURS_FALLBACK);
}

const FEE_REQUEST_SELECT = {
  id: true,
  status: true,
  feeStatus: true,
  feeCents: true,
  currency: true,
  feeType: true,
  feePayerUserId: true,
  feePayeeUserId: true,
  feePaymentIntentId: true,
  initiatorAgreedAt: true,
  receiverAgreedAt: true,
  initiatorUserId: true,
  receiverUserId: true,
  conversationId: true,
  initiatorPet: { select: { name: true } },
  receiverPet: { select: { name: true } },
} as const;

async function loadForParty(auth: AuthContext, requestId: string) {
  const request = await db.breedingRequest.findUnique({ where: { id: requestId }, select: FEE_REQUEST_SELECT });
  if (!request) throw notFound("That request");
  if (request.initiatorUserId !== auth.user.id && request.receiverUserId !== auth.user.id) {
    throw notFound("That request");
  }
  return request;
}

/**
 * Starts (or resumes) the payer's checkout for an agreed stud fee.
 *
 * The amount and the commission are the server's, fixed here from the agreed
 * terms and the stud owner's current plan. The idempotency key is tied to the
 * agreement itself, so paying twice for the same terms returns the same intent.
 */
export async function startBreedingFeePayment(auth: AuthContext, requestId: string): Promise<PaymentHandle> {
  const request = await loadForParty(auth, requestId);

  if (request.feePayerUserId !== auth.user.id) {
    throw conflict("Only the owner paying the stud fee can pay it.");
  }
  if (!["AGREED", "SCHEDULED"].includes(request.status) || request.feeStatus !== "DUE") {
    throw conflict("There is no stud fee to pay for this breeding.");
  }
  if (!request.feePayeeUserId || !isPaidArrangement(request)) {
    throw conflict("There is no stud fee to pay for this breeding.");
  }

  const { commissionCents, payoutCents } = await breedingCommission(request.feePayeeUserId, request.feeCents);
  await db.breedingRequest.updateMany({
    where: { id: request.id, feeStatus: "DUE" },
    data: { feeCommissionCents: commissionCents, feePayoutCents: payoutCents },
  });

  const agreedStamp = Math.max(
    request.initiatorAgreedAt?.getTime() ?? 0,
    request.receiverAgreedAt?.getTime() ?? 0,
  );

  return createPayment({
    userId: auth.user.id,
    purpose: "BREEDING_FEE",
    referenceType: "BREEDING_REQUEST",
    referenceId: request.id,
    amountCents: request.feeCents,
    currency: request.currency,
    description: `Stud fee — ${request.initiatorPet.name} × ${request.receiverPet.name}`,
    idempotencyKey: `breeding:${request.id}:${agreedStamp}`,
    returnUrl: `${clientEnv.NEXT_PUBLIC_APP_URL}/dashboard/breeding/requests/${request.id}`,
    customerEmail: auth.user.email,
  });
}

/**
 * What recording an outcome means for a held fee. Called by the breeding
 * service after it has moved the request to COMPLETED or CANCELLED.
 */
export async function applyOutcomeToFee(
  auth: AuthContext,
  requestId: string,
  outcome: "SUCCESSFUL" | "UNSUCCESSFUL" | "CANCELLED",
): Promise<void> {
  const request = await db.breedingRequest.findUnique({ where: { id: requestId }, select: FEE_REQUEST_SELECT });
  if (!request) return;

  if (outcome === "CANCELLED") {
    // A fee that was never paid simply stops being owed.
    await db.breedingRequest.updateMany({ where: { id: requestId, feeStatus: "DUE" }, data: { feeStatus: "NONE" } });
    if (request.feeStatus === "HELD") {
      await refundBreedingFee({ requestId, actorId: auth.user.id, reason: "Breeding cancelled" });
    }
    return;
  }

  if (request.feeStatus !== "HELD") return;

  if (request.feePayerUserId === auth.user.id) {
    // The person who paid says it happened: nothing left to wait for.
    await releaseBreedingFee({ requestId, reason: "PAYER_CONFIRMED", actorId: auth.user.id });
    return;
  }

  // The stud's owner recorded it. The payer gets a window to object first.
  const hours = await feeReviewHours();
  const releaseAt = new Date(Date.now() + hours * 3_600_000);
  await db.breedingRequest.updateMany({
    where: { id: requestId, feeStatus: "HELD" },
    data: { feeReleaseAt: releaseAt },
  });
  await enqueueJob({
    type: "breeding.releaseFee",
    payload: { requestId },
    runAt: releaseAt,
    uniqueKey: `breeding.releaseFee:${requestId}`,
  });

  if (request.feePayerUserId) {
    await notify({
      userId: request.feePayerUserId,
      category: "BREEDING",
      type: "breeding.fee_review",
      title: "Confirm the breeding to release the stud fee",
      body: `The other owner recorded the breeding. The fee is paid to them automatically in ${hours} hours unless you report a problem.`,
      url: `/dashboard/breeding/requests/${requestId}`,
      entityType: "BREEDING_REQUEST",
      entityId: requestId,
    });
  }
}

/** The payer confirms early, after the stud's owner recorded the breeding. */
export async function confirmBreedingFeeRelease(auth: AuthContext, requestId: string) {
  const request = await loadForParty(auth, requestId);
  if (request.feePayerUserId !== auth.user.id) throw conflict("Only the owner who paid can release the fee.");
  if (request.status !== "COMPLETED" || request.feeStatus !== "HELD") {
    throw conflict("This fee cannot be released right now.");
  }

  const { released } = await releaseBreedingFee({ requestId, reason: "PAYER_CONFIRMED", actorId: auth.user.id });
  if (!released) throw conflict("This fee has already been settled.");

  await audit({
    action: "breeding.fee_released",
    actorId: auth.user.id,
    entityType: "BREEDING_REQUEST",
    entityId: requestId,
    summary: "Released by the payer",
  });
  return { released };
}

/**
 * Run by `breeding.releaseFee` once the review window closes. A report
 * (FROZEN) or an early release (RELEASED) leaves nothing for it to do.
 */
export async function autoReleaseBreedingFee(requestId: string): Promise<"released" | "not due"> {
  const request = await db.breedingRequest.findUnique({
    where: { id: requestId },
    select: { status: true, feeStatus: true, feeReleaseAt: true },
  });
  if (!request || request.status !== "COMPLETED" || request.feeStatus !== "HELD") return "not due";
  if (!request.feeReleaseAt || request.feeReleaseAt > new Date()) return "not due";

  const { released } = await releaseBreedingFee({ requestId, reason: "AUTO_RELEASE" });
  return released ? "released" : "not due";
}

/**
 * The payer says the breeding did not happen as agreed. The fee is frozen and
 * a high-priority support ticket opened; only staff move it from there.
 */
export async function reportBreedingFeeProblem(auth: AuthContext, requestId: string, details: string) {
  const request = await loadForParty(auth, requestId);
  if (request.feePayerUserId !== auth.user.id) throw conflict("Only the owner who paid can report a problem with the fee.");

  const frozen = await db.breedingRequest.updateMany({
    where: { id: requestId, feeStatus: "HELD" },
    data: { feeStatus: "FROZEN", feeReleaseAt: null },
  });
  if (frozen.count === 0) throw conflict("This fee has already been settled.");

  const pairing = `${request.initiatorPet.name} × ${request.receiverPet.name}`;
  const ticket = await createSupportTicket(
    {
      name: auth.user.name,
      email: auth.user.email,
      topic: "PAYMENT",
      subject: `Breeding fee problem: ${pairing}`.slice(0, 140),
      message: `${details}\n\nBreeding request ${requestId}, fee ${formatMoney(request.feeCents, request.currency)}.`,
      orderRef: requestId,
    },
    { userId: auth.user.id },
  );

  await audit({
    action: "breeding.fee_disputed",
    actorId: auth.user.id,
    entityType: "BREEDING_REQUEST",
    entityId: requestId,
    summary: details.slice(0, 200),
    metadata: { ticket: ticket.reference },
  });

  if (request.feePayeeUserId) {
    await notify({
      userId: request.feePayeeUserId,
      category: "BREEDING",
      type: "breeding.fee_disputed",
      title: "The stud fee is on hold",
      body: "The other owner reported a problem with this breeding. Our team will review it and contact you both.",
      url: `/dashboard/breeding/requests/${requestId}`,
      entityType: "BREEDING_REQUEST",
      entityId: requestId,
    });
  }
  if (request.conversationId) {
    await postSystemMessage({
      conversationId: request.conversationId,
      systemType: "breeding.fee_disputed",
      body: "The stud fee is on hold while PetMate reviews a reported problem.",
      data: { requestId },
    });
  }

  return { ticket: ticket.reference };
}

/**
 * Returns a held (or frozen) fee to the payer in full.
 *
 * The escrow is emptied into the account refunds are drawn from in the same
 * step as the status change; the gateway refund follows. If the gateway call
 * fails, the fee is left as REFUND_PENDING, which staff can retry, rather than
 * pretending the money went back.
 */
export async function refundBreedingFee(params: {
  requestId: string;
  actorId: string;
  reason: string;
  staff?: boolean;
}): Promise<{ refunded: boolean }> {
  const request = await db.breedingRequest.findUnique({
    where: { id: params.requestId },
    select: { id: true, feeCents: true, currency: true, feePaymentIntentId: true, feePayerUserId: true, feeStatus: true },
  });
  if (!request || !request.feePaymentIntentId) return { refunded: false };

  // A refund that already came out of escrow only needs the gateway step again.
  if (request.feeStatus !== "REFUND_PENDING") {
    const from = params.staff ? ["HELD", "FROZEN"] : ["HELD"];
    const claimed = await db.$transaction(async (tx) => {
      const moved = await tx.breedingRequest.updateMany({
        where: { id: request.id, feeStatus: { in: from } },
        data: { feeStatus: "REFUND_PENDING", feeReleaseAt: null },
      });
      if (moved.count === 0) return false;
      await postTransaction(
        {
          kind: "ESCROW_RELEASE",
          description: `Breeding fee returned: ${params.reason}`,
          currency: request.currency,
          referenceType: "BREEDING_REQUEST",
          referenceId: request.id,
          createdById: params.actorId,
          entries: [
            { account: accounts.escrow(request.currency), amountCents: -request.feeCents },
            { account: accounts.platformRevenue(request.currency), amountCents: request.feeCents },
          ],
        },
        tx,
      );
      return true;
    });
    if (!claimed) return { refunded: false };
  } else if (!params.staff) {
    return { refunded: false };
  }

  try {
    await refundPayment({
      intentId: request.feePaymentIntentId,
      amountCents: request.feeCents,
      reason: "CANCELLED_ORDER",
      approvedById: params.actorId,
      note: params.reason.slice(0, 300),
      idempotencyKey: `breeding_refund_${request.id}`,
    });
  } catch (e) {
    logger.exception("breeding fee refund failed at the gateway", e, { requestId: request.id });
    return { refunded: false };
  }

  await db.breedingRequest.update({
    where: { id: request.id },
    data: { feeStatus: "REFUNDED", feeRefundedAt: new Date() },
  });

  await audit({
    action: "breeding.fee_refunded",
    actorId: params.actorId,
    entityType: "BREEDING_REQUEST",
    entityId: request.id,
    summary: params.reason,
  });

  if (request.feePayerUserId) {
    await notify({
      userId: request.feePayerUserId,
      category: "BREEDING",
      type: "breeding.fee_refunded",
      title: "Stud fee refunded",
      body: `${formatMoney(request.feeCents, request.currency)} is on its way back to you.`,
      url: `/dashboard/breeding/requests/${request.id}`,
      entityType: "BREEDING_REQUEST",
      entityId: request.id,
    });
  }

  return { refunded: true };
}

/** Staff decide a reported fee, or retry a refund the gateway refused. */
export async function resolveBreedingFee(
  staff: AuthContext,
  requestId: string,
  decision: "RELEASE" | "REFUND",
  note: string,
) {
  const request = await db.breedingRequest.findUnique({
    where: { id: requestId },
    select: { feeStatus: true },
  });
  if (!request) throw notFound("That request");

  if (decision === "RELEASE") {
    if (request.feeStatus !== "FROZEN" && request.feeStatus !== "HELD") {
      throw conflict("This fee has already been settled.");
    }
    const { released } = await releaseBreedingFee({ requestId, reason: "STAFF_DECISION", actorId: staff.user.id });
    if (!released) throw conflict("This fee has already been settled.");
    await audit({
      action: "breeding.fee_released",
      actorId: staff.user.id,
      entityType: "BREEDING_REQUEST",
      entityId: requestId,
      summary: note,
    });
    return { feeStatus: "RELEASED" };
  }

  if (!["FROZEN", "HELD", "REFUND_PENDING"].includes(request.feeStatus)) {
    throw conflict("This fee has already been settled.");
  }
  const { refunded } = await refundBreedingFee({ requestId, actorId: staff.user.id, reason: note, staff: true });
  return { feeStatus: refunded ? "REFUNDED" : "REFUND_PENDING" };
}

/** Fees that need a person: reported by the payer, or a refund the gateway refused. */
export async function listBreedingFeesNeedingReview() {
  return db.breedingRequest.findMany({
    where: { feeStatus: { in: ["FROZEN", "REFUND_PENDING"] } },
    orderBy: { updatedAt: "asc" },
    take: 50,
    select: {
      id: true,
      feeStatus: true,
      feeCents: true,
      currency: true,
      feePayoutCents: true,
      updatedAt: true,
      initiatorPet: { select: { name: true } },
      receiverPet: { select: { name: true } },
      initiatorUser: { select: { id: true, name: true, email: true } },
      receiverUser: { select: { id: true, name: true, email: true } },
      feePayerUserId: true,
    },
  });
}
