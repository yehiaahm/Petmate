import type { Metadata } from "next";
import Link from "next/link";
import {
  Users,
  Tag,
  Receipt,
  CalendarCheck,
  ShieldAlert,
  Scale,
  BadgeCheck,
  LifeBuoy,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { requireStaff, permissionsFor } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getPlatformMetrics, getDailySeries } from "@/lib/services/analytics.service";
import { assertLedgerBalanced } from "@/lib/payments/ledger-core";
import { productionReadiness, isProduction } from "@/lib/env";
import { isSandboxPayments } from "@/lib/payments/provider";
import { PageHeader, Card, CardHeader, Stat, Alert, Badge } from "@/components/ui/primitives";
import { TrendChart } from "@/components/admin/trend-chart";
import { formatMoney } from "@/lib/money";
import { compactNumber } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Admin overview",
  robots: { index: false, follow: false },
};

export default async function AdminOverviewPage() {
  const auth = await requireStaff();
  const permissions = permissionsFor(auth.user.roles);

  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);

  const [metrics, series, queue, ledger] = await Promise.all([
    getPlatformMetrics({ from, to }),
    getDailySeries({ from, to }),
    Promise.all([
      db.report.count({ where: { status: { in: ["OPEN", "IN_REVIEW"] } } }),
      db.listing.count({ where: { status: "PENDING_REVIEW", deletedAt: null } }),
      db.verification.count({ where: { status: { in: ["PENDING", "IN_REVIEW"] } } }),
      db.dispute.count({ where: { status: { in: ["OPEN", "AWAITING_RESPONSE", "IN_REVIEW"] } } }),
      db.supportTicket.count({ where: { status: { in: ["OPEN", "AWAITING_USER"] } } }),
      db.payout.count({ where: { status: { in: ["REQUESTED", "APPROVED"] } } }),
    ]),
    permissions.has("admin:finance") ? assertLedgerBalanced() : null,
  ]);

  const [reports, pendingListings, verifications, disputes, tickets, payouts] = queue;
  const problems = productionReadiness();

  const queueItems = [
    { label: "Reports", count: reports, href: "/admin/moderation?tab=reports", icon: ShieldAlert },
    { label: "Listings to review", count: pendingListings, href: "/admin/moderation?tab=listings", icon: Tag },
    { label: "Verifications", count: verifications, href: "/admin/moderation?tab=verifications", icon: BadgeCheck },
    { label: "Open disputes", count: disputes, href: "/admin/moderation?tab=disputes", icon: Scale },
    { label: "Support tickets", count: tickets, href: "/admin/support", icon: LifeBuoy },
    { label: "Payouts waiting", count: payouts, href: "/admin/finance", icon: Receipt },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Last 30 days"
        title="Overview"
        description="Everything here is computed from the database at request time. No figure on this page is stored or cached."
      />

      {problems.length > 0 && (
        <Alert
          tone={isProduction() ? "danger" : "warning"}
          className="mt-6"
          title={
            isProduction()
              ? "Production safety checks are failing"
              : "This configuration would not be safe in production"
          }
          icon={<AlertTriangle className="size-4" aria-hidden />}
        >
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Alert>
      )}

      {isSandboxPayments() && (
        <Alert tone="info" className="mt-3" title="Sandbox payment provider">
          <p className="mt-1">
            Charges are settled through the internal ledger rather than a card network. Escrow,
            commission, refunds and payouts below are the real implementation operating on real
            rows — only the gateway is simulated.
          </p>
        </Alert>
      )}

      <section className="mt-6">
        <h2 className="sr-only">Queues</h2>
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {queueItems.map((item) => (
            <li key={item.label}>
              <Link href={item.href} className="block">
                <Card
                  interactive
                  className="flex items-center justify-between gap-3 p-4"
                >
                  <span className="flex items-center gap-2.5 text-sm text-fg-muted">
                    <item.icon
                      className={item.count > 0 ? "size-4 text-accent" : "size-4 text-fg-subtle"}
                      aria-hidden
                    />
                    {item.label}
                  </span>
                  <span
                    className={
                      item.count > 0
                        ? "font-display text-xl font-semibold tabular text-accent"
                        : "font-display text-xl font-semibold tabular text-fg-subtle"
                    }
                  >
                    {item.count}
                  </span>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="font-display text-xl font-semibold text-fg">Platform</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Members"
            value={compactNumber(metrics.users.total)}
            hint={`${metrics.users.new} new · ${metrics.users.active} active`}
            icon={<Users className="size-4" aria-hidden />}
          />
          <Stat
            label="Active listings"
            value={compactNumber(metrics.listings.active)}
            hint={`${metrics.listings.completed} completed`}
            icon={<Tag className="size-4" aria-hidden />}
          />
          <Stat
            label="GMV"
            value={formatMoney(metrics.gmvCents, metrics.currency)}
            hint={`${metrics.transactions.count} transactions`}
            icon={<Receipt className="size-4" aria-hidden />}
          />
          <Stat
            label="Platform revenue"
            value={formatMoney(metrics.revenueCents, metrics.currency)}
            hint="Commission, subscriptions, placement"
            icon={<Receipt className="size-4" aria-hidden />}
          />
        </div>
      </section>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Daily activity"
            description="New members, published listings and completed value."
          />
          <div className="p-5">
            <TrendChart series={series} currency={metrics.currency} />
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Revenue by stream" />
            <div className="p-5">
              {metrics.revenueByStream.length === 0 ? (
                <p className="text-sm text-fg-muted">No revenue in this period.</p>
              ) : (
                <ul className="space-y-2.5">
                  {metrics.revenueByStream.map((row) => {
                    const share =
                      metrics.revenueCents > 0 ? (row.cents / metrics.revenueCents) * 100 : 0;
                    return (
                      <li key={row.stream}>
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="capitalize text-fg-muted">
                            {row.stream.replaceAll("_", " ").toLowerCase()}
                          </span>
                          <span className="font-medium tabular text-fg">
                            {formatMoney(row.cents, metrics.currency)}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg-sunken">
                          <div
                            className="h-full rounded-full bg-brand"
                            style={{ width: `${share}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Funnel" description="Listing view → enquiry → purchase." />
            <div className="p-5">
              <dl className="grid grid-cols-3 gap-3 text-center">
                {[
                  { label: "Views", value: metrics.conversion.views },
                  { label: "Enquiries", value: metrics.conversion.inquiries },
                  { label: "Purchases", value: metrics.conversion.purchases },
                ].map((step) => (
                  <div key={step.label}>
                    <dd className="font-display text-xl font-semibold tabular text-fg">
                      {compactNumber(step.value)}
                    </dd>
                    <dt className="mt-0.5 text-xs text-fg-muted">{step.label}</dt>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-center text-sm text-fg-muted tabular">
                {(metrics.conversion.rate * 100).toFixed(2)}% view-to-purchase
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Appointments" />
            <div className="flex gap-6 p-5">
              <div>
                <p className="font-display text-xl font-semibold tabular text-fg">
                  {metrics.appointments.booked}
                </p>
                <p className="text-xs text-fg-muted">Booked</p>
              </div>
              <div>
                <p className="font-display text-xl font-semibold tabular text-fg">
                  {metrics.appointments.completed}
                </p>
                <p className="text-xs text-fg-muted">Completed</p>
              </div>
              <CalendarCheck className="ml-auto size-5 self-center text-fg-subtle" aria-hidden />
            </div>
          </Card>
        </div>
      </div>

      {ledger && (
        <Card className="mt-6">
          <CardHeader
            title="Ledger integrity"
            description="Every transaction must sum to zero, and so must the whole book."
            action={
              ledger.ok ? (
                <Badge tone="success">
                  <CheckCircle2 className="mr-1 size-3.5" aria-hidden />
                  Balanced
                </Badge>
              ) : (
                <Badge tone="danger">
                  <AlertTriangle className="mr-1 size-3.5" aria-hidden />
                  Unbalanced
                </Badge>
              )
            }
          />
          <div className="p-5">
            {ledger.ok ? (
              <p className="text-sm text-fg-muted tabular">
                Book total {ledger.totalCents}. A balanced double-entry ledger sums to exactly
                zero, so any other number here is a bug, not a rounding artefact.
              </p>
            ) : (
              <div>
                <p className="text-sm font-medium text-[var(--danger)]">
                  {ledger.unbalanced.length} unbalanced transaction
                  {ledger.unbalanced.length === 1 ? "" : "s"}. Stop taking payments and
                  investigate.
                </p>
                <ul className="mt-3 space-y-1 font-mono text-xs text-fg-muted">
                  {ledger.unbalanced.slice(0, 10).map((row) => (
                    <li key={row.transactionId}>
                      {row.transactionId} · sum {row.sum}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>
      )}
    </>
  );
}
