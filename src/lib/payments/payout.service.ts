import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { notFound, conflict, badRequest } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/services/notification.service";
import { getSettings } from "@/lib/settings";
import { formatMoney } from "@/lib/money";
import { getBalance, postTransaction, accounts } from "./ledger-core";
import { emailTemplates } from "@/lib/email";
import { clientEnv } from "@/lib/env";
import type { AuthContext } from "@/lib/auth/session";
import { cuidSchema, centsSchema, safeText, priceCurrencySchema } from "@/lib/validation/common";

/**
 * Payouts: money leaving PetMate for someone's bank.
 *
 * The important property is that a payout is a ledger movement, not a status
 * column. Requesting one debits the AVAILABLE account immediately and credits
 * a PAYABLE account, so the balance on screen drops the moment the request is
 * made and the same money cannot be requested twice. Rejecting reverses that
 * posting; paying moves it out to the external account.
 *
 * Bank details are never stored here. `destination` holds a masked reference
 * the requester typed for their own recognition ("HSBC ••4417"), and the real
 * transfer happens in the banking system a human operates.
 */

export type PayoutOwnerType = "USER" | "SHOP" | "CLINIC";

export const payoutRequestSchema = z.object({
  ownerType: z.enum(["USER", "SHOP", "CLINIC"]),
  ownerId: cuidSchema.optional(),
  amountCents: centsSchema,
  currency: priceCurrencySchema,
  destination: safeText(60, 2),
  note: safeText(300, 0).optional(),
});

export type PayoutRequestInput = z.infer<typeof payoutRequestSchema>;

function payableAccount(ownerType: PayoutOwnerType, ownerId: string, currency: string) {
  return { ownerType, ownerId, kind: "PAYABLE" as const, currency };
}

function availableAccount(ownerType: PayoutOwnerType, ownerId: string, currency: string) {
  if (ownerType === "SHOP") return accounts.sellerAvailable(ownerId, currency);
  if (ownerType === "CLINIC") return accounts.clinicAvailable(ownerId, currency);
  return accounts.userAvailable(ownerId, currency);
}

/** Confirms the caller may draw on this account, and returns who to notify. */
async function assertPayoutAccess(
  auth: AuthContext,
  ownerType: PayoutOwnerType,
  ownerId: string,
): Promise<{ notifyUserId: string; label: string }> {
  if (ownerType === "USER") {
    // Only your own balance, ever.
    if (ownerId !== auth.user.id) throw notFound("That account");
    return { notifyUserId: auth.user.id, label: "your balance" };
  }

  if (ownerType === "SHOP") {
    const shop = await db.shop.findFirst({
      where: { id: ownerId, ownerUserId: auth.user.id, deletedAt: null },
      select: { id: true, name: true, ownerUserId: true },
    });
    if (!shop) throw notFound("That shop");
    return { notifyUserId: shop.ownerUserId, label: shop.name };
  }

  // A clinic payout is the owner's call, not any staff member's: a vet with
  // records access must not be able to move the clinic's money.
  const clinic = await db.clinic.findFirst({
    where: { id: ownerId, ownerUserId: auth.user.id, deletedAt: null },
    select: { id: true, name: true, ownerUserId: true },
  });
  if (!clinic) throw notFound("That clinic");
  return { notifyUserId: clinic.ownerUserId, label: clinic.name };
}

