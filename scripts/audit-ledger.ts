import { config } from "dotenv";
config();

import { PrismaClient } from "@prisma/client";

/**
 * Prints the ledger and checks the books balance.
 *
 * Every transaction must sum to zero, and so must the whole ledger. Running
 * this against a live database is the fastest way to answer "is the money
 * accounted for".
 */
const db = new PrismaClient();

async function main() {
  const accounts = await db.ledgerAccount.findMany({
    select: { id: true, ownerType: true, ownerId: true, kind: true, currency: true },
  });

  console.log("ACCOUNT BALANCES");
  console.log("─".repeat(72));

  for (const account of accounts) {
    const sum = await db.ledgerEntry.aggregate({
      where: { accountId: account.id },
      _sum: { amountCents: true },
    });
    const cents = sum._sum.amountCents ?? 0;
    const owner =
      account.ownerId.length > 12 ? `${account.ownerId.slice(0, 10)}…` : account.ownerId;

    console.log(
      `${account.ownerType.padEnd(9)} ${owner.padEnd(13)} ${account.kind.padEnd(10)} ` +
        `${(cents / 100).toFixed(2).padStart(12)} ${account.currency}`,
    );
  }

  const grouped = await db.ledgerEntry.groupBy({
    by: ["transactionId"],
    _sum: { amountCents: true },
  });
  const unbalanced = grouped.filter((g) => (g._sum.amountCents ?? 0) !== 0);
  const total = await db.ledgerEntry.aggregate({ _sum: { amountCents: true } });

  console.log("─".repeat(72));
  console.log(`Transactions:        ${grouped.length}`);
  console.log(`Unbalanced:          ${unbalanced.length}`);
  console.log(`Ledger total:        ${(total._sum.amountCents ?? 0) / 100} (must be 0)`);

  const transactions = await db.ledgerTransaction.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      kind: true,
      description: true,
      createdAt: true,
      entries: { select: { amountCents: true, account: { select: { ownerType: true, kind: true } } } },
    },
  });

  if (transactions.length) {
    console.log("\nRECENT TRANSACTIONS");
    console.log("─".repeat(72));
    for (const tx of transactions) {
      console.log(`${tx.kind} — ${tx.description}`);
      for (const entry of tx.entries) {
        const sign = entry.amountCents >= 0 ? "+" : "";
        console.log(
          `    ${entry.account.ownerType}/${entry.account.kind}`.padEnd(30) +
            `${sign}${(entry.amountCents / 100).toFixed(2)}`,
        );
      }
    }
  }

  const ok = unbalanced.length === 0 && (total._sum.amountCents ?? 0) === 0;
  console.log(`\n${ok ? "BOOKS BALANCE" : "BOOKS DO NOT BALANCE"}`);

  await db.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
