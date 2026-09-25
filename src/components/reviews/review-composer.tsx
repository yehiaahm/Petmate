"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n/i18n-provider";

/**
 * Writing a review.
 *
 * The reference (`orderId` / `petOrderId` / `appointmentId`) is not decoration:
 * the server re-verifies that this account really was party to that
 * transaction before it will accept the review. Passing someone else's id
 * fails there, not here.
 */
export function ReviewComposer({
  targetType,
  targetId,
  refType,
  refId,
  label,
}: {
  targetType: string;
  targetId: string;
  refType: string;
  refId: string;
  label: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refKey =
    refType === "appointment"
      ? "appointmentId"
      : refType === "purchase"
        ? "petOrderId"
        : "orderId";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/api/reviews", {
        action: "create",
        review: {
          targetType,
          targetId,
          rating,
          title: title.trim() || undefined,
          body,
          [refKey]: refId,
        },
      });
      toast.success(t("Review posted"), `Thanks — this helps the next person choose.`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not post that review.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Star className="size-4" aria-hidden />
        {t("Write a review")}
      </Button>
    );
  }

  const shown = hovered || rating;

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}

      <fieldset>
        <legend className="text-sm font-medium text-fg">
          {t("How was {aspect}?", { aspect: label })}<span className="ms-0.5 text-[var(--danger)]" aria-hidden>*</span>
        </legend>
        <div className="mt-2 flex gap-1" onMouseLeave={() => setHovered(0)}>
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              onMouseEnter={() => setHovered(star)}
              aria-label={t.plural(star, { one: "{count} star", other: "{count} stars" })}
              aria-pressed={rating === star}
              className="rounded p-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
              <Star
                className={cn(
                  "size-7 transition-colors",
                  star <= shown
                    ? "fill-[var(--warning)] text-[var(--warning)]"
                    : "fill-transparent text-[var(--border-strong)]",
                )}
                aria-hidden
              />
            </button>
          ))}
        </div>
      </fieldset>

      <Field label={t("Headline")} hint={t("Optional.")}>
        {({ id, invalid }) => (
          <Input
            id={id}
            invalid={invalid}
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("Honest about the puppy's health from the start")}
          />
        )}
      </Field>

      <Field
        label={t("What happened?")}
        required
        hint={t("What was accurate, what was not, and how the handover went. At least 20 characters.")}
        trailing={`${body.length}/2000`}
      >
        {({ id, invalid }) => (
          <Textarea
            id={id}
            invalid={invalid}
            rows={5}
            maxLength={2000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        )}
      </Field>

      <div className="flex justify-end gap-3">
        <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
          {t("Not now")}
        </Button>
        <Button
          type="submit"
          size="sm"
          loading={submitting}
          loadingText={t("Posting…")}
          disabled={rating === 0 || body.trim().length < 20}
        >
          {t("Post review")}
        </Button>
      </div>
    </form>
  );
}
