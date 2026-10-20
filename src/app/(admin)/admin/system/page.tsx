import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, Cog, Mail, ToggleLeft, Users } from "lucide-react";
import { requirePermission } from "@/lib/auth/rbac";
import { getSystemHealth } from "@/lib/admin/overview.service";
import { assertLedgerBalanced } from "@/lib/payments/ledger-core";
import { productionReadiness, isProduction } from "@/lib/env";
import { isSandboxPayments } from "@/lib/payments/provider";
import { features } from "@/lib/features";
import { humanize } from "@/lib/admin/registry";
import { Alert, Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { cn, formatDateTime, relativeTime } from "@/lib/utils";

export const metadata: Metadata = {
  title: "System health",
  robots: { index: false, follow: false },
};

const JOB_ORDER = ["PENDING", "RUNNING", "COMPLETED", "FAILED", "DEAD"];
const EMAIL_ORDER = ["QUEUED", "SENT", "FAILED", "SUPPRESSED"];
const BAD = new Set(["FAILED", "DEAD"]);

export default async function SystemPage() {
  await requirePermission("admin:settings");
  const [health, ledger] = await Promise.all([getSystemHealth(), assertLedgerBalanced()]);
  const problems = productionReadiness();

  const failedJobs = (health.jobs.FAILED ?? 0) + (health.jobs.DEAD ?? 0);
  const failedEmails = health.emails.FAILED ?? 0;

  const checks = [
    { label: "Ledger balanced", ok: ledger.ok, detail: ledger.ok ? "Every transaction sums to zero." : `${ledger.unbalanced.length} unbalanced transactions`, href: "/admin/data/ledger" },
    { label: "Background jobs", ok: failedJobs === 0, detail: failedJobs ? `${failedJobs} failed or dead` : "No failures", href: "/admin/data/jobs?f.status=FAILED" },
    { label: "Email delivery", ok: failedEmails === 0, detail: failedEmails ? `${failedEmails} failed` : "No failures", href: "/admin/data/emails?f.status=FAILED" },
    { label: "Production configuration", ok: problems.length === 0, detail: problems.length ? `${problems.length} issue${problems.length === 1 ? "" : "s"}` : "All checks pass" },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="System health"
        description="The machinery behind the product: background jobs, the email outbox, sessions, configuration and the ledger."
      />

      <ul className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {checks.map((c) => {
          const body = (
            <>
              <span className="flex items-center gap-2 text-sm font-semibold text-fg">
                {c.ok ? (
                  <CheckCircle2 className="size-4 text-[var(--success)]" aria-hidden />
                ) : (
                  <AlertTriangle className="size-4 text-[var(--danger)]" aria-hidden />
                )}
                {c.label}
              </span>
              <span className={cn("mt-1 block text-sm", c.ok ? "text-fg-muted" : "font-medium text-[var(--danger)]")}>{c.detail}</span>
            </>
          );
          return (
            <li key={c.label}>
              {c.href ? (
                <Link href={c.href} className="surface surface-lift block h-full p-4 shadow-[var(--shadow-subtle)]">
                  {body}
                </Link>
              ) : (
                <div className="surface block h-full p-4 shadow-[var(--shadow-subtle)]">{body}</div>
              )}
            </li>
          );
        })}
      </ul>

      {problems.length > 0 && (
        <Alert
          tone={isProduction() ? "danger" : "warning"}
          className="mt-5"
          title={isProduction() ? "Production safety checks are failing" : "This configuration would not be safe in production"}
          icon={<AlertTriangle className="size-4" aria-hidden />}
        >
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Background jobs"
            description="Durable queue processed by the worker."
            action={<Cog className="size-5 text-fg-subtle" aria-hidden />}
          />
          <StatusGrid order={JOB_ORDER} counts={health.jobs} hrefBase="/admin/data/jobs" />
          <div className="border-t border-[var(--border)] px-5 py-3 text-sm text-fg-muted">
            {health.oldestPendingJob ? (
              <span className="flex items-center gap-2">
                <Clock className="size-4 text-fg-subtle" aria-hidden />
                Oldest due job: <span className="font-medium text-fg">{health.oldestPendingJob.type}</span>, due{" "}
                <span title={formatDateTime(health.oldestPendingJob.runAt)} suppressHydrationWarning>
                  {relativeTime(health.oldestPendingJob.runAt)}
                </span>
              </span>
            ) : (
              "Nothing is overdue — the worker is keeping up."
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Email outbox"
            description="Transactional email, delivered by the worker."
            action={<Mail className="size-5 text-fg-subtle" aria-hidden />}
          />
          <StatusGrid order={EMAIL_ORDER} counts={health.emails} hrefBase="/admin/data/emails" />
          <p className="border-t border-[var(--border)] px-5 py-3 text-sm text-fg-muted">
            To retry a failed email, open it and set its status back to Queued.
          </p>
        </Card>

        <Card>
          <CardHeader title="Access" action={<Users className="size-5 text-fg-subtle" aria-hidden />} />
          <dl className="divide-y divide-[var(--border)] text-sm">
            <Link href="/admin/data/sessions" className="flex items-center justify-between px-5 py-3 hover:bg-bg-sunken">
              <dt className="text-fg-muted">Live sessions</dt>
              <dd className="font-semibold text-fg tabular">{health.liveSessions.toLocaleString("en-US")}</dd>
            </Link>
            <div className="flex items-center justify-between px-5 py-3">
              <dt className="text-fg-muted">Failed sign-ins in the last 24 hours</dt>
              <dd className={cn("font-semibold tabular", health.failedLogins24h > 50 ? "text-[var(--danger)]" : "text-fg")}>
                {health.failedLogins24h.toLocaleString("en-US")}
              </dd>
            </div>
          </dl>
        </Card>

        <Card>
          <CardHeader title="Modules & providers" action={<ToggleLeft className="size-5 text-fg-subtle" aria-hidden />} />
          <dl className="divide-y divide-[var(--border)] text-sm">
            <div className="flex items-center justify-between px-5 py-3">
              <dt className="text-fg-muted">Clinics & vet booking</dt>
              <dd>
                <Badge tone={features.clinics ? "success" : "neutral"} size="sm">
                  {features.clinics ? "On" : "Off"}
                </Badge>
              </dd>
            </div>
            <div className="flex items-center justify-between px-5 py-3">
              <dt className="text-fg-muted">Payment provider</dt>
              <dd>
                <Badge tone={isSandboxPayments() ? "warning" : "success"} size="sm">
                  {isSandboxPayments() ? "Sandbox ledger" : "Stripe"}
                </Badge>
              </dd>
            </div>
            <div className="flex items-center justify-between px-5 py-3">
              <dt className="text-fg-muted">Environment</dt>
              <dd className="font-medium text-fg">{humanize(process.env.NODE_ENV ?? "development")}</dd>
            </div>
          </dl>
          <p className="border-t border-[var(--border)] px-5 py-3 text-xs text-fg-muted">
            Modules are switched with <code className="font-mono">NEXT_PUBLIC_FEATURE_*</code> variables and take effect on the next build.
          </p>
        </Card>
      </div>
    </>
  );
}

function StatusGrid({ order, counts, hrefBase }: { order: string[]; counts: Record<string, number>; hrefBase: string }) {
  return (
    <ul className="grid grid-cols-2 gap-px bg-[var(--border)] sm:grid-cols-4">
      {order.map((status) => {
        const n = counts[status] ?? 0;
        return (
          <li key={status} className="bg-bg-elevated">
            <Link href={`${hrefBase}?f.status=${status}`} className="block px-5 py-4 transition-colors hover:bg-bg-sunken">
              <span className="block text-xs text-fg-muted">{humanize(status)}</span>
              <span className={cn("mt-1 block font-display text-xl font-bold tabular", BAD.has(status) && n > 0 ? "text-[var(--danger)]" : "text-fg")}>
                {n.toLocaleString("en-US")}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
