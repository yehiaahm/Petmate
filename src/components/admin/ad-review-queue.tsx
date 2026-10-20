"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, Badge, EmptyState } from "@/components/ui/primitives";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";
import { formatDate, relativeTime } from "@/lib/utils";

export interface AdReviewRow {
  id: string;
  name: string;
  slot: string;
  headline: string;
  body: string | null;
  imageUrl: string | null;
  destinationUrl: string;
  budgetCents: number;
  currency: string;
  startAt: string;
  endAt: string;
  createdAt: string;
  advertiser: string;
}

const SLOT_LABEL: Record<string, string> = {
  HOME_HERO: "Home page",
  SEARCH_INLINE: "Search results",
  CLINIC_SIDEBAR: "Vet directory",
};

/**
 * Paid campaigns waiting for a person. The budget is already collected:
 * approving lets it run from its start date; rejecting refunds it in full and
 * sends the advertiser the note, so write it for them.
 */
export function AdReviewQueue({ campaigns }: { campaigns: AdReviewRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function review(id: string, decision: "APPROVE" | "REJECT") {
    const note = (notes[id] ?? "").trim() || (decision === "APPROVE" ? "Meets the advertising policy." : "");
    if (note.length < 3) {
      toast.error("Add a reason", "The advertiser sees it with the refund.");
      return;
    }
    setBusy(`${decision}:${id}`);
    try {
      await api.post("/api/admin", { action: "review-ad", campaignId: id, decision, note });
      toast.success(decision === "APPROVE" ? "Campaign approved" : "Campaign rejected and refunded");
      router.refresh();
    } catch (err) {
      toast.error("That did not go through", err instanceof ApiError ? err.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  }

  if (campaigns.length === 0) {
    return (
      <EmptyState
        icon={<Megaphone className="size-5" aria-hidden />}
        title="No campaigns waiting"
        description="Paid campaigns appear here before they can run."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {campaigns.map((c) => (
        <li key={c.id}>
          <Card className="p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-fg">{c.name}</span>
              <Badge tone="info" size="sm">{SLOT_LABEL[c.slot] ?? c.slot}</Badge>
              <span className="text-sm tabular text-fg-muted">{formatMoney(c.budgetCents, c.currency)}</span>
            </div>
            <p className="mt-0.5 text-xs text-fg-subtle">
              {c.advertiser} · {formatDate(c.startAt)} – {formatDate(c.endAt)} · paid {relativeTime(new Date(c.createdAt))}
            </p>

            <div className="mt-3 rounded-[var(--radius-field)] border border-[var(--border)] p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">Sponsored</p>
              <p className="mt-1 font-semibold text-fg">{c.headline}</p>
              {c.body && <p className="mt-0.5 text-sm text-fg-muted">{c.body}</p>}
              {c.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- reviewing the advertiser's exact asset
                <img src={c.imageUrl} alt="" className="mt-2 max-h-40 rounded-md object-cover" />
              )}
              <a href={c.destinationUrl} target="_blank" rel="noopener noreferrer nofollow" className="mt-2 inline-flex items-center gap-1 text-xs text-brand hover:underline">
                {c.destinationUrl}
                <ExternalLink className="size-3" aria-hidden />
              </a>
            </div>

            <div className="mt-4">
              <Field label="Note to the advertiser" hint="Required when rejecting; it is sent with the refund.">
                {({ id, invalid }) => (
                  <Input id={id} invalid={invalid} maxLength={300} value={notes[c.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))} />
                )}
              </Field>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" loading={busy === `APPROVE:${c.id}`} disabled={busy !== null} onClick={() => void review(c.id, "APPROVE")}>
                  <CheckCircle2 className="size-4" aria-hidden />
                  Approve
                </Button>
                <Button size="sm" variant="outline" loading={busy === `REJECT:${c.id}`} disabled={busy !== null} onClick={() => void review(c.id, "REJECT")}>
                  <XCircle className="size-4" aria-hidden />
                  Reject and refund
                </Button>
              </div>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
