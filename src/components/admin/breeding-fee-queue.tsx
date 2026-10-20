"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dna, CheckCircle2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, Badge, EmptyState } from "@/components/ui/primitives";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";
import { relativeTime } from "@/lib/utils";

export interface BreedingFeeRow {
  id: string;
  feeStatus: string;
  feeCents: number;
  payoutCents: number;
  currency: string;
  pairing: string;
  payer: string;
  payee: string;
  updatedAt: string;
}

/**
 * Stud fees a person has to decide: frozen by the payer's report, or a refund
 * the gateway refused. Releasing pays the stud's owner; refunding returns the
 * whole fee to the payer. The support ticket holds both sides' account.
 */
export function BreedingFeeQueue({ fees }: { fees: BreedingFeeRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function decide(fee: BreedingFeeRow, decision: "RELEASE" | "REFUND") {
    const note = (notes[fee.id] ?? "").trim();
    if (note.length < 3) {
      toast.error("Add a note", "Record why, for the audit log and the owners.");
      return;
    }
    setBusy(`${decision}:${fee.id}`);
    try {
      const result = await api.post<{ feeStatus: string }>("/api/admin", {
        action: "resolve-breeding-fee",
        requestId: fee.id,
        decision,
        note,
      });
      if (result.feeStatus === "REFUND_PENDING") {
        toast.error("Refund not completed", "The payment provider refused it. Try again shortly.");
      } else {
        toast.success(decision === "RELEASE" ? "Fee released to the stud's owner" : "Fee refunded to the payer");
      }
      router.refresh();
    } catch (err) {
      toast.error("That did not go through", err instanceof ApiError ? err.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  }

  if (fees.length === 0) {
    return (
      <EmptyState
        icon={<Dna className="size-5" aria-hidden />}
        title="No stud fees on hold"
        description="A fee appears here when the payer reports a problem, or when a refund needs retrying."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {fees.map((fee) => (
        <li key={fee.id}>
          <Card className="p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-lg font-semibold tabular text-fg">
                {formatMoney(fee.feeCents, fee.currency)}
              </span>
              <Badge tone={fee.feeStatus === "FROZEN" ? "warning" : "danger"} size="sm">
                {fee.feeStatus === "FROZEN" ? "reported" : "refund failed"}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-fg-muted">{fee.pairing}</p>
            <p className="mt-0.5 text-xs text-fg-subtle">
              Paid by {fee.payer} to {fee.payee} ({formatMoney(fee.payoutCents, fee.currency)} after commission) ·
              updated {relativeTime(new Date(fee.updatedAt))}
            </p>

            <div className="mt-4">
              <Field label="Decision note" hint="Kept in the audit log with your decision.">
                {({ id, invalid }) => (
                  <Input
                    id={id}
                    invalid={invalid}
                    maxLength={300}
                    value={notes[fee.id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [fee.id]: e.target.value }))}
                  />
                )}
              </Field>
              <div className="mt-2 flex flex-wrap gap-2">
                {fee.feeStatus === "FROZEN" && (
                  <Button size="sm" loading={busy === `RELEASE:${fee.id}`} disabled={busy !== null} onClick={() => void decide(fee, "RELEASE")}>
                    <CheckCircle2 className="size-4" aria-hidden />
                    Release to stud owner
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  loading={busy === `REFUND:${fee.id}`}
                  disabled={busy !== null}
                  onClick={() => void decide(fee, "REFUND")}
                >
                  <Undo2 className="size-4" aria-hidden />
                  {fee.feeStatus === "FROZEN" ? "Refund the payer" : "Retry refund"}
                </Button>
              </div>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
