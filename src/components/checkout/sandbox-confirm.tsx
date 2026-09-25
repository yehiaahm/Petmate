"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { useI18n } from "@/components/i18n/i18n-provider";

export function SandboxConfirm({
  providerRef,
  amount,
  returnTo,
}: {
  providerRef: string;
  amount: string;
  returnTo: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();

  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setWorking(true);
    setError(null);

    try {
      await api.post("/api/payments", { action: "confirm-sandbox", providerRef });

      toast.success(t("Payment confirmed"), t("{amount} recorded in the ledger.", { amount }));
      router.push(returnTo);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "We could not confirm that payment.",
      );
      setWorking(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}

      <Button
        fullWidth
        size="lg"
        onClick={() => void confirm()}
        loading={working}
        loadingText={t("Confirming…")}
      >
        {t("Confirm {amount}", { amount })}
      </Button>

      <Button
        fullWidth
        variant="ghost"
        onClick={() => router.back()}
        disabled={working}
      >
        {t("Cancel")}
      </Button>
    </div>
  );
}
