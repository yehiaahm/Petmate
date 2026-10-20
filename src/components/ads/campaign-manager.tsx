"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Plus, Pause, Play, Square, CreditCard, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Alert, Badge, Card, EmptyState, StatusPill } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/components/i18n/i18n-provider";
import { api, ApiError } from "@/lib/api-client";
import { parseMoneyToCents } from "@/lib/money";
import { goToPayment } from "@/lib/payment-redirect";
import { AD_SLOTS, type AdSlot } from "@/lib/constants";

export interface CampaignRow {
  id: string;
  name: string;
  slot: string;
  status: string;
  headline: string;
  body: string | null;
  budgetCents: number;
  spentCents: number;
  returnedCents: number;
  currency: string;
  impressions: number;
  plannedImpressions: number;
  clicks: number;
  ctr: number;
  startAt: string;
  endAt: string;
  reviewNote: string | null;
}

export interface AdPricing {
  currency: string;
  minBudgetCents: number;
  maxDays: number;
  cpm: Record<AdSlot, number>;
  today: string;
  defaultEnd: string;
}

const STATUS_TONE: Record<string, "info" | "warning" | "success" | "danger" | "neutral"> = {
  DRAFT: "warning",
  PENDING_REVIEW: "info",
  ACTIVE: "success",
  PAUSED: "neutral",
  COMPLETED: "neutral",
  REJECTED: "danger",
};

function useSlotLabels() {
  const { t } = useI18n();
  return {
    HOME_HERO: t("Home page"),
    SEARCH_INLINE: t("Pet search results"),
    CLINIC_SIDEBAR: t("Vet directory"),
  } as Record<string, string>;
}

