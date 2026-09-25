"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { useI18n } from "@/components/i18n/i18n-provider";

export function WithdrawApplication({ applicationId }: { applicationId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [working, setWorking] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function withdraw() {
    setWorking(true);
    try {
      await api.post("/api/adoption", { action: "withdraw", applicationId });
      toast.success(t("Application withdrawn"), t("The rescue has been told, so they can move on."));
      router.refresh();
    } catch (err) {
      toast.error(
        t("Could not withdraw"),
        err instanceof ApiError ? err.message : "Please try again.",
      );
    } finally {
      setWorking(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        {t("Withdraw")}
      </Button>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <span className="text-sm text-fg-muted">{t("Sure?")}</span>
      <Button variant="danger" size="sm" loading={working} onClick={withdraw}>
        {t("Withdraw")}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        {t("Keep it")}
      </Button>
    </span>
  );
}
