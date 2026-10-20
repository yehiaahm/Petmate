"use client";

import { useState } from "react";
import { ExternalLink, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/primitives";
import { useI18n } from "@/components/i18n/i18n-provider";
import { api, ApiError } from "@/lib/api-client";
import { goToPayment } from "@/lib/payment-redirect";

/**
 * The two things a payer can do on the checkout page: go (back) to the
 * provider's hosted payment page, or start a fresh attempt after a failure.
 */
export function PaymentActions({ intentId, resumeUrl, canRetry }: { intentId: string; resumeUrl: string | null; canRetry: boolean }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      const { payment } = await api.post<{ payment: { id: string; redirectUrl: string | null } }>("/api/payments", {
        action: "retry",
        paymentIntentId: intentId,
      });
      goToPayment(payment.redirectUrl ?? `/checkout/${payment.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("We could not start that payment. Please try again."));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}
      {resumeUrl && (
        <Button fullWidth onClick={() => goToPayment(resumeUrl)}>
          <ExternalLink className="size-4" aria-hidden />
          {t("Continue to secure payment")}
        </Button>
      )}
      {canRetry && (
        <Button fullWidth onClick={() => void retry()} loading={busy} loadingText={t("Starting…")}>
          <RotateCcw className="size-4" aria-hidden />
          {t("Try again")}
        </Button>
      )}
    </div>
  );
}
