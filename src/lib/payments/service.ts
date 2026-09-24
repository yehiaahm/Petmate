import "server-only";
import { db } from "@/lib/db";
import { clientEnv } from "@/lib/env";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { AppError, conflict, notFound, paymentFailed, badRequest } from "@/lib/errors";
import { stringifyJson } from "@/lib/json";
import { formatMoney } from "@/lib/money";
import { generateToken } from "@/lib/utils";
import { createHash } from "node:crypto";
import type { PaymentPurpose } from "@/lib/constants";
import { paymentProvider, isSandboxPayments } from "./provider";
import { accounts, postTransaction } from "./ledger-core";
import { settlePayment } from "./settlement";

/**
 * Payment orchestration.
 *
 * The single rule that everything else follows from: **the client never sends
 * an amount**. A request says "pay for order X"; the server reads order X,
 * recomputes the total from the stored line items, and charges that. A tampered
 * price in a request body has nowhere to land.
 *
 * Exactly-once is enforced in two places:
 *   * `PaymentIntent.idempotencyKey` is unique, so a double-submitted checkout
 *     returns the first intent instead of creating a second charge.
 *   * settlement transitions status with a conditional update, so a webhook
 *     delivered twice applies its effects once.
 */

export interface CreatePaymentInput {
  userId: string;
  purpose: PaymentPurpose;
  referenceType: string;
  referenceId: string;
  /** Server-computed. Callers obtain it from the domain service, never input. */
  amountCents: number;
  currency: string;
  description: string;
  /** Stable per logical attempt; the same key returns the same intent. */
  idempotencyKey: string;
  metadata?: Record<string, string>;
  returnUrl: string;
  customerEmail?: string;
}

export interface PaymentHandle {
  id: string;
  status: string;
  amountCents: number;
  currency: string;
  clientSecret: string | null;
  redirectUrl: string | null;
  provider: string;
  /** True when the sandbox provider is in use, so the UI can say so. */
  sandbox: boolean;
}

export async function createPayment(input: CreatePaymentInput): Promise<PaymentHandle> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new AppError("INTERNAL", "That payment could not be prepared.", {
      internal: `invalid amount ${input.amountCents} for ${input.purpose}`,
    });
  }

  // Replay: same key, same intent. This is what makes a double-clicked
  // "Pay now" button harmless.
  const existing = await db.paymentIntent.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: {
      id: true,
      status: true,
      amountCents: true,
      currency: true,
      clientSecret: true,
      provider: true,
      providerRef: true,
      userId: true,
      metadata: true,
    },
  });

  if (existing) {
    if (existing.userId !== input.userId) {
      // Someone else's key. Never leak the original.
      throw conflict("That payment could not be started. Please refresh and try again.");
    }
    if (existing.amountCents !== input.amountCents) {
      throw conflict("The amount changed since you started. Refresh and try again.");
    }
    return {
      id: existing.id,
      status: existing.status,
      amountCents: existing.amountCents,
      currency: existing.currency,
      clientSecret: existing.clientSecret,
      redirectUrl: resumeRedirect(existing, input.returnUrl),
      provider: existing.provider,
      sandbox: isSandboxPayments(),
    };
  }

  const provider = paymentProvider();

  // Hosted checkouts (Paymob) need the payer's name, email and phone; the
  // account is the source of them, not anything in the request.
  const payer = await db.user.findUnique({
    where: { id: input.userId },
    select: { name: true, email: true, phone: true },
  });
  const [firstName = "", ...rest] = (payer?.name ?? "").trim().split(/\s+/);

  const providerIntent = await provider.createIntent({
    amountCents: input.amountCents,
    currency: input.currency,
    idempotencyKey: input.idempotencyKey,
    // Stable for the key and opaque: the provider echoes it back, and it must
    // not reveal the order number or user id it was derived from.
    reference: `pm_${createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 32)}`,
    customer: payer
      ? { firstName, lastName: rest.join(" "), email: payer.email, phone: payer.phone }
      : undefined,
    description: input.description,
    metadata: {
      ...input.metadata,
      purpose: input.purpose,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      userId: input.userId,
    },
    customerEmail: input.customerEmail,
    returnUrl: input.returnUrl,
  });

  const intent = await db.paymentIntent.create({
    data: {
      userId: input.userId,
      provider: provider.name,
      providerRef: providerIntent.ref,
      purpose: input.purpose,
      amountCents: input.amountCents,
      currency: input.currency,
      status: providerIntent.status,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      idempotencyKey: input.idempotencyKey,
      clientSecret: providerIntent.clientSecret,
      metadata: input.metadata ? stringifyJson(input.metadata) : null,
    },
    select: { id: true, status: true, amountCents: true, currency: true, clientSecret: true },
  });

  await audit({
    action: "payment.created",
    actorId: input.userId,
    entityType: "PAYMENT_INTENT",
    entityId: intent.id,
    summary: `${input.purpose} ${formatMoney(input.amountCents, input.currency)}`,
    metadata: { referenceType: input.referenceType, referenceId: input.referenceId },
  });

  return {
    id: intent.id,
    status: intent.status,
    amountCents: intent.amountCents,
    currency: intent.currency,
    clientSecret: intent.clientSecret,
    redirectUrl: providerIntent.redirectUrl,
    provider: provider.name,
    sandbox: isSandboxPayments(),
  };
}

