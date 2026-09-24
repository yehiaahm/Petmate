"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Card, Badge, Alert } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { goToPayment } from "@/lib/payment-redirect";
import { api, ApiError } from "@/lib/api-client";
import { uuid } from "@/lib/api-idempotency";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { PLAN_AUDIENCE, type PlanAudience } from "@/lib/constants";

interface Plan {
  id: string;
  code: string;
  name: string;
  tagline: string | null;
  audience: string;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  currency: string;
  features: string[];
}

const AUDIENCE_LABEL: Record<string, string> = {
  CONSUMER: "Pet owners",
  BREEDER: "Breeders",
  SELLER: "Shops",
  CLINIC: "Clinics",
};

export function PlanGrid({
  plans,
  currentPlanCode,
  signedIn,
}: {
  plans: Plan[];
  currentPlanCode: string;
  signedIn: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const [interval, setInterval] = useState<"MONTH" | "YEAR">("MONTH");
  const [audience, setAudience] = useState<PlanAudience>("CONSUMER");
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = plans.filter((p) => p.audience === audience || p.code === "free");

  async function subscribe(plan: Plan) {
    if (!signedIn) {
      router.push(`/register?next=/pricing`);
      return;
    }

    setWorking(plan.code);
    setError(null);

    try {
      const result = await api.post<{
        payment: { id: string; redirectUrl: string | null };
      }>("/api/account", {
        action: "subscribe",
        planCode: plan.code,
        interval,
        idempotencyKey: uuid(),
      });

      if (result.payment.redirectUrl) {
        goToPayment(result.payment.redirectUrl, router.push);
      } else {
        router.push(`/checkout/${result.payment.id}`);
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "We could not start that upgrade.";
      setError(message);
      toast.error("Upgrade failed", message);
      setWorking(null);
    }
  }

  return (
    <div>
      <div className="flex flex-col items-center gap-4">
        <SegmentedControl
          label="Plan audience"
          value={audience}
          onChange={(v) => setAudience(v as PlanAudience)}
          className="max-w-xl"
          options={PLAN_AUDIENCE.map((value) => ({ value, label: AUDIENCE_LABEL[value]! }))}
        />

        <div className="flex items-center gap-3">
          <SegmentedControl
            label="Billing interval"
            value={interval}
            onChange={(v) => setInterval(v as "MONTH" | "YEAR")}
            className="w-56"
            options={[
              { value: "MONTH", label: "Monthly" },
              { value: "YEAR", label: "Yearly" },
            ]}
          />
          {interval === "YEAR" && (
            <Badge tone="accent" size="sm">
              2 months free
            </Badge>
          )}
        </div>
      </div>

      {error && (
        <div className="mx-auto mt-6 max-w-lg">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      <ul
        className={cn(
          "mt-10 grid gap-5",
          visible.length === 2 ? "sm:grid-cols-2 lg:mx-auto lg:max-w-3xl" : "lg:grid-cols-3",
        )}
      >
        {visible.map((plan) => {
          const isCurrent = plan.code === currentPlanCode;
          const isFree = plan.code === "free";
          const price = interval === "YEAR" ? plan.priceYearlyCents : plan.priceMonthlyCents;
          const highlight = !isFree && visible.length > 1;

          return (
            <li key={plan.id}>
              <Card
                className={cn(
                  "flex h-full flex-col p-6",
                  highlight && "border-brand shadow-[var(--shadow-card)]",
                )}
              >
                {highlight && (
                  <Badge tone="brand" className="mb-3 self-start">
                    Most capable
                  </Badge>
                )}

                <h3 className="font-display text-xl font-semibold text-fg">{plan.name}</h3>
                {plan.tagline && (
                  <p className="mt-1 text-sm text-fg-muted">{plan.tagline}</p>
                )}

                <div className="mt-5 flex items-baseline gap-1.5">
                  <span className="font-display text-4xl font-semibold tabular text-fg">
                    {price === 0 ? "Free" : formatMoney(price, plan.currency)}
                  </span>
                  {price > 0 && (
                    <span className="text-sm text-fg-muted">
                      /{interval === "YEAR" ? "year" : "month"}
                    </span>
                  )}
                </div>

                <ul className="mt-6 flex-1 space-y-2.5">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 text-sm">
                      <Check
                        className="mt-0.5 size-4 shrink-0 text-[var(--success)]"
                        aria-hidden
                      />
                      <span className="text-fg-muted">{feature}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-6">
                  {isCurrent ? (
                    <Button variant="secondary" fullWidth disabled>
                      Your current plan
                    </Button>
                  ) : isFree ? (
                    <Button variant="outline" fullWidth disabled>
                      Included with every account
                    </Button>
                  ) : (
                    <Button
                      fullWidth
                      variant={highlight ? "primary" : "outline"}
                      onClick={() => void subscribe(plan)}
                      loading={working === plan.code}
                      loadingText="Starting…"
                    >
                      {signedIn ? `Upgrade to ${plan.name}` : "Get started"}
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
