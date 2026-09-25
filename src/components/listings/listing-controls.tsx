"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Pause, CheckCircle2, Trash2, Sparkles, Loader2 } from "lucide-react";
import { Card, Alert, Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { uuid } from "@/lib/api-idempotency";
import { useI18n } from "@/components/i18n/i18n-provider";

/**
 * Listing state controls.
 *
 * Every transition goes through the same API action, so the server decides
 * what is allowed from the current state rather than the button deciding.
 * Closing a listing is confirmed, because "completed" is how a seller tells us
 * a transaction happened off-platform and it affects their record.
 */
export function ListingControls({
  listingId,
  status,
  featured,
  featuredUntil,
  featured7dCents,
  featured30dCents,
  currency,
}: {
  listingId: string;
  status: string;
  slug: string;
  featured: boolean;
  featuredUntil: Date | null;
  featured7dCents: number;
  featured30dCents: number;
  currency: string;
}) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const toast = useToast();

  const [working, setWorking] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState<"complete" | "remove" | null>(null);
  const [featureOpen, setFeatureOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: string, successMessage: string) {
    setWorking(action);
    setError(null);

    try {
      await api.post(`/api/listings/${listingId}`, { action });
      toast.success(successMessage);
      setConfirmClose(null);
      router.refresh();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Please try again.";
      setError(message);
      toast.error(t("That did not work"), message);
    } finally {
      setWorking(null);
    }
  }

  async function buyFeatured(days: 7 | 30) {
    setWorking("feature");
    setError(null);

    try {
      const result = await api.post<{
        payment: { id: string; redirectUrl: string | null };
      }>(`/api/listings/${listingId}`, {
        action: "feature",
        days,
        idempotencyKey: uuid(),
      });

      if (result.payment.redirectUrl) {
        router.push(result.payment.redirectUrl);
      } else {
        router.push(`/checkout/${result.payment.id}`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We could not start that payment.");
      setWorking(null);
    }
  }

  const canPublish = ["DRAFT", "PAUSED", "EXPIRED"].includes(status);
  const canPause = ["ACTIVE", "PENDING_REVIEW"].includes(status);
  const canClose = !["COMPLETED", "REMOVED"].includes(status);
  const canFeature = ["ACTIVE", "PENDING_REVIEW"].includes(status);

  return (
    <>
      <div className="space-y-4 lg:sticky lg:top-24">
        <Card className="p-5">
          <h2 className="font-display text-base font-semibold text-fg">{t("Listing status")}</h2>

          {error && (
            <div className="mt-3">
              <Alert tone="danger">{error}</Alert>
            </div>
          )}

          <div className="mt-3 space-y-2">
            {canPublish && (
              <Button
                fullWidth
                onClick={() => void act("publish", "Listing published")}
                loading={working === "publish"}
                loadingText={t("Publishing…")}
              >
                <Play className="size-4" aria-hidden />
                {status === "EXPIRED" ? t("Renew listing") : t("Publish")}
              </Button>
            )}

            {canPause && (
              <Button
                fullWidth
                variant="outline"
                onClick={() => void act("pause", "Listing paused")}
                loading={working === "pause"}
                loadingText={t("Pausing…")}
              >
                <Pause className="size-4" aria-hidden />
                {t("Pause")}
              </Button>
            )}

            {canClose && (
              <Button
                fullWidth
                variant="outline"
                onClick={() => setConfirmClose("complete")}
                disabled={Boolean(working)}
              >
                <CheckCircle2 className="size-4" aria-hidden />
                {t("Mark as rehomed")}
              </Button>
            )}

            <Button
              fullWidth
              variant="ghost"
              onClick={() => setConfirmClose("remove")}
              disabled={Boolean(working) || status === "REMOVED"}
              className="text-[var(--danger)] hover:bg-[var(--danger-soft)]"
            >
              <Trash2 className="size-4" aria-hidden />
              {t("Delete listing")}
            </Button>
          </div>
        </Card>

        {canFeature && (
          <Card className="p-5">
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-display text-base font-semibold text-fg">{t("Visibility")}</h2>
              {featured && <Badge tone="accent" size="sm">{t("Featured")}</Badge>}
            </div>

            {featured && featuredUntil ? (
              <p className="mt-2 text-sm text-fg-muted">
                {t("Featured until {date}. Buying more time extends it rather than replacing it.", { date: fmt.date(featuredUntil, "long") })}
              </p>
            ) : (
              <p className="mt-2 text-sm text-fg-muted">
                {t("A featured listing ranks higher in search. It does not override quality — a well-documented organic listing can still outrank a featured one.")}
              </p>
            )}

            <Button
              fullWidth
              variant="accent"
              className="mt-3"
              onClick={() => setFeatureOpen(true)}
              disabled={Boolean(working)}
            >
              <Sparkles className="size-4" aria-hidden />
              {featured ? t("Extend featuring") : t("Feature this listing")}
            </Button>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={confirmClose === "complete"}
        onClose={() => setConfirmClose(null)}
        onConfirm={() => void act("complete", "Listing closed")}
        loading={working === "complete"}
        tone="primary"
        title={t("Mark as rehomed?")}
        description={t("This closes the listing and records that the pet found a home. Use this when the transaction happened — it counts toward your seller record.")}
        confirmLabel="Mark as rehomed"
      />

      <ConfirmDialog
        open={confirmClose === "remove"}
        onClose={() => setConfirmClose(null)}
        onConfirm={() => void act("remove", "Listing deleted")}
        loading={working === "remove"}
        title={t("Delete this listing?")}
        description={t("The listing disappears from the marketplace. Your pet's profile and health record are untouched. This cannot be undone.")}
        confirmLabel="Delete"
      />

      <Modal
        open={featureOpen}
        onClose={() => setFeatureOpen(false)}
        title={t("Feature this listing")}
        description={t("Featured listings appear near the top of matching searches.")}
      >
        <div className="space-y-3">
          {[
            { days: 7 as const, cents: featured7dCents, label: "7 days" },
            { days: 30 as const, cents: featured30dCents, label: "30 days", best: true },
          ].map((option) => (
            <button
              key={option.days}
              type="button"
              onClick={() => void buyFeatured(option.days)}
              disabled={Boolean(working)}
              className="flex w-full items-center justify-between gap-4 rounded-[var(--radius-field)] border border-[var(--border-strong)] p-4 text-start transition-colors hover:border-brand hover:bg-brand-soft disabled:opacity-60"
            >
              <span>
                <span className="block font-semibold text-fg">{t(option.label)}</span>
                <span className="block text-xs text-fg-muted">
                  {option.best ? t("Best value per day") : t("Short boost")}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="font-display text-lg font-semibold tabular text-fg">
                  {fmt.money(option.cents, currency)}
                </span>
                {working === "feature" && <Loader2 className="size-4 animate-spin" aria-hidden />}
              </span>
            </button>
          ))}

          {error && <Alert tone="danger">{error}</Alert>}

          <p className="text-xs text-fg-subtle">
            {t("You will be taken to checkout. The listing is featured as soon as payment completes.")}
          </p>
        </div>
      </Modal>
    </>
  );
}