/**
 * Where to send the payer back to for an intent that already exists — a
 * double-clicked button or a refreshed page. Only the provider that created
 * the intent can resume it.
 */
function resumeRedirect(
  intent: { provider: string; providerRef: string | null; clientSecret: string | null; status: string },
  returnUrl: string,
): string | null {
  if (intent.status !== "REQUIRES_PAYMENT" && intent.status !== "PROCESSING") return null;
  const provider = paymentProvider();
  if (provider.name !== intent.provider) return null;
  return provider.resumeUrl(intent, returnUrl);
}

/**
 * A fresh attempt after a failed one. Hosted checkouts issue single-use
 * secrets, so a declined card needs a new intent rather than the old link.
 * The amount is the one the server computed for the original attempt; the
 * reference entity's own conditional settlement still allows only one of the
 * attempts to take effect.
 */
export async function retryPayment(intentId: string, userId: string, returnUrl: string): Promise<PaymentHandle> {
  const failed = await db.paymentIntent.findFirst({
    where: { id: intentId, userId },
    select: {
      id: true,
      status: true,
      purpose: true,
      referenceType: true,
      referenceId: true,
      amountCents: true,
      currency: true,
      idempotencyKey: true,
      metadata: true,
    },
  });
  if (!failed) throw notFound("That payment");
  if (failed.status !== "FAILED") throw conflict("That payment is no longer active.");

  const attempts = await db.paymentIntent.count({
    where: { userId, referenceType: failed.referenceType, referenceId: failed.referenceId },
  });

  return createPayment({
    userId,
    purpose: failed.purpose as PaymentPurpose,
    referenceType: failed.referenceType ?? "",
    referenceId: failed.referenceId ?? "",
    amountCents: failed.amountCents,
    currency: failed.currency,
    description: `Payment retry for ${failed.purpose}`,
    idempotencyKey: `${failed.idempotencyKey.slice(0, 40)}:retry:${attempts}`,
    returnUrl,
  });
}

// ---------------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------------

/**
 * Marks an intent paid and runs its business effects.
 *
 * Called from the Stripe webhook (after signature verification) and from the
 * sandbox confirmation screen. Both go through the same conditional transition,
 * so neither can apply the effects twice.
 */