export function CampaignManager({ campaigns, pricing }: { campaigns: CampaignRow[]; pricing: AdPricing }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const slotLabel = useSlotLabels();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const statusLabel: Record<string, string> = {
    DRAFT: t("Awaiting payment"),
    PENDING_REVIEW: t("In review"),
    ACTIVE: t("Running"),
    PAUSED: t("Paused"),
    COMPLETED: t("Finished"),
    REJECTED: t("Not approved"),
  };

  async function act(campaign: CampaignRow, action: "pause" | "resume" | "end" | "pay" | "discard") {
    setBusy(`${action}:${campaign.id}`);
    try {
      const result = await api.post<{ payment?: { id: string; redirectUrl: string | null }; returnedCents?: number }>(
        "/api/ads",
        { action, campaignId: campaign.id },
      );
      if (action === "pay" && result.payment) {
        goToPayment(result.payment.redirectUrl ?? `/checkout/${result.payment.id}`, router.push);
        return;
      }
      if (action === "end") {
        toast.success(
          t("Campaign ended"),
          result.returnedCents
            ? t("{amount} is back in your wallet.", { amount: fmt.money(result.returnedCents, campaign.currency) })
            : undefined,
        );
      }
      router.refresh();
    } catch (err) {
      toast.error(t("That did not work"), err instanceof ApiError ? err.message : t("Please try again."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-fg-muted">
          {t("You pay the budget up front. You are charged only for impressions delivered, and anything left at the end date goes back to your wallet.")}
        </p>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden />
          {t("New campaign")}
        </Button>
      </div>

      {campaigns.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={<Megaphone className="size-6" aria-hidden />}
            title={t("No campaigns yet")}
            description={t("Reach pet owners on the home page, in search results or beside the vet directory. Every ad is labelled as sponsored.")}
          />
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {campaigns.map((c) => {
            const delivered = c.plannedImpressions > 0 ? Math.min(1, c.impressions / c.plannedImpressions) : 0;
            return (
              <li key={c.id}>
                <Card className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-fg">{c.name}</p>
                      <p className="mt-0.5 text-xs text-fg-subtle">
                        {slotLabel[c.slot] ?? c.slot} · {fmt.date(c.startAt)} – {fmt.date(new Date(new Date(c.endAt).getTime() - 1))}
                      </p>
                    </div>
                    <StatusPill tone={STATUS_TONE[c.status] ?? "neutral"}>{statusLabel[c.status] ?? c.status}</StatusPill>
                  </div>

                  <p className="mt-3 text-sm text-fg">{c.headline}</p>

                  {c.status === "REJECTED" && c.reviewNote && (
                    <Alert tone="danger" className="mt-3">
                      {c.reviewNote} {t("Your budget has been refunded.")}
                    </Alert>
                  )}

                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-xs text-fg-subtle">{t("Impressions")}</dt>
                      <dd className="font-semibold tabular text-fg">{fmt.number(c.impressions)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-fg-subtle">{t("Clicks")}</dt>
                      <dd className="font-semibold tabular text-fg">
                        {fmt.number(c.clicks)}{" "}
                        <span className="text-xs font-normal text-fg-muted">({(c.ctr * 100).toFixed(1)}%)</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-fg-subtle">{t("Spent")}</dt>
                      <dd className="font-semibold tabular text-fg">
                        {fmt.money(c.spentCents, c.currency)}{" "}
                        <span className="text-xs font-normal text-fg-muted">/ {fmt.money(c.budgetCents, c.currency)}</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-fg-subtle">{c.returnedCents > 0 ? t("Returned to wallet") : t("Budget delivered")}</dt>
                      <dd className="font-semibold tabular text-fg">
                        {c.returnedCents > 0 ? fmt.money(c.returnedCents, c.currency) : `${Math.round(delivered * 100)}%`}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {c.status === "DRAFT" && (
                      <>
                        <Button size="sm" loading={busy === `pay:${c.id}`} onClick={() => void act(c, "pay")}>
                          <CreditCard className="size-4" aria-hidden />
                          {t("Pay and submit")}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void act(c, "discard")}>
                          <Trash2 className="size-4" aria-hidden />
                          {t("Discard")}
                        </Button>
                      </>
                    )}
                    {c.status === "ACTIVE" && (
                      <Button size="sm" variant="outline" loading={busy === `pause:${c.id}`} onClick={() => void act(c, "pause")}>
                        <Pause className="size-4" aria-hidden />
                        {t("Pause")}
                      </Button>
                    )}
                    {c.status === "PAUSED" && (
                      <Button size="sm" variant="outline" loading={busy === `resume:${c.id}`} onClick={() => void act(c, "resume")}>
                        <Play className="size-4 rtl:-scale-x-100" aria-hidden />
                        {t("Resume")}
                      </Button>
                    )}
                    {(c.status === "ACTIVE" || c.status === "PAUSED") && (
                      <Button size="sm" variant="ghost" loading={busy === `end:${c.id}`} onClick={() => void act(c, "end")}>
                        <Square className="size-4" aria-hidden />
                        {t("End now and refund the rest")}
                      </Button>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <CampaignForm open={creating} onClose={() => setCreating(false)} pricing={pricing} />
    </div>
  );
}

function CampaignForm({ open, onClose, pricing }: { open: boolean; onClose: () => void; pricing: AdPricing }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const slotLabel = useSlotLabels();
  const today = pricing.today;

  const [name, setName] = useState("");
  const [slot, setSlot] = useState<AdSlot>("HOME_HERO");
  const [headline, setHeadline] = useState("");
  const [body, setBody] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [destinationUrl, setDestinationUrl] = useState("");
  const [budget, setBudget] = useState(String(pricing.minBudgetCents / 100));
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(pricing.defaultEnd);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const budgetCents = parseMoneyToCents(budget) ?? 0;
  const cpm = pricing.cpm[slot];
  const estimated = cpm > 0 ? Math.floor((budgetCents * 1000) / cpm) : 0;

  async function submit() {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const result = await api.post<{ payment: { id: string; redirectUrl: string | null } }>("/api/ads", {
        action: "create",
        idempotencyKey,
        campaign: {
          name,
          slot,
          headline,
          body: body || undefined,
          imageUrl: imageUrl || undefined,
          destinationUrl,
          budgetCents,
          startDate,
          endDate,
        },
      });
      goToPayment(result.payment.redirectUrl ?? `/checkout/${result.payment.id}`, router.push);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        const fields: Record<string, string> = {};
        for (const f of err.fields ?? []) fields[f.field.replace(/^campaign\./, "")] = f.message;
        setFieldErrors(fields);
      } else {
        setError(t("Please try again."));
      }
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("New campaign")}
      description={t("Our team reviews every campaign before it runs. If it is not approved, the whole budget is refunded.")}
      size="lg"
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        <Field label={t("Campaign name")} hint={t("Only you see this.")} error={fieldErrors.name} required>
          {({ id, invalid }) => <Input id={id} invalid={invalid} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>

        <Field label={t("Placement")} error={fieldErrors.slot}>
          {({ id }) => (
            <Select id={id} value={slot} onChange={(e) => setSlot(e.target.value as AdSlot)}>
              {AD_SLOTS.map((s) => (
                <option key={s} value={s}>
                  {t("{placement} · {price} per 1,000 impressions", { placement: slotLabel[s] ?? s, price: fmt.money(pricing.cpm[s], pricing.currency) })}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label={t("Headline")} error={fieldErrors.headline} trailing={`${headline.length}/70`} required>
          {({ id, invalid }) => <Input id={id} invalid={invalid} maxLength={70} value={headline} onChange={(e) => setHeadline(e.target.value)} />}
        </Field>

        <Field label={t("Text (optional)")} error={fieldErrors.body} trailing={`${body.length}/140`}>
          {({ id, invalid }) => <Textarea id={id} invalid={invalid} rows={2} maxLength={140} value={body} onChange={(e) => setBody(e.target.value)} />}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Link")} hint={t("A PetMate page such as /store, or a secure https:// address.")} error={fieldErrors.destinationUrl} required>
            {({ id, invalid }) => (
              <Input id={id} invalid={invalid} dir="ltr" maxLength={500} value={destinationUrl} onChange={(e) => setDestinationUrl(e.target.value)} placeholder="https://" />
            )}
          </Field>
          <Field label={t("Image address (optional)")} error={fieldErrors.imageUrl}>
            {({ id, invalid }) => (
              <Input id={id} invalid={invalid} dir="ltr" maxLength={500} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://" />
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label={t("Budget")}
            hint={t("At least {amount}", { amount: fmt.money(pricing.minBudgetCents, pricing.currency) })}
            error={fieldErrors.budgetCents}
          >
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                inputMode="decimal"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                leading={<span className="text-sm">{pricing.currency}</span>}
              />
            )}
          </Field>
          <Field label={t("Starts")} error={fieldErrors.startDate}>
            {({ id, invalid }) => <Input id={id} invalid={invalid} type="date" min={today} value={startDate} onChange={(e) => setStartDate(e.target.value)} />}
          </Field>
          <Field label={t("Ends")} error={fieldErrors.endDate} hint={t("Up to {days} days", { days: pricing.maxDays })}>
            {({ id, invalid }) => <Input id={id} invalid={invalid} type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} />}
          </Field>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-fg-subtle">{t("Preview")}</p>
          <div className="flex items-center gap-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
            {/^https:\/\//.test(imageUrl) && (
              // eslint-disable-next-line @next/next/no-img-element -- previewing the advertiser's own URL
              <img src={imageUrl} alt="" className="size-16 shrink-0 rounded-lg object-cover" />
            )}
            <span className="min-w-0">
              <span className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">{t("Sponsored")}</span>
              <span className="mt-0.5 block font-semibold text-fg">{headline || t("Your headline")}</span>
              {body && <span className="mt-0.5 block text-sm text-fg-muted">{body}</span>}
            </span>
          </div>
          <p className="mt-2 text-sm text-fg-muted">
            <Badge tone="brand" size="sm">
              {t("About {count} impressions", { count: fmt.number(estimated) })}
            </Badge>
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!name || !headline || !destinationUrl || budgetCents <= 0}>
            <CreditCard className="size-4" aria-hidden />
            {t("Pay {amount} and submit", { amount: fmt.money(budgetCents, pricing.currency) })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
