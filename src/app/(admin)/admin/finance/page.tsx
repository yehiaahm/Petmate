import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, Receipt } from "lucide-react";
import { requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { listPendingPayouts } from "@/lib/payments/payout.service";
import { assertLedgerBalanced, getBalance } from "@/lib/payments/ledger-core";
import { PayoutQueue } from "@/components/admin/payout-queue";
import { PageHeader, Card, CardHeader, Stat, Badge, Alert } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { PLATFORM_CURRENCY } from "@/lib/currency";

export const metadata: Metadata = {
  title: "Finance",
  robots: { index: false, follow: false },
};

export default async function FinancePage() {
  await requirePermission("admin:finance");

  const [payouts, ledger, escrowHeld, revenue, recentRefunds] = await Promise.all([
    listPendingPayouts(),
    assertLedgerBalanced(),
    getBalance({ ownerType: "ESCROW", ownerId: "escrow", kind: "ESCROW", currency: PLATFORM_CURRENCY }),
    getBalance({ ownerType: "PLATFORM", ownerId: "platform", kind: "REVENUE", currency: PLATFORM_CURRENCY }),
    db.refund.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        amountCents: true,
        currency: true,
        reason: true,
        status: true,
        createdAt: true,
      },
    }),
  ]);

  // Resolve the owner of each pending payout so the queue shows a name rather
  // than an opaque id.
  const userIds = payouts.filter((p) => p.ownerType === "USER").map((p) => p.ownerId);
  const shopIds = payouts.filter((p) => p.ownerType === "SHOP").map((p) => p.ownerId);
  const clinicIds = payouts.filter((p) => p.ownerType === "CLINIC").map((p) => p.ownerId);

  const [users, shops, clinics] = await Promise.all([
    userIds.length
      ? db.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, handle: true },
        })
      : [],
    shopIds.length
      ? db.shop.findMany({ where: { id: { in: shopIds } }, select: { id: true, name: true } })
      : [],
    clinicIds.length
      ? db.clinic.findMany({ where: { id: { in: clinicIds } }, select: { id: true, name: true } })
      : [],
  ]);

  const names = new Map<string, string>();
  for (const u of users) names.set(u.id, u.name);
  for (const s of shops) names.set(s.id, s.name);
  for (const c of clinics) names.set(c.id, c.name);

  const pendingTotal = payouts.reduce((sum, p) => sum + p.amountCents, 0);

  return (
    <>
      <PageHeader
        title="Finance"
        description="Balances are derived from the ledger on every request. Nothing on this page is a stored total that could drift."
      />

      {!ledger.ok && (
        <Alert
          tone="danger"
          className="mt-6"
          title="The ledger does not balance"
          icon={<AlertTriangle className="size-4" aria-hidden />}
        >
          <p className="mt-1">
            {ledger.unbalanced.length} transaction
            {ledger.unbalanced.length === 1 ? "" : "s"} do not sum to zero. Stop approving payouts
            and investigate before any more money moves.
          </p>
          <ul className="mt-2 space-y-0.5 font-mono text-xs">
            {ledger.unbalanced.slice(0, 10).map((row) => (
              <li key={row.transactionId}>
                {row.transactionId} · {row.sum}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Held in escrow" value={formatMoney(escrowHeld, PLATFORM_CURRENCY)} hint="Not ours" />
        <Stat
          label="Platform revenue"
          value={formatMoney(Math.abs(revenue), PLATFORM_CURRENCY)}
          hint="Commission and fees, all time"
        />
        <Stat
          label="Payouts waiting"
          value={formatMoney(pendingTotal, PLATFORM_CURRENCY)}
          hint={`${payouts.length} request${payouts.length === 1 ? "" : "s"}`}
          icon={<Receipt className="size-4" aria-hidden />}
        />
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Ledger integrity"
          action={
            ledger.ok ? (
              <Badge tone="success">
                <CheckCircle2 className="me-1 size-3.5" aria-hidden />
                Balanced
              </Badge>
            ) : (
              <Badge tone="danger">Unbalanced</Badge>
            )
          }
        />
        <div className="p-5">
          <p className="text-sm text-fg-muted">
            Book total <span className="tabular font-medium text-fg">{ledger.totalCents}</span>.
            Every transaction must sum to zero, and so must every account added together — so any
            value other than zero means a posting is wrong, not that rounding accumulated.
          </p>
        </div>
      </Card>

      <section className="mt-6">
        <h2 className="font-display text-xl font-semibold text-fg">Payout requests</h2>
        <p className="mt-1 text-sm text-fg-muted">
          The money has already left the requester&rsquo;s available balance and is sitting in
          their payable account. Marking one paid moves it out of the system; rejecting returns it.
        </p>
        <div className="mt-4">
          <PayoutQueue
            payouts={payouts.map((p) => ({
              id: p.id,
              ownerType: p.ownerType,
              ownerName: names.get(p.ownerId) ?? p.ownerId,
              amountCents: p.amountCents,
              currency: p.currency,
              status: p.status,
              destination: p.destination,
              requestedAt: p.requestedAt.toISOString(),
            }))}
          />
        </div>
      </section>

      <Card className="mt-6">
        <CardHeader title="Recent refunds" />
        <div className="p-5">
          {recentRefunds.length === 0 ? (
            <p className="text-sm text-fg-muted">No refunds issued.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {recentRefunds.map((refund) => (
                <li key={refund.id} className="flex items-baseline justify-between gap-3 py-2.5">
                  <span className="text-sm text-fg-muted">
                    {refund.reason.replaceAll("_", " ").toLowerCase()} ·{" "}
                    <span className="text-xs">{refund.status.toLowerCase()}</span>
                  </span>
                  <span className="shrink-0 text-end">
                    <span className="block text-sm font-semibold tabular text-fg">
                      {formatMoney(refund.amountCents, refund.currency)}
                    </span>
                    <span className="block text-xs text-fg-subtle">
                      {formatDate(refund.createdAt)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </>
  );
}
