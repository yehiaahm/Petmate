import "server-only";
import { PLATFORM_CURRENCY } from "@/lib/currency";
import { db, type DbClient } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { LedgerAccountKind, LedgerOwnerType } from "@/lib/constants";

/**
 * Double-entry ledger.
 *
 * Every movement of money is a transaction whose entries sum to exactly zero.
 * A user's balance is derived from entries, never stored on the user row, which
 * removes the single most common source of accounting drift: two code paths
 * updating a `balance` column and disagreeing.
 *
 * Sign convention: positive credits the account, negative debits it. A charge
 * of 5000 from a customer card into escrow is:
 *
 *   EXTERNAL/GATEWAY  -5000     (money entering the system from outside)
 *   ESCROW/ESCROW     +5000
 *
 * `assertLedgerBalanced()` verifies the whole book and is asserted in tests.
 */

export const PLATFORM_OWNER_ID = "platform";
export const ESCROW_OWNER_ID = "escrow";
export const EXTERNAL_OWNER_ID = "external";

export interface AccountRef {
  ownerType: LedgerOwnerType;
  ownerId: string;
  kind: LedgerAccountKind;
  currency?: string;
}

export interface EntryInput {
  account: AccountRef;
  /** Positive credits, negative debits. */
  amountCents: number;
}

export interface PostTransactionInput {
  kind:
    | "CHARGE"
    | "ESCROW_HOLD"
    | "ESCROW_RELEASE"
    | "COMMISSION"
    | "PAYOUT"
    | "REFUND"
    | "ADJUSTMENT"
    | "SUBSCRIPTION";
  description: string;
  entries: EntryInput[];
  currency?: string;
  referenceType?: string;
  referenceId?: string;
  paymentIntentId?: string;
  createdById?: string;
}

export async function getOrCreateAccount(
  ref: AccountRef,
  client: DbClient = db,
): Promise<{ id: string }> {
  const currency = ref.currency ?? PLATFORM_CURRENCY;
  const where = {
    ownerType_ownerId_kind_currency: {
      ownerType: ref.ownerType,
      ownerId: ref.ownerId,
      kind: ref.kind,
      currency,
    },
  };

  const existing = await client.ledgerAccount.findUnique({ where, select: { id: true } });
  if (existing) return existing;

  // Two concurrent first-time postings can both miss; the unique index makes
  // the loser's create fail and we simply read the winner's row.
  try {
    return await client.ledgerAccount.create({
      data: { ownerType: ref.ownerType, ownerId: ref.ownerId, kind: ref.kind, currency },
      select: { id: true },
    });
  } catch {
    const row = await client.ledgerAccount.findUnique({ where, select: { id: true } });
    if (!row) throw new AppError("INTERNAL", "Could not open the ledger account.");
    return row;
  }
}

/**
 * Posts a balanced transaction. Refuses anything that does not sum to zero,
 * which is the invariant that makes the whole ledger trustworthy.
 *
 * Must be called inside a transaction when it accompanies other writes.
 */
export async function postTransaction(
  input: PostTransactionInput,
  client: DbClient = db,
): Promise<{ id: string }> {
  const currency = input.currency ?? PLATFORM_CURRENCY;

  if (input.entries.length < 2) {
    throw new AppError("INTERNAL", "A ledger transaction needs at least two entries.", {
      internal: `kind=${input.kind}`,
    });
  }

  const sum = input.entries.reduce((acc, e) => acc + e.amountCents, 0);
  if (sum !== 0) {
    throw new AppError("INTERNAL", "Could not record that transaction.", {
      internal: `unbalanced ledger transaction: kind=${input.kind} sum=${sum}`,
    });
  }

  if (input.entries.some((e) => !Number.isInteger(e.amountCents))) {
    throw new AppError("INTERNAL", "Could not record that transaction.", {
      internal: "non-integer ledger amount",
    });
  }

  const accountIds = await Promise.all(
    input.entries.map((e) => getOrCreateAccount({ ...e.account, currency }, client)),
  );

  const transaction = await client.ledgerTransaction.create({
    data: {
      kind: input.kind,
      description: input.description.slice(0, 300),
      currency,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      paymentIntentId: input.paymentIntentId ?? null,
      createdById: input.createdById ?? null,
      entries: {
        create: input.entries.map((e, i) => ({
          accountId: accountIds[i]!.id,
          amountCents: e.amountCents,
          currency,
        })),
      },
    },
    select: { id: true },
  });

  return transaction;
}

export async function getBalance(
  ref: AccountRef,
  client: DbClient = db,
): Promise<number> {
  const currency = ref.currency ?? PLATFORM_CURRENCY;
  const account = await client.ledgerAccount.findUnique({
    where: {
      ownerType_ownerId_kind_currency: {
        ownerType: ref.ownerType,
        ownerId: ref.ownerId,
        kind: ref.kind,
        currency,
      },
    },
    select: { id: true },
  });
  if (!account) return 0;

  const result = await client.ledgerEntry.aggregate({
    where: { accountId: account.id },
    _sum: { amountCents: true },
  });
  return result._sum.amountCents ?? 0;
}

export interface EarningsSummary {
  availableCents: number;
  pendingCents: number;
  lifetimeCents: number;
  currency: string;
}

