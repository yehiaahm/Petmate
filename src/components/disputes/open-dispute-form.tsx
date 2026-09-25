"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Textarea, Select } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { api, ApiError } from "@/lib/api-client";
import { DISPUTE_REASON, DISPUTE_REASON_LABEL, type DisputeReason } from "@/lib/constants";
import { useI18n } from "@/components/i18n/i18n-provider";

interface Subject {
  kind: "pet" | "order";
  id: string;
  label: string;
  amountCents: number;
  currency: string;
}

export function OpenDisputeForm({
  subject,
  disputeWindowDays,
}: {
  subject: Subject;
  disputeWindowDays: number;
}) {
  const { t } = useI18n();
  const router = useRouter();

  const [reason, setReason] = useState<DisputeReason>("NOT_AS_DESCRIBED");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.post<{ dispute: { id: string; reference: string } }>(
        "/api/safety",
        {
          action: "dispute",
          dispute: {
            ...(subject.kind === "pet" ? { petOrderId: subject.id } : { orderId: subject.id }),
            reason,
            details,
          },
        },
      );
      router.push(`/dashboard/disputes/${result.dispute.id}`);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Could not open the dispute."));
      setSubmitting(false);
    }
  }

  const fieldError = (name: string) =>
    error instanceof ApiError ? error.fieldError(name) : undefined;

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {error && !(error instanceof ApiError && error.isValidation) && (
        <Alert tone="danger">{error.message}</Alert>
      )}

      <Field label={t("What went wrong?")} required error={fieldError("reason")}>
        {({ id }) => (
          <Select id={id} value={reason} onChange={(e) => setReason(e.target.value as DisputeReason)}>
            {DISPUTE_REASON.map((value) => (
              <option key={value} value={value}>
                {t(DISPUTE_REASON_LABEL[value])}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field
        label={t("Tell us what happened")}
        required
        hint={t("At least a couple of sentences. Dates, what was agreed, what actually arrived, and what you have already tried.")}
        error={fieldError("details")}
        trailing={`${details.length}/3000`}
      >
        {({ id, invalid }) => (
          <Textarea
            id={id}
            invalid={invalid}
            rows={8}
            maxLength={3000}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder={t("The listing said the puppy had two vaccinations. The clinic record shows one, dated after the listing went live…")}
          />
        )}
      </Field>

      <div className="rounded-[var(--radius-card)] bg-bg-sunken p-4 text-sm leading-relaxed text-fg-muted">
        <p className="font-medium text-fg">{t("What happens next")}</p>
        <ol className="mt-2 list-decimal space-y-1 ps-5">
          <li>{t("The money freezes immediately. Neither side can move it.")}</li>
          <li>{t("The other party has 3 days to respond. They see everything you write here.")}</li>
          <li>
            {t("Our team reviews both sides and decides: full refund, partial refund, or release to the seller.")}
          </li>
          <li>
            {t("Whoever is found at fault takes a trust penalty. Deliberately false claims are grounds for account closure.")}
          </li>
        </ol>
        <p className="mt-3">
          {t("You have {count} days after completion to open a dispute.", { count: disputeWindowDays })}
        </p>
      </div>

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => router.back()}>
          {t("Go back")}
        </Button>
        <Button
          type="submit"
          loading={submitting}
          loadingText={t("Opening…")}
          disabled={details.trim().length < 40}
        >
          {t("Open dispute")}
        </Button>
      </div>
    </form>
  );
}