export async function confirmPayment(params: {
  intentId?: string;
  providerRef?: string;
  /** The provider's id for the captured charge, kept for refunds. */
  chargeRef?: string;
  actorId?: string;
  /** Sandbox only: the signed-in user confirming their own payment. */
  viaSandbox?: boolean;
}): Promise<{ intentId: string; alreadySettled: boolean }> {
  const intent = await db.paymentIntent.findFirst({
    where: params.intentId ? { id: params.intentId } : { providerRef: params.providerRef! },
    select: {
      id: true,
      userId: true,
      status: true,
      purpose: true,
      amountCents: true,
      currency: true,
      referenceType: true,
      referenceId: true,
      provider: true,
    },
  });

  if (!intent) throw notFound("That payment");

  if (intent.status === "SUCCEEDED") {
    return { intentId: intent.id, alreadySettled: true };
  }
  if (intent.status === "REFUNDED" || intent.status === "CANCELLED") {
    throw conflict("That payment is no longer active.");
  }

  // The sandbox screen may only be used by the payer, and only when the
  // sandbox provider is actually configured.
  if (params.viaSandbox) {
    if (!isSandboxPayments()) throw badRequest("Sandbox confirmation is disabled.");
    if (params.actorId !== intent.userId) throw notFound("That payment");
  }

  // Conditional transition. Concurrent webhook + sandbox confirm: one wins.
  const claimed = await db.paymentIntent.updateMany({
    where: { id: intent.id, status: { in: ["REQUIRES_PAYMENT", "PROCESSING"] } },
    data: {
      status: "SUCCEEDED",
      capturedAt: new Date(),
      ...(params.chargeRef ? { providerChargeRef: params.chargeRef } : {}),
    },
  });

  if (claimed.count === 0) {
    return { intentId: intent.id, alreadySettled: true };
  }

  try {
    await settlePayment(intent.id);
  } catch (e) {
    // The money is captured but the effects failed. Do not roll the capture
    // back and silently drop a real payment: flag it for operations.
    logger.exception("SETTLEMENT FAILED after successful capture", e, {
      intentId: intent.id,
      purpose: intent.purpose,
    });
    await db.paymentIntent.update({
      where: { id: intent.id },
      data: { failureCode: "SETTLEMENT_FAILED", failureMessage: "Captured but not settled" },
    });
    throw paymentFailed(
      "Your payment went through but we could not finish setting it up. Our team has been alerted.",
    );
  }

  await audit({
    action: "payment.succeeded",
    actorId: params.actorId ?? intent.userId,
    entityType: "PAYMENT_INTENT",
    entityId: intent.id,
    summary: `${intent.purpose} ${formatMoney(intent.amountCents, intent.currency)}`,
  });

  return { intentId: intent.id, alreadySettled: false };
}

