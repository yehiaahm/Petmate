import type { Metadata } from "next";
import Link from "next/link";
import { requireAuth } from "@/lib/auth/rbac";
import {
  getCurrentSubscription,
  getBillingHistory,
} from "@/lib/services/subscription.service";
import { getUsage } from "@/lib/billing/entitlements";
import { SubscriptionPanel } from "@/components/settings/subscription-panel";
import { PageHeader, Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { Receipt } from "lucide-react";

export const metadata: Metadata = {
  title: "Plan & billing",
  robots: { index: false, follow: false },
};

export default async function BillingSettingsPage() {
  const auth = await requireAuth();

  const [subscription, usageData, invoices] = await Promise.all([
    getCurrentSubscription(auth.user.id),
    getUsage(auth.user.id),
    getBillingHistory(auth.user.id),
  ]);

  return (
    <>
      <PageHeader
        title="Plan & billing"
        description="What you are on, what you are using, and every invoice we have issued you."
        action={<ButtonLink href="/pricing" variant="outline">Compare plans</ButtonLink>}
      />

      <div className="mt-6 space-y-5">
        <SubscriptionPanel
          subscription={
            subscription
              ? {
                  status: subscription.status,
                  interval: subscription.interval,
                  cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
                  currentPeriodEnd: subscription.currentPeriodEnd
                    ? subscription.currentPeriodEnd.toISOString()
                    : null,
                  trialEndsAt: subscription.trialEndsAt
                    ? subscription.trialEndsAt.toISOString()
                    : null,
                  planName: subscription.plan.name,
                  planCode: subscription.plan.code,
                  priceCents:
                    subscription.interval === "YEAR"
                      ? subscription.plan.priceYearlyCents
                      : subscription.plan.priceMonthlyCents,
                  currency: subscription.plan.currency,
                }
              : null
          }
          usage={usageData.usage}
        />

        <Card>
          <CardHeader
            title="Invoices"
            description="Every charge, including refunds against it. Kept as long as tax law requires."
          />
          <div className="p-5">
            {invoices.length === 0 ? (
              <EmptyState
                icon={<Receipt className="size-5" aria-hidden />}
                title="No invoices yet"
                description="Subscription charges and platform fees appear here as soon as one is issued."
                className="border-0 py-8"
              />
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {invoices.map((invoice) => {
                  const refunded = invoice.paymentIntent?.refundedCents ?? 0;
                  return (
                    <li
                      key={invoice.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3"
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-sm text-fg">{invoice.number}</p>
                        <p className="mt-0.5 text-xs text-fg-subtle">
                          {formatDate(invoice.issuedAt)}
                          {invoice.paymentIntent?.purpose
                            ? ` · ${invoice.paymentIntent.purpose.replaceAll("_", " ").toLowerCase()}`
                            : ""}
                        </p>
                      </div>
                      <div className="text-end">
                        <p className="text-sm font-semibold tabular text-fg">
                          {formatMoney(invoice.totalCents, invoice.currency)}
                        </p>
                        {refunded > 0 && (
                          <p className="mt-0.5 text-xs text-[var(--warning)] tabular">
                            {formatMoney(refunded, invoice.currency)} refunded
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>

        <p className="text-xs leading-relaxed text-fg-subtle">
          Money you earn from sales, bookings or payouts is not shown here — that lives in{" "}
          <Link href="/dashboard/wallet" className="font-medium text-brand hover:underline">
            your wallet
          </Link>
          . This page is only what you pay PetMate.
        </p>
      </div>
    </>
  );
}
