"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Flag } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { REPORT_REASON, REPORT_REASON_LABEL, type ReportReason } from "@/lib/constants";
import { useI18n } from "@/components/i18n/i18n-provider";

/**
 * Reporting.
 *
 * Available on every user-generated surface. The response is deliberately
 * uninformative about what happened next — telling a reporter that a listing
 * was auto-paused also tells a bad actor exactly how many reports it takes.
 */
export function ReportButton({
  entityType,
  entityId,
  label,
}: {
  entityType: "LISTING" | "USER" | "MESSAGE" | "PRODUCT" | "POST" | "COMMENT" | "REVIEW" | "CLINIC";
  entityId: string;
  label?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>("FRAUD");
  const [details, setDetails] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSending(true);
    setError(null);

    try {
      await api.post("/api/safety", {
        action: "report",
        report: { entityType, entityId, reason, details: details.trim() || undefined },
      });

      setOpen(false);
      setDetails("");
      toast.success(t("Report received"), t("Our team will look at this. Thank you."));
    } catch (err) {
      if (err instanceof ApiError && err.isAuth) {
        setOpen(false);
        router.push("/login");
        return;
      }
      setError(err instanceof ApiError ? err.message : t("We could not send that report."));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-sm text-fg-subtle transition-colors hover:text-fg-muted"
      >
        <Flag className="size-3.5" aria-hidden />
        {label ?? t("Report this listing")}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("Report a problem")}
        description={t("Tell us what is wrong. Reports about animal welfare and fraud go to the front of the queue.")}
      >
        <div className="space-y-4">
          <Field label={t("What is the problem?")} required>
            {({ id }) => (
              <Select id={id} value={reason} onChange={(e) => setReason(e.target.value as ReportReason)}>
                {REPORT_REASON.map((value) => (
                  <option key={value} value={value}>
                    {t(REPORT_REASON_LABEL[value])}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label={t("Anything else we should know?")}
            hint={t("Specifics help: what was said, when, and what made you suspicious.")}
            error={error}
            trailing={`${details.length}/2000`}
          >
            {({ id, invalid }) => (
              <Textarea
                id={id}
                invalid={invalid}
                rows={4}
                maxLength={2000}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
              />
            )}
          </Field>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button onClick={() => void submit()} loading={sending} loadingText={t("Sending…")}>
              {t("Send report")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