export async function failPayment(params: {
  providerRef: string;
  code?: string;
  message?: string;
}): Promise<void> {
  const updated = await db.paymentIntent.updateMany({
    where: { providerRef: params.providerRef, status: { in: ["REQUIRES_PAYMENT", "PROCESSING"] } },
    data: {
      status: "FAILED",
      failureCode: params.code?.slice(0, 80) ?? null,
      failureMessage: params.message?.slice(0, 300) ?? null,
    },
  });

  if (updated.count > 0) {
    const intent = await db.paymentIntent.findFirst({
      where: { providerRef: params.providerRef },
      select: { id: true, userId: true, purpose: true, referenceType: true, referenceId: true },
    });
    if (intent) {
      await audit({
        action: "payment.failed",
        actorId: intent.userId,
        entityType: "PAYMENT_INTENT",
        entityId: intent.id,
        summary: params.message ?? params.code ?? "Payment failed",
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

export async function refundPayment(params: {
  intentId: string;
  amountCents: number;
  reason: "REQUESTED_BY_CUSTOMER" | "DUPLICATE" | "FRAUDULENT" | "DISPUTE_RESOLUTION" | "CANCELLED_ORDER";
  approvedById: string;
  note?: string;
  idempotencyKey?: string;
}): Promise<{ refundId: string; amountCents: number }> {
  const intent = await db.paymentIntent.findUnique({
    where: { id: params.intentId },
    select: {
      id: true,
      userId: true,
      status: true,
      amountCents: true,
      refundedCents: true,
      currency: true,
      provider: true,
      providerRef: true,
      providerChargeRef: true,
      purpose: true,
      referenceType: true,
      referenceId: true,
    },
  });

  if (!intent) throw notFound("That payment");
  if (intent.status !== "SUCCEEDED" && intent.status !== "PARTIALLY_REFUNDED") {
    throw conflict("Only a completed payment can be refunded.");
  }

  const remaining = intent.amountCents - intent.refundedCents;
  if (params.amountCents <= 0) throw badRequest("A refund must be greater than zero.");
  if (params.amountCents > remaining) {
    throw conflict(
      `Only ${formatMoney(remaining, intent.currency)} of this payment can still be refunded.`,
    );
  }

  const idempotencyKey = params.idempotencyKey ?? `refund_${intent.id}_${generateToken(8)}`;

  const existing = await db.refund.findUnique({
    where: { idempotencyKey },
    select: { id: true, amountCents: true },
  });
  if (existing) return { refundId: existing.id, amountCents: existing.amountCents };

  const provider = paymentProvider();
  let providerRef: string | null = null;

  // The money goes back through the gateway that took it. A sandbox payment
  // has no gateway to return it through, and an intent taken by a provider
  // that is no longer configured cannot be refunded by the current one.
  if (intent.provider !== "ledger") {
    if (provider.name !== intent.provider || !intent.providerRef) {
      throw paymentFailed(
        "We could not process that refund. Please try again.",
        `intent ${intent.id} was taken by ${intent.provider}, current provider is ${provider.name}`,
      );
    }
    const result = await provider.refund({
      intentRef: intent.providerRef,
      chargeRef: intent.providerChargeRef,
      amountCents: params.amountCents,
      idempotencyKey,
      reason: params.reason,
    });
    providerRef = result.ref;
    if (result.status === "FAILED") throw paymentFailed("The refund was declined by the payment provider.");
  }

  const refund = await db.$transaction(async (tx) => {
    const created = await tx.refund.create({
      data: {
        paymentIntentId: intent.id,
        amountCents: params.amountCents,
        currency: intent.currency,
        reason: params.reason,
        status: "SUCCEEDED",
        note: params.note ?? null,
        approvedById: params.approvedById,
        providerRef,
        idempotencyKey,
        completedAt: new Date(),
      },
      select: { id: true, amountCents: true },
    });

    const totalRefunded = intent.refundedCents + params.amountCents;

    await tx.paymentIntent.update({
      where: { id: intent.id },
      data: {
        refundedCents: totalRefunded,
        status: totalRefunded >= intent.amountCents ? "REFUNDED" : "PARTIALLY_REFUNDED",
      },
    });

    // Money leaves the platform and returns to the customer's funding source.
    await postTransaction(
      {
        kind: "REFUND",
        description: `Refund for ${intent.purpose}`,
        currency: intent.currency,
        paymentIntentId: intent.id,
        referenceType: intent.referenceType ?? undefined,
        referenceId: intent.referenceId ?? undefined,
        createdById: params.approvedById,
        entries: [
          { account: accounts.platformRevenue(intent.currency), amountCents: -params.amountCents },
          { account: accounts.external(intent.currency), amountCents: params.amountCents },
        ],
      },
      tx,
    );

    await audit(
      {
        action: "payment.refunded",
        actorId: params.approvedById,
        entityType: "PAYMENT_INTENT",
        entityId: intent.id,
        summary: `${formatMoney(params.amountCents, intent.currency)} — ${params.reason}`,
        metadata: { note: params.note },
      },
      tx,
    );

    return created;
  });

  const { notify } = await import("@/lib/services/notification.service");
  await notify({
    userId: intent.userId,
    category: "PAYMENT",
    type: "payment.refunded",
    title: `Refund of ${formatMoney(params.amountCents, intent.currency)} issued`,
    body: params.note ?? "The refund will appear on your statement within a few working days.",
    url: "/dashboard/payments",
  });

  return { refundId: refund.id, amountCents: refund.amountCents };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getPaymentForUser(intentId: string, userId: string) {
  const intent = await db.paymentIntent.findFirst({
    where: { id: intentId, userId },
    select: {
      id: true,
      status: true,
      amountCents: true,
      currency: true,
      purpose: true,
      referenceType: true,
      referenceId: true,
      createdAt: true,
      capturedAt: true,
      refundedCents: true,
      provider: true,
    },
  });
  if (!intent) throw notFound("That payment");
  return intent;
}

export async function listPaymentsForUser(userId: string, limit = 25) {
  return db.paymentIntent.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 100),
    select: {
      id: true,
      status: true,
      amountCents: true,
      currency: true,
      purpose: true,
      createdAt: true,
      capturedAt: true,
      refundedCents: true,
      invoice: { select: { id: true, number: true } },
    },
  });
}

export const appUrl = (path: string) => `${clientEnv.NEXT_PUBLIC_APP_URL}${path}`;
