import { z } from "zod";
import { route } from "@/lib/api";
import { requireActive, requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import {
  confirmPayment,
  getPaymentForUser,
  listPaymentsForUser,
  refundPayment,
} from "@/lib/payments/service";
import { isSandboxPayments } from "@/lib/payments/provider";
import { getEarnings, listLedgerEntries } from "@/lib/payments/ledger-core";
import {
  payoutRequestSchema,
  requestPayout,
  listPayouts,
} from "@/lib/payments/payout.service";
import { cuidSchema, optionalText } from "@/lib/validation/common";
import { PLATFORM_CURRENCY } from "@/lib/currency";

export const GET = route({
  auth: true,
  query: z.object({
    mode: z.enum(["list", "one", "earnings", "ledger", "payouts"]).default("list"),
    id: cuidSchema.optional(),
    ownerType: z.enum(["USER", "SHOP", "CLINIC"]).optional(),
    ownerId: cuidSchema.optional(),
  }),
  async handler({ query }) {
    const auth = await requireActive();

    if (query.mode === "one") {
      if (!query.id) throw notFound("That payment");
      const payment = await getPaymentForUser(query.id, auth.user.id);
      return { payment, sandbox: isSandboxPayments() };
    }

    if (query.mode === "earnings" || query.mode === "ledger") {
      const ownerType = query.ownerType ?? "USER";
      const ownerId = query.ownerId ?? auth.user.id;

      // Ownership of the account being read is checked against the database.
      if (ownerType === "USER" && ownerId !== auth.user.id) throw notFound("That account");
      if (ownerType === "SHOP") {
        const shop = await db.shop.findFirst({
          where: { id: ownerId, ownerUserId: auth.user.id },
          select: { id: true },
        });
        if (!shop) throw notFound("That shop");
      }
      if (ownerType === "CLINIC") {
        const clinic = await db.clinic.findFirst({
          where: {
            id: ownerId,
            OR: [{ ownerUserId: auth.user.id }, { members: { some: { userId: auth.user.id } } }],
          },
          select: { id: true },
        });
        if (!clinic) throw notFound("That clinic");
      }

      if (query.mode === "earnings") {
        const earnings = await getEarnings(ownerType, ownerId, PLATFORM_CURRENCY);
        return { earnings };
      }

      const entries = await listLedgerEntries(ownerType, ownerId, { currency: PLATFORM_CURRENCY });
      return { entries };
    }

    if (query.mode === "payouts") {
      // Same ownership checks as the ledger modes, applied by re-entering the
      // branch above is not possible here, so they are repeated deliberately.
      const ownerType = query.ownerType ?? "USER";
      const ownerId = query.ownerId ?? auth.user.id;

      if (ownerType === "USER" && ownerId !== auth.user.id) throw notFound("That account");
      if (ownerType === "SHOP") {
        const shop = await db.shop.findFirst({
          where: { id: ownerId, ownerUserId: auth.user.id },
          select: { id: true },
        });
        if (!shop) throw notFound("That shop");
      }
      if (ownerType === "CLINIC") {
        const clinic = await db.clinic.findFirst({
          where: { id: ownerId, ownerUserId: auth.user.id },
          select: { id: true },
        });
        if (!clinic) throw notFound("That clinic");
      }

      return { payouts: await listPayouts(ownerType, ownerId) };
    }

    const payments = await listPaymentsForUser(auth.user.id);
    return { payments, sandbox: isSandboxPayments() };
  },
});

export const POST = route({
  auth: true,
  rateLimit: "payment",
  body: z.discriminatedUnion("action", [
    // Sandbox confirmation. Guarded by the payer's own identity and only valid
    // when the sandbox provider is configured.
    z.object({ action: z.literal("confirm-sandbox"), providerRef: z.string().min(8).max(100) }),
    z.object({
      action: z.literal("refund"),
      paymentIntentId: cuidSchema,
      amountCents: z.number().int().min(1),
      reason: z.enum([
        "REQUESTED_BY_CUSTOMER",
        "DUPLICATE",
        "FRAUDULENT",
        "DISPUTE_RESOLUTION",
        "CANCELLED_ORDER",
      ]),
      note: optionalText(500),
    }),
    z.object({ action: z.literal("request-payout"), payout: payoutRequestSchema }),
  ]),
  async handler({ body }) {
    if (body.action === "request-payout") {
      const auth = await requireActive();
      const payout = await requestPayout(auth, body.payout);
      return { payout };
    }

    if (body.action === "confirm-sandbox") {
      const auth = await requireActive();
      const result = await confirmPayment({
        providerRef: body.providerRef,
        actorId: auth.user.id,
        viaSandbox: true,
      });
      return result;
    }

    // Refunds are a staff action. A seller cannot refund their own transaction
    // to move money around, and a buyer cannot refund themselves.
    const auth = await requireAdmin();
    return refundPayment({
      intentId: body.paymentIntentId,
      amountCents: body.amountCents,
      reason: body.reason,
      approvedById: auth.user.id,
      note: body.note,
    });
  },
});