export async function requestPayout(auth: AuthContext, input: PayoutRequestInput) {
  const ownerId = input.ownerId ?? auth.user.id;
  const { notifyUserId, label } = await assertPayoutAccess(auth, input.ownerType, ownerId);

  const settings = await getSettings();
  if (input.amountCents < settings.minPayoutCents) {
    throw badRequest(
      `The smallest payout is ${formatMoney(settings.minPayoutCents, input.currency)}.`,
    );
  }

  const payout = await db.$transaction(async (tx) => {
    // Read the balance inside the transaction, then post the debit in the same
    // one. Two concurrent requests cannot both see the full balance and both
    // succeed, because the second reads a book the first has already moved.
    const available = await getBalance(
      availableAccount(input.ownerType, ownerId, input.currency),
      tx,
    );

    if (available < input.amountCents) {
      throw conflict(
        `You have ${formatMoney(available, input.currency)} available, which is less than that.`,
      );
    }

    const created = await tx.payout.create({
      data: {
        ownerType: input.ownerType,
        ownerId,
        amountCents: input.amountCents,
        currency: input.currency,
        status: "REQUESTED",
        method: "BANK_TRANSFER",
        // Deliberately just a label. Real bank details are entered in the
        // banking system by a person, never stored here.
        destination: input.destination,
        note: input.note ?? null,
      },
      select: { id: true, amountCents: true, currency: true, status: true, requestedAt: true },
    });

    await postTransaction(
      {
        kind: "PAYOUT",
        description: `Payout requested: ${label}`,
        currency: input.currency,
        referenceType: "PAYOUT",
        referenceId: created.id,
        createdById: auth.user.id,
        entries: [
          {
            account: availableAccount(input.ownerType, ownerId, input.currency),
            amountCents: -input.amountCents,
          },
          {
            account: payableAccount(input.ownerType, ownerId, input.currency),
            amountCents: input.amountCents,
          },
        ],
      },
      tx,
    );

    return created;
  });

  await audit({
    action: "payout.requested",
    actorId: auth.user.id,
    entityType: "PAYOUT",
    entityId: payout.id,
    summary: `${formatMoney(payout.amountCents, payout.currency)} for ${label}`,
  });

  await notify({
    userId: notifyUserId,
    category: "PAYMENT",
    type: "payout.requested",
    title: `Payout of ${formatMoney(payout.amountCents, payout.currency)} requested`,
    body: "We will review it and confirm when the transfer has been sent.",
    url: "/dashboard/wallet",
    entityType: "PAYOUT",
    entityId: payout.id,
  });

  return payout;
}

/**
 * Marks a requested payout as actually sent.
 *
 * The conditional `updateMany` is what makes this exactly-once: two admins
 * clicking at the same moment produce one PAID row and one no-op, rather than
 * two ledger postings for the same money.
 */
export async function markPayoutPaid(
  auth: AuthContext,
  payoutId: string,
  providerRef?: string,
): Promise<void> {
  const payout = await db.payout.findUnique({
    where: { id: payoutId },
    select: {
      id: true,
      ownerType: true,
      ownerId: true,
      amountCents: true,
      currency: true,
      status: true,
    },
  });
  if (!payout) throw notFound("That payout");
  if (payout.status !== "REQUESTED" && payout.status !== "APPROVED") {
    throw conflict("That payout has already been settled.");
  }

  await db.$transaction(async (tx) => {
    const claimed = await tx.payout.updateMany({
      where: { id: payout.id, status: { in: ["REQUESTED", "APPROVED"] } },
      data: {
        status: "PAID",
        paidAt: new Date(),
        approvedById: auth.user.id,
        providerRef: providerRef ?? null,
      },
    });
    if (claimed.count === 0) return;

    await postTransaction(
      {
        kind: "PAYOUT",
        description: "Payout sent",
        currency: payout.currency,
        referenceType: "PAYOUT",
        referenceId: payout.id,
        createdById: auth.user.id,
        entries: [
          {
            account: payableAccount(
              payout.ownerType as PayoutOwnerType,
              payout.ownerId,
              payout.currency,
            ),
            amountCents: -payout.amountCents,
          },
          { account: accounts.external(payout.currency), amountCents: payout.amountCents },
        ],
      },
      tx,
    );
  });

  await audit({
    action: "payout.approved",
    actorId: auth.user.id,
    entityType: "PAYOUT",
    entityId: payout.id,
    summary: formatMoney(payout.amountCents, payout.currency),
  });

  const recipientId = await resolveRecipient(
    payout.ownerType as PayoutOwnerType,
    payout.ownerId,
  );
  if (recipientId) {
    await notify({
      userId: recipientId,
      category: "PAYMENT",
      type: "payout.paid",
      title: `${formatMoney(payout.amountCents, payout.currency)} is on its way`,
      body: "Bank transfers usually take 1–3 working days to appear.",
      url: "/dashboard/wallet",
      entityType: "PAYOUT",
      entityId: payout.id,
      email: () =>
        emailTemplates.payoutProcessed({
          name: "there",
          amount: formatMoney(payout.amountCents, payout.currency),
          url: `${clientEnv.NEXT_PUBLIC_APP_URL}/dashboard/wallet`,
        }),
    });
  }
}

