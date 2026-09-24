"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Landmark, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, Badge, EmptyState } from "@/components/ui/primitives";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";
import { relativeTime } from "@/lib/utils";

export interface PayoutRow {
  id: string;
  ownerType: string;
  ownerName: string;
  amountCents: number;
  currency: string;
  status: string;
  destination: string | null;
  requestedAt: string;
}

export function PayoutQueue({ payouts }: { payouts: PayoutRow[] }) {
  const router = useRouter();
  const toast = useToast();

  const [busy, setBusy] = useState<string | null>(null);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});

  async function act(key: string, body: unknown, title: string) {
    setBusy(key);
    try {
      await api.post("/api/admin", body);
      toast.success(title);
      router.refresh();
    } catch (err) {
      toast.error(
        "That did not go through",
        err instanceof ApiError ? err.message : "Please try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  if (payouts.length === 0) {
    return (
      <EmptyState
        icon={<Landmark className="size-5" aria-hidden />}
        title="No payouts waiting"
        description="Requests appear here as soon as someone withdraws. The money is already out of their available balance."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {payouts.map((payout) => (
        <li key={payout.id}>
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-lg font-semibold tabular text-fg">
                    {formatMoney(payout.amountCents, payout.currency)}
                  </span>
                  <Badge tone="warning" size="sm">
                    {payout.status.toLowerCase()}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-fg-muted">
                  {payout.ownerName}{" "}
                  <span className="text-xs text-fg-subtle">
                    ({payout.ownerType.toLowerCase()})
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-fg-subtle">
                  {payout.destination ?? "Bank transfer"} · requested{" "}
                  {relativeTime(new Date(payout.requestedAt))}
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <Field
                  label="Bank reference"
                  hint="Paste the reference from your banking system once the transfer is sent."
                >
                  {({ id, invalid }) => (
                    <Input
                      id={id}
                      invalid={invalid}
                      maxLength={100}
                      value={refs[payout.id] ?? ""}
                      onChange={(e) => setRefs((r) => ({ ...r, [payout.id]: e.target.value }))}
                      placeholder="FT26091234567"
                    />
                  )}
                </Field>
                <Button
                  className="mt-2"
                  size="sm"
                  loading={busy === `pay:${payout.id}`}
                  onClick={() =>
                    act(
                      `pay:${payout.id}`,
                      {
                        action: "pay-payout",
                        payoutId: payout.id,
                        providerRef: refs[payout.id] || undefined,
                      },
                      "Marked as paid",
                    )
                  }
                >
                  <CheckCircle2 className="size-4" aria-hidden />
                  Mark paid
                </Button>
              </div>

              <div>
                <Field label="Reason for rejecting" hint="The requester sees this.">
                  {({ id, invalid }) => (
                    <Input
                      id={id}
                      invalid={invalid}
                      maxLength={300}
                      value={reasons[payout.id] ?? ""}
                      onChange={(e) =>
                        setReasons((r) => ({ ...r, [payout.id]: e.target.value }))
                      }
                      placeholder="Account name does not match the verified identity."
                    />
                  )}
                </Field>
                <Button
                  className="mt-2"
                  size="sm"
                  variant="danger"
                  loading={busy === `reject:${payout.id}`}
                  disabled={(reasons[payout.id] ?? "").trim().length < 3}
                  onClick={() =>
                    act(
                      `reject:${payout.id}`,
                      {
                        action: "reject-payout",
                        payoutId: payout.id,
                        reason: reasons[payout.id],
                      },
                      "Rejected — the money went back",
                    )
                  }
                >
                  <XCircle className="size-4" aria-hidden />
                  Reject
                </Button>
              </div>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