/** What a seller or clinic sees on their earnings page. */
export async function getEarnings(
  ownerType: Extract<LedgerOwnerType, "SHOP" | "CLINIC" | "USER">,
  ownerId: string,
  currency: string = PLATFORM_CURRENCY,
): Promise<EarningsSummary> {
  const [available, pending] = await Promise.all([
    getBalance({ ownerType, ownerId, kind: "AVAILABLE", currency }),
    getBalance({ ownerType, ownerId, kind: "PENDING", currency }),
  ]);

  // Lifetime is every credit ever posted to either account, ignoring payouts.
  const accounts = await db.ledgerAccount.findMany({
    where: { ownerType, ownerId, currency, kind: { in: ["AVAILABLE", "PENDING"] } },
    select: { id: true },
  });

  const lifetime = accounts.length
    ? await db.ledgerEntry.aggregate({
        where: { accountId: { in: accounts.map((a) => a.id) }, amountCents: { gt: 0 } },
        _sum: { amountCents: true },
      })
    : { _sum: { amountCents: 0 } };

  return {
    availableCents: available,
    pendingCents: pending,
    lifetimeCents: lifetime._sum.amountCents ?? 0,
    currency,
  };
}

export async function listLedgerEntries(
  ownerType: LedgerOwnerType,
  ownerId: string,
  opts: { limit?: number; currency?: string } = {},
) {
  const accounts = await db.ledgerAccount.findMany({
    where: { ownerType, ownerId, currency: opts.currency ?? PLATFORM_CURRENCY },
    select: { id: true, kind: true },
  });
  if (!accounts.length) return [];

  const entries = await db.ledgerEntry.findMany({
    where: { accountId: { in: accounts.map((a) => a.id) } },
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.limit ?? 50, 200),
    select: {
      id: true,
      amountCents: true,
      currency: true,
      createdAt: true,
      accountId: true,
      transaction: {
        select: { kind: true, description: true, referenceType: true, referenceId: true },
      },
    },
  });

  const kindById = new Map(accounts.map((a) => [a.id, a.kind]));
  return entries.map((e) => ({ ...e, accountKind: kindById.get(e.accountId) ?? "AVAILABLE" }));
}

/**
 * Whole-book integrity check: every transaction must sum to zero, and so must
 * the ledger as a whole. Run in tests and exposed at /api/admin/ledger/verify.
 */
export async function assertLedgerBalanced(): Promise<{
  ok: boolean;
  totalCents: number;
  unbalanced: { transactionId: string; sum: number }[];
}> {
  const grouped = await db.ledgerEntry.groupBy({
    by: ["transactionId"],
    _sum: { amountCents: true },
  });

  const unbalanced = grouped
    .filter((g) => (g._sum.amountCents ?? 0) !== 0)
    .map((g) => ({ transactionId: g.transactionId, sum: g._sum.amountCents ?? 0 }));

  const total = await db.ledgerEntry.aggregate({ _sum: { amountCents: true } });

  return {
    ok: unbalanced.length === 0 && (total._sum.amountCents ?? 0) === 0,
    totalCents: total._sum.amountCents ?? 0,
    unbalanced,
  };
}

// ---------------------------------------------------------------------------
// Named account shorthands
// ---------------------------------------------------------------------------

export const accounts = {
  /** Money outside the system: the customer's card, the acquiring bank. */
  external: (currency: string = PLATFORM_CURRENCY): AccountRef => ({
    ownerType: "EXTERNAL",
    ownerId: EXTERNAL_OWNER_ID,
    kind: "GATEWAY",
    currency,
  }),
  escrow: (currency: string = PLATFORM_CURRENCY): AccountRef => ({
    ownerType: "ESCROW",
    ownerId: ESCROW_OWNER_ID,
    kind: "ESCROW",
    currency,
  }),
  platformRevenue: (currency: string = PLATFORM_CURRENCY): AccountRef => ({
    ownerType: "PLATFORM",
    ownerId: PLATFORM_OWNER_ID,
    kind: "REVENUE",
    currency,
  }),
  /** What PetMate spends on coupons and referral rewards. Runs negative by design. */
  platformPromotions: (currency: string = PLATFORM_CURRENCY): AccountRef => ({
    ownerType: "PLATFORM",
    ownerId: PLATFORM_OWNER_ID,
    kind: "PROMOTIONS",
    currency,
  }),
  platformFees: (currency: string = PLATFORM_CURRENCY): AccountRef => ({
    ownerType: "PLATFORM",
    ownerId: PLATFORM_OWNER_ID,
    kind: "FEES",
    currency,
  }),
  sellerPending: (shopId: string, currency: string = PLATFORM_CURRENCY): AccountRef => ({
    ownerType: "SHOP",
    ownerId: shopId,
    kind: "PENDING",
    currency,
  }),
  sellerAvailable: (shopId: string, currency: string = PLATFORM_CURRENCY): AccountRef => ({
    ownerType: "SHOP",
    ownerId: shopId,
    kind: "AVAILABLE",
    currency,
  }),
  clinicPending: (clinicId: string, currency: string = PLATFORM_CURRENCY): AccountRef => ({
    ownerType: "CLINIC",
    ownerId: clinicId,
    kind: "PENDING",
    currency,
  }),
  clinicAvailable: (clinicId: string, currency: string = PLATFORM_CURRENCY): AccountRef => ({
    ownerType: "CLINIC",
    ownerId: clinicId,
    kind: "AVAILABLE",
    currency,
  }),
  userPending: (userId: string, currency: string = PLATFORM_CURRENCY): AccountRef => ({
    ownerType: "USER",
    ownerId: userId,
    kind: "PENDING",
    currency,
  }),
  userAvailable: (userId: string, currency: string = PLATFORM_CURRENCY): AccountRef => ({
    ownerType: "USER",
    ownerId: userId,
    kind: "AVAILABLE",
    currency,
  }),
};
