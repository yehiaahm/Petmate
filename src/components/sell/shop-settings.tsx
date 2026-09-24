"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Switch } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/components/i18n/i18n-provider";
import { api, ApiError } from "@/lib/api-client";
import { parseMoneyToCents } from "@/lib/money";
import { PLATFORM_CURRENCY } from "@/lib/currency";

const toMajor = (cents: number | null) => (cents == null ? "" : (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2));

export function ShopSettings({
  shopId,
  initial,
  codCap,
  codEnabled,
}: {
  shopId: string;
  initial: { acceptsCod: boolean; flatShippingCents: number; freeShippingThresholdCents: number | null };
  /** The platform's cap, formatted, so the seller knows what they are signing up to. */
  codCap: string;
  codEnabled: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [acceptsCod, setAcceptsCod] = useState(initial.acceptsCod);
  const [shipping, setShipping] = useState(toMajor(initial.flatShippingCents));
  const [freeOver, setFreeOver] = useState(toMajor(initial.freeShippingThresholdCents));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const flatShippingCents = parseMoneyToCents(shipping || "0");
    const freeShippingThresholdCents = freeOver ? parseMoneyToCents(freeOver) : null;
    if (flatShippingCents === null || (freeShippingThresholdCents === null && freeOver !== "")) {
      setError(t("Enter shipping amounts as numbers, like 60 or 1500."));
      return;
    }
    setSaving(true);
    try {
      await api.post("/api/store", {
        action: "update-shop",
        shopId,
        shop: {
          acceptsCod,
          flatShippingCents,
          freeShippingThresholdCents,
        },
      });
      toast.success(t("Shop settings saved"));
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Please try again."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {error && <Alert tone="danger">{error}</Alert>}
      <Switch
        checked={acceptsCod}
        onChange={setAcceptsCod}
        disabled={!codEnabled}
        label={t("Accept cash on delivery")}
        description={
          codEnabled
            ? t("Buyers pay your courier in cash, on baskets up to {cap}. Our commission on those orders is taken from your PetMate balance when the parcel is delivered.", { cap: codCap })
            : t("Cash on delivery is switched off for the whole platform right now.")
        }
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t("Flat shipping ({currency})", { currency: PLATFORM_CURRENCY })}>
          {({ id }) => <Input id={id} inputMode="decimal" dir="ltr" className="rtl:text-end" value={shipping} onChange={(e) => setShipping(e.target.value)} />}
        </Field>
        <Field label={t("Free shipping over ({currency})", { currency: PLATFORM_CURRENCY })} hint={t("Leave empty to always charge shipping.")}>
          {({ id }) => <Input id={id} inputMode="decimal" dir="ltr" className="rtl:text-end" value={freeOver} onChange={(e) => setFreeOver(e.target.value)} />}
        </Field>
      </div>
      <div className="flex justify-end">
        <Button onClick={() => void save()} loading={saving} loadingText={t("Saving…")}>
          {t("Save changes")}
        </Button>
      </div>
    </div>
  );
}
