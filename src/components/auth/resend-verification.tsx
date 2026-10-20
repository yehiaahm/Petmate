"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { useI18n } from "@/components/i18n/i18n-provider";

/**
 * Resends the confirmation email for the signed-in account.
 *
 * Requires a session on purpose: a "resend to any address" endpoint is a free
 * way to send mail to strangers from our domain.
 */
export function ResendVerification({
  variant = "primary",
  label,
}: {
  variant?: "primary" | "outline" | "ghost";
  label?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function resend() {
    setSending(true);
    try {
      await api.post("/api/auth", { action: "resend-verification" });
      setSent(true);
      toast.success(t("Confirmation sent"), t("Check your inbox — it may take a minute."));
    } catch (err) {
      if (err instanceof ApiError && err.isAuth) {
        toast.info(t("Sign in first"), t("We need to know which account to confirm."));
        router.push("/login");
        return;
      }
      toast.error(
        t("We could not send that"),
        err instanceof ApiError ? err.message : t("Please try again shortly."),
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <Button
      variant={variant}
      fullWidth
      onClick={() => void resend()}
      loading={sending}
      loadingText={t("Sending…")}
      disabled={sent}
    >
      {sent ? t("Sent — check your inbox") : (label ?? t("Send a new confirmation link"))}
    </Button>
  );
}
