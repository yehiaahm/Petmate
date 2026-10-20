"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Truck, Copy, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert, Badge } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/components/i18n/i18n-provider";
import { api, ApiError } from "@/lib/api-client";

/**
 * Connecting the shop's own Bosta account. After that, every new order is
 * booked with Bosta automatically and Bosta pays cash-on-delivery money to the
 * shop; PetMate charges its commission against the shop balance as usual.
 */
export function CourierSettings({
  shopId,
  provider,
  webhookUrl,
  webhookSecret: initialSecret,
}: {
  shopId: string;
  provider: string;
  webhookUrl: string;
  webhookSecret: string | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [apiKey, setApiKey] = useState("");
  const [secret, setSecret] = useState(initialSecret);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = provider === "BOSTA";

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ webhookSecret: string }>("/api/store", { action: "connect-bosta", shopId, apiKey });
      setSecret(result.webhookSecret);
      setApiKey("");
      toast.success(t("Bosta connected"));
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await api.post("/api/store", { action: "disconnect-bosta", shopId });
      setSecret(null);
      router.refresh();
    } catch (err) {
      toast.error(t("That did not work"), err instanceof ApiError ? err.message : t("Please try again."));
    } finally {
      setBusy(false);
    }
  }

  const copy = (value: string) => void navigator.clipboard.writeText(value).then(() => toast.success(t("Copied")));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Truck className="size-4 text-fg-subtle" aria-hidden />
        <span className="text-sm font-medium text-fg">{t("Bosta")}</span>
        <Badge tone={connected ? "success" : "neutral"} size="sm">
          {connected ? t("Connected") : t("Not connected")}
        </Badge>
      </div>
      <p className="text-sm text-fg-muted">
        {connected
          ? t("New orders are booked with Bosta automatically, and Bosta's updates move each parcel here. Bosta pays cash-on-delivery money to your Bosta account.")
          : t("Connect your own Bosta account to have every order booked with Bosta automatically. Until then you deliver and update parcels yourself.")}
      </p>

      {error && <Alert tone="danger">{error}</Alert>}

      {connected && secret && (
        <Alert tone="info" title={t("One more step in Bosta")}>
          <p>{t("In your Bosta dashboard, open Settings → Webhooks and add this address, with the secret as the Authorization header:")}</p>
          <div className="mt-3 space-y-2">
            {[webhookUrl, secret].map((value) => (
              <div key={value} className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-bg-sunken px-2 py-1 text-xs" dir="ltr">
                  {value}
                </code>
                <Button size="sm" variant="ghost" onClick={() => copy(value)} aria-label={t("Copy")}>
                  <Copy className="size-4" aria-hidden />
                </Button>
              </div>
            ))}
          </div>
        </Alert>
      )}

      {connected ? (
        <Button variant="ghost" size="sm" loading={busy} onClick={() => void disconnect()}>
          <Unplug className="size-4" aria-hidden />
          {t("Disconnect Bosta")}
        </Button>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <Field label={t("Bosta API key")} hint={t("Bosta dashboard → Settings → API integration.")}>
            {({ id }) => (
              <Input id={id} type="password" autoComplete="off" dir="ltr" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="sm:w-96" />
            )}
          </Field>
          {/* Lined up with the input, not with the hint below it. */}
          <Button className="sm:mt-7" loading={busy} disabled={apiKey.trim().length < 20} onClick={() => void connect()}>
            {t("Connect")}
          </Button>
        </div>
      )}
    </div>
  );
}