/** Rejecting returns the money to the requester's available balance. */
export async function rejectPayout(
  auth: AuthContext,
  payoutId: string,
  reason: string,
): Promise<void> {
  const payout = await db.payout.findUnique({
    where: { id: payoutId },
    select: {
      id: true,
      ownerType: true,
      ownerId: true,
      amountCents: true,
      currency: true,
      status: true,
    },
  });
  if (!payout) throw notFound("That payout");
  if (payout.status !== "REQUESTED" && payout.status !== "APPROVED") {
    throw conflict("That payout has already been settled.");
  }

  await db.$transaction(async (tx) => {
    const claimed = await tx.payout.updateMany({
      where: { id: payout.id, status: { in: ["REQUESTED", "APPROVED"] } },
      data: { status: "REJECTED", approvedById: auth.user.id, note: reason.slice(0, 300) },
    });
    if (claimed.count === 0) return;

    await postTransaction(
      {
        kind: "PAYOUT",
        description: `Payout rejected: ${reason.slice(0, 120)}`,
        currency: payout.currency,
        referenceType: "PAYOUT",
        referenceId: payout.id,
        createdById: auth.user.id,
        entries: [
          {
            account: payableAccount(
              payout.ownerType as PayoutOwnerType,
              payout.ownerId,
              payout.currency,
            ),
            amountCents: -payout.amountCents,
          },
          {
            account: availableAccount(
              payout.ownerType as PayoutOwnerType,
              payout.ownerId,
              payout.currency,
            ),
            amountCents: payout.amountCents,
          },
        ],
      },
      tx,
    );
  });

  const recipientId = await resolveRecipient(
    payout.ownerType as PayoutOwnerType,
    payout.ownerId,
  );
  if (recipientId) {
    await notify({
      userId: recipientId,
      category: "PAYMENT",
      type: "payout.rejected",
      title: "Your payout request was not approved",
      body: reason.slice(0, 160),
      url: "/dashboard/wallet",
      entityType: "PAYOUT",
      entityId: payout.id,
    });
  }
}

async function resolveRecipient(
  ownerType: PayoutOwnerType,
  ownerId: string,
): Promise<string | null> {
  if (ownerType === "USER") return ownerId;
  if (ownerType === "SHOP") {
    const shop = await db.shop.findUnique({
      where: { id: ownerId },
      select: { ownerUserId: true },
    });
    return shop?.ownerUserId ?? null;
  }
  const clinic = await db.clinic.findUnique({
    where: { id: ownerId },
    select: { ownerUserId: true },
  });
  return clinic?.ownerUserId ?? null;
}

export async function listPayouts(
  ownerType: PayoutOwnerType,
  ownerId: string,
  limit = 25,
) {
  return db.payout.findMany({
    where: { ownerType, ownerId },
    orderBy: { requestedAt: "desc" },
    take: limit,
    select: {
      id: true,
      amountCents: true,
      currency: true,
      status: true,
      destination: true,
      note: true,
      requestedAt: true,
      paidAt: true,
    },
  });
}

/** The admin queue: everything waiting on a human. */
export async function listPendingPayouts() {
  return db.payout.findMany({
    where: { status: { in: ["REQUESTED", "APPROVED"] } },
    orderBy: { requestedAt: "asc" },
    take: 100,
    select: {
      id: true,
      ownerType: true,
      ownerId: true,
      amountCents: true,
      currency: true,
      status: true,
      destination: true,
      requestedAt: true,
    },
  });
}
