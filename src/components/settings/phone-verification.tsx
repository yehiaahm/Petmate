"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, MessageCircle, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, SegmentedControl } from "@/components/ui/field";
import { Alert, Badge } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/components/i18n/i18n-provider";
import { api, ApiError } from "@/lib/api-client";
import { formatPhone } from "@/lib/phone";
import { toWesternDigits } from "@/lib/digits";

type Channel = "WHATSAPP" | "SMS";

/** Western and Arabic-Indic digits: `\d` alone misses ٠١٢, which is how many people type. */
const DIGIT = /[0-9\u0660-\u0669\u06F0-\u06F9]/g;

/**
 * Adding or changing the mobile number, proved with a code. The number the
 * person types is only saved once the code comes back, so a typo never
 * becomes the number a courier calls.
 */
export function PhoneVerification({
  phone,
  verified,
  channel: initialChannel,
}: {
  phone: string | null;
  verified: boolean;
  channel: Channel;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(!verified);
  const [number, setNumber] = useState(phone && !verified ? phone : "");
  const [channel, setChannel] = useState<Channel>(initialChannel);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call<T>(body: Record<string, unknown>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      return await api.post<T>("/api/account", body);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Please try again."));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const result = await call<{ sentTo: string; channel: Channel }>({ action: "phone-code", phone: number, channel });
    if (!result) return;
    setSentTo(result.sentTo);
    setChannel(result.channel);
  }

  async function confirm() {
    const result = await call({ action: "phone-confirm", code });
    if (!result) return;
    toast.success(t("Mobile number verified"));
    setSentTo(null);
    setCode("");
    setEditing(false);
    router.refresh();
  }

  async function changeChannel(next: Channel) {
    setChannel(next);
    if (verified && !editing) await call({ action: "phone-channel", channel: next });
  }

  const channelControl = (
    <SegmentedControl
      label={t("Send messages by")}
      value={channel}
      onChange={(v) => void changeChannel(v as Channel)}
      options={[
        { value: "WHATSAPP", label: "WhatsApp", icon: <MessageCircle className="size-4" aria-hidden /> },
        { value: "SMS", label: t("SMS"), icon: <Smartphone className="size-4" aria-hidden /> },
      ]}
      className="max-w-xs"
    />
  );

  if (verified && phone && !editing) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium text-fg tabular" dir="ltr">
            {formatPhone(phone)}
          </span>
          <Badge tone="success" size="sm">
            <BadgeCheck className="size-3.5" aria-hidden /> {t("Verified")}
          </Badge>
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            {t("Change number")}
          </Button>
        </div>
        {channelControl}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}
      {!sentTo ? (
        <>
          <Field label={t("Mobile number")} hint={t("Couriers call this number, and cash-on-delivery orders need it.")}>
            {({ id }) => (
              <Input
                id={id}
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                dir="ltr"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="010 1234 5678"
                className="max-w-xs"
              />
            )}
          </Field>
          {channelControl}
          <div className="flex gap-2">
            {verified && (
              <Button variant="ghost" onClick={() => setEditing(false)}>
                {t("Cancel")}
              </Button>
            )}
            <Button loading={busy} disabled={(number.match(DIGIT) ?? []).length < 10} onClick={() => void send()}>
              {t("Send code")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-fg-muted">
            {channel === "WHATSAPP"
              ? t("We sent a six-digit code on WhatsApp to {number}.", { number: sentTo })
              : t("We sent a six-digit code by SMS to {number}.", { number: sentTo })}
          </p>
          <Field label={t("Code")}>
            {({ id }) => (
              <Input
                id={id}
                inputMode="numeric"
                autoComplete="one-time-code"
                dir="ltr"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(toWesternDigits(e.target.value).replace(/\D/g, ""))}
                className="max-w-40 tracking-widest"
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button loading={busy} disabled={code.length !== 6} onClick={() => void confirm()}>
              {t("Verify")}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setSentTo(null)}>
              {t("Use a different number")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
