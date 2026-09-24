"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, AlertTriangle } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardHeader, Badge, Alert } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";
import { formatDate, cn } from "@/lib/utils";

interface Subscription {
  status: string;
  interval: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  planName: string;
  planCode: string;
  priceCents: number;
  currency: string;
}

interface UsageRow {
  key: string;
  label: string;
  used: number;
  limit: number;
}

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "info"> = {
  ACTIVE: "success",
  TRIALING: "info",
  PAST_DUE: "danger",
};

export function SubscriptionPanel({
  subscription,
  usage,
}: {
  subscription: Subscription | null;
  usage: UsageRow[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);

  async function cancel() {
    setWorking(true);
    try {
      await api.post("/api/account", { action: "cancel-subscription", immediate: false });
      toast.success(
        "Cancelled",
        "You keep everything until the end of the period you have paid for.",
      );
      setConfirming(false);
      router.refresh();
    } catch (err) {
      toast.error(
        "Could not cancel",
        err instanceof ApiError ? err.message : "Please try again.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function resume() {
    setWorking(true);
    try {
      await api.post("/api/account", { action: "resume-subscription" });
      toast.success("Subscription resumed");
      router.refresh();
    } catch (err) {
      toast.error(
        "Could not resume",
        err instanceof ApiError ? err.message : "Please try again.",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Your plan"
          action={
            subscription ? (
              <Badge tone={STATUS_TONE[subscription.status] ?? "neutral"}>
                {subscription.status === "TRIALING" ? "Trial" : subscription.status.toLowerCase()}
              </Badge>
            ) : (
              <Badge tone="neutral">Free</Badge>
            )
          }
        />

        <div className="p-5">
          {subscription ? (
            <>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-display text-2xl font-semibold text-fg">
                  {subscription.planName}
                </span>
                <span className="text-fg-muted tabular">
                  {formatMoney(subscription.priceCents, subscription.currency)} /{" "}
                  {subscription.interval === "YEAR" ? "year" : "month"}
                </span>
              </div>

              {subscription.trialEndsAt && subscription.status === "TRIALING" && (
                <p className="mt-2 text-sm text-fg-muted">
                  Trial ends {formatDate(subscription.trialEndsAt)}.
                </p>
              )}

              {subscription.cancelAtPeriodEnd ? (
                <Alert tone="warning" className="mt-4" title="Cancelled">
                  <p className="mt-1">
                    You keep {subscription.planName} until{" "}
                    {formatDate(subscription.currentPeriodEnd)}, then drop to the free plan. Nothing
                    is deleted — listings over the free limit are paused, not removed.
                  </p>
                </Alert>
              ) : (
                subscription.currentPeriodEnd && (
                  <p className="mt-2 text-sm text-fg-muted">
                    Renews {formatDate(subscription.currentPeriodEnd)}.
                  </p>
                )
              )}

              <div className="mt-5 flex flex-wrap gap-3">
                <ButtonLink href="/pricing" variant="outline">
                  Change plan
                </ButtonLink>
                {subscription.cancelAtPeriodEnd ? (
                  <Button onClick={resume} loading={working} loadingText="Resuming…">
                    Resume subscription
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={() => setConfirming(true)}>
                    Cancel subscription
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="text-[15px] text-fg-muted">
                You are on the free plan. Everything that makes a transaction safe — escrow,
                disputes, clinic-verified records, messaging — is included and always will be. Paid
                plans raise limits and add reach.
              </p>
              <div className="mt-5">
                <ButtonLink href="/pricing">
                  <Sparkles className="size-4" aria-hidden />
                  See what a plan adds
                </ButtonLink>
              </div>
            </>
          )}

          <div className="mt-6 border-t border-[var(--border)] pt-5">
            <h3 className="text-sm font-semibold text-fg">This month</h3>
            <ul className="mt-3 space-y-3">
              {usage.map((row) => {
                const unlimited = row.limit < 0;
                const pct = unlimited ? 0 : Math.min(100, (row.used / Math.max(1, row.limit)) * 100);
                const over = !unlimited && row.used >= row.limit;
                return (
                  <li key={row.key}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-fg-muted">{row.label}</span>
                      <span className={cn("tabular font-medium", over ? "text-[var(--warning)]" : "text-fg")}>
                        {row.used}
                        {unlimited ? "" : ` / ${row.limit}`}
                      </span>
                    </div>
                    {!unlimited && (
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg-sunken">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            over ? "bg-[var(--warning)]" : "bg-brand",
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </Card>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Cancel your subscription?"
      >
        <div className="space-y-4">
          <Alert tone="warning" icon={<AlertTriangle className="size-4" aria-hidden />}>
            <p>
              You keep everything until{" "}
              {formatDate(subscription?.currentPeriodEnd)} — cancelling does not end it today and
              there is no refund of the current period.
            </p>
          </Alert>
          <p className="text-sm leading-relaxed text-fg-muted">
            After that you move to the free plan. Listings above the free limit are paused rather
            than deleted, so resubscribing brings them straight back.
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={cancel} loading={working} loadingText="Cancelling…">
              Cancel subscription
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
