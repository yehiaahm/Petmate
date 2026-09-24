"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/components/i18n/i18n-provider";
import { api, ApiError } from "@/lib/api-client";

export function CancelOrder({ orderId, paid }: { orderId: string; paid: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/orders", { action: "cancel-order", orderId, reason });
      toast.success(t("Order cancelled"), paid ? t("Your refund is on its way to the card or wallet you paid with.") : undefined);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {t("Cancel order")}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("Cancel this order?")}
        description={
          paid
            ? t("Nothing has shipped yet, so you get the full amount back to the card or wallet you paid with.")
            : t("Nothing has shipped yet, so nothing is charged.")
        }
        size="sm"
      >
        {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
        <Field label={t("Why are you cancelling?")} required>
          {({ id }) => <Textarea id={id} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t("Keep the order")}
          </Button>
          <Button variant="danger" loading={busy} disabled={reason.trim().length < 5} onClick={() => void submit()}>
            {t("Cancel order")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
