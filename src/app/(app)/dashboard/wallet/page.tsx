import type { Metadata } from "next";
import Link from "next/link";
import { Wallet, ArrowDownLeft, ArrowUpRight, Clock, Landmark } from "lucide-react";
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getEarnings, listLedgerEntries } from "@/lib/payments/ledger-core";
import { listPayouts } from "@/lib/payments/payout.service";
import { getSettings } from "@/lib/settings";
import { isSandboxPayments } from "@/lib/payments/provider";
import { PayoutRequest } from "@/components/wallet/payout-request";
import { PageHeader, Card, CardHeader, Stat, Badge, Alert, EmptyState } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime, cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Wallet",
  robots: { index: false, follow: false },
};

const PAYOUT_TONE: Record<string, "info" | "warning" | "success" | "danger" | "neutral"> = {
  REQUESTED: "warning",
  APPROVED: "info",
  PAID: "success",
  REJECTED: "danger",
  FAILED: "danger",
};

export default async function WalletPage() {
  const auth = await requireAuth();
  const currency = auth.user.currency;

  const [earnings, entries, payouts, settings, shops, clinics] = await Promise.all([
    getEarnings("USER", auth.user.id, currency),
    listLedgerEntries("USER", auth.user.id, { currency, limit: 50 }),
    listPayouts("USER", auth.user.id),
    getSettings(),
    db.shop.findMany({
      where: { ownerUserId: auth.user.id, deletedAt: null },
      select: { id: true, name: true },
    }),
    db.clinic.findMany({
      where: { ownerUserId: auth.user.id, deletedAt: null },
      select: { id: true, name: true },
    }),
  ]);

  const canRequest = earnings.availableCents >= settings.minPayoutCents;

  return (
    <div className="container-page max-w-4xl py-8 lg:py-10">
      <PageHeader
        title="Wallet"
        description="Money PetMate holds for you. Every figure here is derived from the ledger, not stored on your account — so it always adds up."
      />

      {isSandboxPayments() && (
        <Alert tone="warning" className="mt-6" title="Sandbox payments are active">
          <p className="mt-1 leading-relaxed">
            No real money is involved. The ledger, escrow, commission and payout logic below is
            the real implementation; only the card gateway is simulated.
          </p>
        </Alert>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Available"
          value={formatMoney(earnings.availableCents, earnings.currency)}
          hint="Yours to withdraw"
          icon={<Wallet className="size-4" aria-hidden />}
        />
        <Stat
          label="Pending"
          value={formatMoney(earnings.pendingCents, earnings.currency)}
          hint={`Held for ${settings.payoutHoldDays} days or until a dispute window closes`}
          icon={<Clock className="size-4" aria-hidden />}
        />
        <Stat
          label="Lifetime earned"
          value={formatMoney(earnings.lifetimeCents, earnings.currency)}
          icon={<ArrowDownLeft className="size-4" aria-hidden />}
        />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_320px] lg:items-start">
        <Card>
          <CardHeader
            title="Activity"
            description="Every posting against your accounts, newest first."
          />
          <div className="p-5">
            {entries.length === 0 ? (
              <EmptyState
                className="border-0 py-8"
                icon={<Wallet className="size-5" aria-hidden />}
                title="Nothing yet"
                description="Sales, bookings and refunds all show up here the moment they settle."
              />
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {entries.map((entry) => {
                  const credit = entry.amountCents > 0;
                  return (
                    <li key={entry.id} className="flex items-start gap-3 py-3">
                      <span
                        className={cn(
                          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
                          credit
                            ? "bg-[var(--success-soft)] text-[var(--success)]"
                            : "bg-bg-sunken text-fg-subtle",
                        )}
                      >
                        {credit ? (
                          <ArrowDownLeft className="size-4" aria-hidden />
                        ) : (
                          <ArrowUpRight className="rtl:-scale-x-100 size-4" aria-hidden />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-fg">{entry.transaction.description}</p>
                        <p className="mt-0.5 text-xs text-fg-subtle">
                          {formatDateTime(entry.createdAt)} ·{" "}
                          {entry.accountKind === "PENDING"
                            ? "pending"
                            : entry.accountKind === "PAYABLE"
                              ? "withdrawal"
                              : "available"}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 text-sm font-semibold tabular",
                          credit ? "text-[var(--success)]" : "text-fg",
                        )}
                      >
                        {credit ? "+" : "−"}
                        {formatMoney(Math.abs(entry.amountCents), entry.currency)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>

        <aside className="space-y-5">
          <Card>
            <CardHeader title="Withdraw" />
            <div className="p-5">
              {canRequest ? (
                <PayoutRequest
                  availableCents={earnings.availableCents}
                  currency={earnings.currency}
                  minCents={settings.minPayoutCents}
                  accounts={[
                    { ownerType: "USER", ownerId: auth.user.id, label: "Personal balance" },
                    ...shops.map((s) => ({
                      ownerType: "SHOP" as const,
                      ownerId: s.id,
                      label: s.name,
                    })),
                    ...clinics.map((c) => ({
                      ownerType: "CLINIC" as const,
                      ownerId: c.id,
                      label: c.name,
                    })),
                  ]}
                />
              ) : (
                <p className="text-sm leading-relaxed text-fg-muted">
                  The smallest payout is{" "}
                  {formatMoney(settings.minPayoutCents, earnings.currency)}. You have{" "}
                  {formatMoney(earnings.availableCents, earnings.currency)} available.
                </p>
              )}
              <p className="mt-4 text-xs leading-relaxed text-fg-subtle">
                Requesting a payout moves the money out of your available balance immediately, so
                the same funds cannot be requested twice. If a request is declined it goes straight
                back.
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Payout history" />
            <div className="p-5">
              {payouts.length === 0 ? (
                <p className="text-sm text-fg-muted">No payouts yet.</p>
              ) : (
                <ul className="divide-y divide-[var(--border)]">
                  {payouts.map((payout) => (
                    <li key={payout.id} className="py-2.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm font-semibold tabular text-fg">
                          {formatMoney(payout.amountCents, payout.currency)}
                        </span>
                        <Badge tone={PAYOUT_TONE[payout.status] ?? "neutral"} size="sm">
                          {payout.status.toLowerCase()}
                        </Badge>
                      </div>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-subtle">
                        <Landmark className="size-3" aria-hidden />
                        {payout.destination ?? "Bank transfer"} ·{" "}
                        {formatDate(payout.paidAt ?? payout.requestedAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          <p className="text-xs leading-relaxed text-fg-subtle">
            What you pay PetMate — subscriptions and invoices — is in{" "}
            <Link href="/settings/billing" className="font-medium text-brand hover:underline">
              billing
            </Link>
            , not here.
          </p>
        </aside>
      </div>
    </div>
  );
}
