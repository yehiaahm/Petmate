import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  CircleDollarSign,
  LifeBuoy,
  Radar,
  Scale,
  ShieldAlert,
  Tag,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { requireStaff, permissionsFor } from "@/lib/auth/rbac";
import { assertLedgerBalanced } from "@/lib/payments/ledger-core";
import { productionReadiness, isProduction } from "@/lib/env";
import { isSandboxPayments } from "@/lib/payments/provider";
import {
  PERIODS,
  getComposition,
  getOverview,
  getQueueCounts,
  getRecentActivity,
  getSystemHealth,
  getTopSellers,
  parsePeriod,
} from "@/lib/admin/overview.service";
import { humanize } from "@/lib/admin/registry";
import { Alert, Avatar, Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { TrendChart } from "@/components/admin/charts/trend-chart";
import { BarList, SegmentBar } from "@/components/admin/charts/static-charts";
import { KpiTile } from "@/components/admin/kpi";
import { formatMoney } from "@/lib/money";
import { cn, compactNumber, formatDateTime, relativeTime } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

/** Last n buckets of a series, for the sparklines in the stat tiles. */
function tail(values: number[], n = 14) {
  return values.slice(-n);
}

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const auth = await requireStaff();
  const permissions = permissionsFor(auth.user.roles);
  const period = parsePeriod((await searchParams).period);

  const overview = await getOverview(period);
  const range = { from: new Date(overview.from), to: new Date(overview.to) };

  const [queue, composition, health, activity, topSellers, ledger] = await Promise.all([
    getQueueCounts(),
    getComposition(),
    permissions.has("admin:settings") ? getSystemHealth() : null,
    permissions.has("admin:users") ? getRecentActivity(10) : [],
    permissions.has("admin:finance") ? getTopSellers(range) : [],
    permissions.has("admin:finance") ? assertLedgerBalanced() : null,
  ]);

  const { metrics, deltas, series } = overview;
  const currency = metrics.currency;
  const weekly = PERIODS[period].days > 120;
  const problems = productionReadiness();
  const money = (c: number) => formatMoney(c, currency);

  const queueItems = [
    { label: "Reports", count: queue.reports, href: "/admin/moderation?tab=reports", icon: ShieldAlert, show: permissions.has("admin:moderation") },
    { label: "Listings to review", count: queue.listings, href: "/admin/moderation?tab=listings", icon: Tag, show: permissions.has("admin:moderation") },
    { label: "Verifications", count: queue.verifications, href: "/admin/moderation?tab=verifications", icon: BadgeCheck, show: permissions.has("admin:moderation") },
    { label: "Open disputes", count: queue.disputes, href: "/admin/moderation?tab=disputes", icon: Scale, show: permissions.has("admin:moderation") },
    { label: "Risk signals", count: queue.risks, href: "/admin/moderation?tab=risk", icon: Radar, show: permissions.has("admin:moderation") },
    { label: "Support tickets", count: queue.tickets, href: "/admin/support", icon: LifeBuoy, show: permissions.has("admin:moderation") },
    { label: "Payouts waiting", count: queue.payouts, href: "/admin/finance", icon: Wallet, show: permissions.has("admin:finance") },
  ].filter((q) => q.show);
  const waiting = queueItems.reduce((a, q) => a + q.count, 0);

  return (
    <>
      <PageHeader
        eyebrow={`${overview.label} · updated ${formatDateTime(overview.to)}`}
        title={`Welcome back, ${auth.user.name.split(" ")[0]}`}
        description="Live figures computed from the database on every load, compared with the period before."
        action={
          <nav aria-label="Period" className="inline-flex rounded-full border border-[var(--border)] bg-bg-sunken p-1">
            {(Object.keys(PERIODS) as (keyof typeof PERIODS)[]).map((p) => (
              <Link
                key={p}
                href={p === "30d" ? "/admin" : `/admin?period=${p}`}
                aria-current={p === period ? "page" : undefined}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors",
                  p === period ? "bg-bg-elevated text-fg shadow-[var(--shadow-subtle)]" : "text-fg-muted hover:text-fg",
                )}
              >
                {p.toUpperCase()}
              </Link>
            ))}
          </nav>
        }
      />

      {problems.length > 0 && (
        <Alert
          tone={isProduction() ? "danger" : "warning"}
          className="mt-6"
          title={isProduction() ? "Production safety checks are failing" : "This configuration would not be safe in production"}
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
            Charges settle through the internal ledger rather than a card network. Escrow, commission, refunds and
            payouts are the real implementation on real rows — only the gateway is simulated.
          </p>
        </Alert>
      )}

      {/* ---- Headline numbers ------------------------------------------------ */}
      <section className="mt-6" aria-labelledby="kpis">
        <h2 id="kpis" className="sr-only">Key figures</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiTile
            label="Platform revenue"
            value={money(metrics.revenueCents)}
            delta={deltas.revenue}
            hint="Commission, subscriptions, placement"
            icon={<CircleDollarSign />}
            href={permissions.has("admin:finance") ? "/admin/finance" : undefined}
          />
          <KpiTile
            label="Gross volume"
            value={money(metrics.gmvCents)}
            delta={deltas.gmv}
            hint={`${metrics.transactions.count.toLocaleString("en-US")} transactions · avg ${money(metrics.transactions.averageValueCents)}`}
            trend={tail(series.map((d) => d.gmvCents))}
            icon={<TrendingUp />}
          />
          <KpiTile
            label="New members"
            value={metrics.users.new.toLocaleString("en-US")}
            delta={deltas.newUsers}
            hint={`${compactNumber(metrics.users.total)} total · ${compactNumber(metrics.users.active)} active`}
            trend={tail(series.map((d) => d.users))}
            icon={<Users />}
            href={permissions.has("admin:users") ? "/admin/data/users" : undefined}
          />
          <KpiTile
            label="New listings"
            value={metrics.listings.new.toLocaleString("en-US")}
            delta={deltas.newListings}
            hint={`${compactNumber(metrics.listings.active)} live · ${metrics.listings.completed} completed`}
            trend={tail(series.map((d) => d.listings))}
            icon={<Tag />}
            href={permissions.has("admin:moderation") ? "/admin/data/listings" : undefined}
          />
        </div>
      </section>

      {/* ---- Queues ------------------------------------------------------------ */}
      {queueItems.length > 0 && (
        <section className="mt-6" aria-labelledby="queues">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 id="queues" className="font-display text-lg font-bold text-fg">
              Needs attention
            </h2>
            <p className="text-sm text-fg-muted">
              {waiting === 0 ? "Every queue is clear." : `${waiting.toLocaleString("en-US")} item${waiting === 1 ? "" : "s"} waiting on staff`}
            </p>
          </div>
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
            {queueItems.map((item) => (
              <li key={item.label}>
                <Link
                  href={item.href}
                  className={cn(
                    "surface surface-lift flex h-full flex-col justify-between gap-3 p-4 shadow-[var(--shadow-subtle)]",
                    item.count > 0 && "border-[color-mix(in_srgb,var(--accent)_35%,var(--border))]",
                  )}
                >
                  <span className="flex items-center gap-2 text-sm text-fg-muted">
                    <item.icon className={cn("size-4 shrink-0", item.count > 0 ? "text-accent" : "text-fg-subtle")} aria-hidden />
                    <span className="leading-snug">{item.label}</span>
                  </span>
                  <span className={cn("font-display text-2xl font-bold tabular", item.count > 0 ? "text-fg" : "text-fg-subtle")}>
                    {item.count.toLocaleString("en-US")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---- Trends ------------------------------------------------------------ */}
      <div className="mt-6 grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHeader
              title="Gross volume"
              description={`Completed pet sales and paid store orders, ${weekly ? "by week" : "by day"}.`}
              action={<span className="font-display text-xl font-bold text-fg tabular">{money(metrics.gmvCents)}</span>}
            />
            <div className="p-5">
              <TrendChart
                dates={series.map((d) => d.date)}
                series={[{ key: "gmv", label: "Gross volume", slot: 1, values: series.map((d) => d.gmvCents) }]}
                unit="money"
                currency={currency}
                weekly={weekly}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Growth" description="New members, new listings and store orders. All counts, one axis." />
            <div className="p-5">
              <TrendChart
                dates={series.map((d) => d.date)}
                series={[
                  { key: "users", label: "New members", slot: 1, values: series.map((d) => d.users) },
                  { key: "listings", label: "New listings", slot: 2, values: series.map((d) => d.listings) },
                  { key: "orders", label: "Store orders", slot: 3, values: series.map((d) => d.orders) },
                ]}
                unit="count"
                height={220}
                weekly={weekly}
              />
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Revenue by stream" description={overview.label} />
            <div className="p-5">
              <BarList
                rows={metrics.revenueByStream.map((r) => ({
                  label: r.stream,
                  value: r.cents,
                  hint: metrics.revenueCents ? `${Math.round((r.cents / metrics.revenueCents) * 100)}%` : undefined,
                }))}
                format={money}
                empty="No revenue in this period yet."
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Marketplace funnel" description="Listing view → enquiry → purchase." />
            <div className="p-5">
              <BarList
                rows={[
                  { label: "Listing views", value: metrics.conversion.views },
                  { label: "Enquiries", value: metrics.conversion.inquiries },
                  { label: "Purchases", value: metrics.conversion.purchases },
                ]}
                format={(v) => v.toLocaleString("en-US")}
              />
              <p className="mt-4 rounded-[12px] bg-bg-sunken px-3 py-2 text-center text-sm text-fg-muted tabular">
                <span className="font-semibold text-fg">{metrics.conversion.rate.toFixed(2)}%</span> view-to-purchase
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Services" description={overview.label} />
            <dl className="grid grid-cols-2 divide-x divide-[var(--border)] p-5">
              <div className="pr-4">
                <dt className="text-xs text-fg-muted">Vet bookings</dt>
                <dd className="mt-1 font-display text-xl font-bold text-fg tabular">{metrics.appointments.booked}</dd>
                <dd className="text-xs text-fg-subtle">{metrics.appointments.completed} completed</dd>
              </div>
              <div className="pl-4">
                <dt className="text-xs text-fg-muted">Store orders</dt>
                <dd className="mt-1 font-display text-xl font-bold text-fg tabular">{metrics.orders.count}</dd>
                <dd className="text-xs text-fg-subtle">{money(metrics.orders.gmvCents)}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>

      {/* ---- Platform shape ------------------------------------------------------ */}
      <div className="mt-6 grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader title="Platform at a glance" description="All time, excluding archived records." />
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-b-[var(--radius-card)] bg-[var(--border)]">
            {[
              { label: "Members", value: metrics.users.total, href: "/admin/data/users" },
              { label: "Pets", value: composition.pets, href: "/admin/data/pets" },
              { label: "Listings", value: composition.listings, href: "/admin/data/listings" },
              { label: "Active shops", value: composition.shops, href: "/admin/data/shops" },
              { label: "Active products", value: composition.products, href: "/admin/data/products" },
              { label: "Active clinics", value: composition.clinics, href: "/admin/data/clinics" },
              { label: "Care providers", value: composition.careProviders, href: "/admin/data/care-providers" },
              { label: "Paid subscriptions", value: composition.subscriptions, href: "/admin/data/subscriptions" },
            ].map((item) => (
              <Link key={item.label} href={item.href} className="bg-bg-elevated px-5 py-3.5 transition-colors hover:bg-bg-sunken">
                <dt className="text-xs text-fg-muted">{item.label}</dt>
                <dd className="mt-0.5 font-display text-lg font-bold text-fg tabular">{item.value.toLocaleString("en-US")}</dd>
              </Link>
            ))}
          </dl>
        </Card>

        <Card>
          <CardHeader title="Listings by status" />
          <div className="p-5">
            <SegmentBar label="Listings by status" rows={composition.listingStatus.map((r) => ({ label: humanize(r.status), value: r.count }))} />
          </div>
          <div className="border-t border-[var(--border)] p-5">
            <p className="mb-3 text-sm font-semibold text-fg">Members by status</p>
            <SegmentBar label="Members by status" rows={composition.userStatus.map((r) => ({ label: humanize(r.status), value: r.count }))} />
          </div>
        </Card>

        {topSellers.length > 0 ? (
          <Card>
            <CardHeader title="Top sellers" description={`Completed pet sales, ${overview.label.toLowerCase()}.`} />
            <ul className="divide-y divide-[var(--border)]">
              {topSellers.map((s, i) => (
                <li key={s.sellerId}>
                  <Link href={`/admin/data/users/${s.sellerId}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-bg-sunken">
                    <span className="w-4 text-xs font-semibold text-fg-subtle tabular">{i + 1}</span>
                    <Avatar src={s.user?.avatarUrl} name={s.user?.name ?? "?"} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">{s.user?.name ?? "Deleted member"}</span>
                      <span className="block text-xs text-fg-muted">
                        {s.sales} sale{s.sales === 1 ? "" : "s"} · trust {s.user?.trustScore ?? 0}
                      </span>
                    </span>
                    <span className="text-sm font-semibold text-fg tabular">{money(s.gmvCents)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          health && <SystemCard health={health} />
        )}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        {activity.length > 0 && (
          <Card className="xl:col-span-2">
            <CardHeader
              title="Recent activity"
              description="The latest entries in the audit log."
              action={
                <Link href="/admin/data/audit-logs" className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
                  Full log <ArrowRight className="size-4" aria-hidden />
                </Link>
              }
            />
            <ol className="divide-y divide-[var(--border)]">
              {activity.map((entry) => (
                <li key={entry.id} className="flex items-start gap-3 px-5 py-3">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-bg-sunken text-fg-muted">
                    <Activity className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-fg">
                      <span className="font-semibold">{entry.actor?.name ?? "System"}</span>{" "}
                      <span className="text-fg-muted">· {entry.action}</span>
                    </p>
                    {entry.summary && <p className="mt-0.5 truncate text-xs text-fg-muted">{entry.summary}</p>}
                  </div>
                  <Link href={`/admin/data/audit-logs/${entry.id}`} className="shrink-0 text-xs text-fg-subtle hover:text-fg" title={formatDateTime(entry.createdAt)}>
                    {relativeTime(entry.createdAt)}
                  </Link>
                </li>
              ))}
            </ol>
          </Card>
        )}

        <div className="space-y-5">
          {topSellers.length > 0 && health && <SystemCard health={health} />}

          {ledger && (
            <Card>
              <CardHeader
                title="Ledger integrity"
                description="Every transaction must sum to zero, and so must the book."
                action={
                  ledger.ok ? (
                    <Badge tone="success" icon={<CheckCircle2 className="size-3.5" aria-hidden />}>
                      Balanced
                    </Badge>
                  ) : (
                    <Badge tone="danger" icon={<AlertTriangle className="size-3.5" aria-hidden />}>
                      Unbalanced
                    </Badge>
                  )
                }
              />
              <div className="p-5">
                {ledger.ok ? (
                  <p className="text-sm text-fg-muted tabular">
                    Book total {ledger.totalCents}. A balanced double-entry ledger sums to exactly zero, so any other number
                    here is a bug, not a rounding artefact.
                  </p>
                ) : (
                  <div>
                    <p className="text-sm font-medium text-[var(--danger)]">
                      {ledger.unbalanced.length} unbalanced transaction{ledger.unbalanced.length === 1 ? "" : "s"}. Stop
                      taking payments and investigate.
                    </p>
                    <ul className="mt-3 space-y-1 font-mono text-xs text-fg-muted">
                      {ledger.unbalanced.slice(0, 10).map((row) => (
                        <li key={row.transactionId}>
                          <Link href={`/admin/data/ledger/${row.transactionId}`} className="hover:underline">
                            {row.transactionId}
                          </Link>{" "}
                          · sum {row.sum}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Your access" />
            <div className="flex flex-wrap gap-1.5 p-5">
              {[...permissions]
                .filter((p) => p.startsWith("admin:"))
                .map((p) => (
                  <Badge key={p} tone={p === "admin:destructive" ? "danger" : "brand"} size="sm">
                    {p.replace("admin:", "")}
                  </Badge>
                ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function SystemCard({ health }: { health: NonNullable<Awaited<ReturnType<typeof getSystemHealth>>> }) {
  const failedJobs = (health.jobs.FAILED ?? 0) + (health.jobs.DEAD ?? 0);
  const failedEmails = health.emails.FAILED ?? 0;
  const ok = failedJobs === 0 && failedEmails === 0;
  return (
    <Card>
      <CardHeader
        title="System health"
        action={
          <Badge tone={ok ? "success" : "warning"} icon={ok ? <CheckCircle2 className="size-3.5" aria-hidden /> : <AlertTriangle className="size-3.5" aria-hidden />}>
            {ok ? "Healthy" : "Needs a look"}
          </Badge>
        }
      />
      <dl className="divide-y divide-[var(--border)] text-sm">
        {[
          { label: "Jobs waiting", value: health.jobs.PENDING ?? 0, href: "/admin/data/jobs?f.status=PENDING" },
          { label: "Jobs failed or dead", value: failedJobs, href: "/admin/data/jobs?f.status=FAILED", bad: failedJobs > 0 },
          { label: "Emails queued", value: health.emails.QUEUED ?? 0, href: "/admin/data/emails?f.status=QUEUED" },
          { label: "Emails failed", value: failedEmails, href: "/admin/data/emails?f.status=FAILED", bad: failedEmails > 0 },
          { label: "Live sessions", value: health.liveSessions, href: "/admin/data/sessions" },
          { label: "Failed sign-ins (24h)", value: health.failedLogins24h },
        ].map((row) => {
          const content = (
            <>
              <dt className="text-fg-muted">{row.label}</dt>
              <dd className={cn("font-semibold tabular", row.bad ? "text-[var(--danger)]" : "text-fg")}>{row.value.toLocaleString("en-US")}</dd>
            </>
          );
          return row.href ? (
            <Link key={row.label} href={row.href} className="flex items-center justify-between px-5 py-2.5 transition-colors hover:bg-bg-sunken">
              {content}
            </Link>
          ) : (
            <div key={row.label} className="flex items-center justify-between px-5 py-2.5">
              {content}
            </div>
          );
        })}
      </dl>
    </Card>
  );
}
