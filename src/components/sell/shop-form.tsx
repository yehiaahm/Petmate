"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Alert, Card, CardHeader } from "@/components/ui/primitives";
import { useI18n } from "@/components/i18n/i18n-provider";
import { api, ApiError } from "@/lib/api-client";
import { parseMoneyToCents } from "@/lib/money";
import { PLATFORM_CURRENCY } from "@/lib/currency";

/**
 * Opening a shop. Shipping is asked for up front because it is the first
 * thing a buyer's basket shows, and a shop that has not thought about it is
 * one that will argue with its first customer about it.
 */
export function ShopForm({
  defaultEmail,
  defaultCity,
  defaultCountry,
}: {
  defaultEmail: string;
  defaultCity: string | null;
  defaultCountry: string | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [values, setValues] = useState({
    name: "",
    description: "",
    email: defaultEmail,
    phone: "",
    city: defaultCity ?? "",
    country: defaultCountry ?? "Egypt",
    shipping: "60",
    freeOver: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) =>
    setValues((v) => ({ ...v, [key]: value }));
  const fieldError = (name: string) => (error instanceof ApiError ? error.fieldError(name) : undefined);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const flatShippingCents = parseMoneyToCents(values.shipping || "0");
    const freeShippingThresholdCents = values.freeOver ? parseMoneyToCents(values.freeOver) : undefined;
    if (flatShippingCents === null || freeShippingThresholdCents === null) {
      setError(new Error(t("Enter shipping amounts as numbers, like 60 or 1500.")));
      return;
    }

    setSubmitting(true);
    try {
      const { shop } = await api.post<{ shop: { id: string } }>("/api/store", {
        action: "create-shop",
        shop: {
          name: values.name,
          description: values.description || undefined,
          email: values.email,
          phone: values.phone || undefined,
          city: values.city || undefined,
          country: values.country,
          flatShippingCents,
          freeShippingThresholdCents,
        },
      });
      router.push(`/sell/shops/${shop.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(t("Could not open the shop.")));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {error && !(error instanceof ApiError && error.isValidation) && <Alert tone="danger">{error.message}</Alert>}

      <Card>
        <CardHeader title={t("The shop")} description={t("Shown to buyers on every product you list.")} />
        <div className="space-y-5 p-5">
          <Field label={t("Shop name")} required error={fieldError("name")}>
            {({ id, invalid }) => (
              <Input id={id} invalid={invalid} required maxLength={120} value={values.name} onChange={(e) => set("name", e.target.value)} />
            )}
          </Field>
          <Field label={t("About the shop")} hint={t("What you sell, and why people buy from you.")} error={fieldError("description")}>
            {({ id, invalid }) => (
              <Textarea id={id} invalid={invalid} rows={4} maxLength={3000} value={values.description} onChange={(e) => set("description", e.target.value)} />
            )}
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title={t("Contact")} description={t("Buyers and our review team use these to reach you.")} />
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <Field label={t("Email")} required error={fieldError("email")}>
            {({ id, invalid }) => (
              <Input id={id} invalid={invalid} type="email" required value={values.email} onChange={(e) => set("email", e.target.value)} autoComplete="email" />
            )}
          </Field>
          <Field label={t("Phone")} error={fieldError("phone")}>
            {({ id, invalid }) => (
              <Input id={id} invalid={invalid} type="tel" dir="ltr" className="rtl:text-end" value={values.phone} onChange={(e) => set("phone", e.target.value)} autoComplete="tel" />
            )}
          </Field>
          <Field label={t("City")} error={fieldError("city")}>
            {({ id, invalid }) => (
              <Input id={id} invalid={invalid} value={values.city} onChange={(e) => set("city", e.target.value)} autoComplete="address-level2" />
            )}
          </Field>
          <Field label={t("Country")} required error={fieldError("country")}>
            {({ id, invalid }) => (
              <Input id={id} invalid={invalid} required value={values.country} onChange={(e) => set("country", e.target.value)} autoComplete="country-name" />
            )}
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title={t("Shipping")} description={t("One flat rate per order, and optionally free shipping above a basket total.")} />
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <Field label={t("Flat shipping ({currency})", { currency: PLATFORM_CURRENCY })} error={fieldError("flatShippingCents")}>
            {({ id, invalid }) => (
              <Input id={id} invalid={invalid} inputMode="decimal" dir="ltr" className="rtl:text-end" value={values.shipping} onChange={(e) => set("shipping", e.target.value)} />
            )}
          </Field>
          <Field
            label={t("Free shipping over ({currency})", { currency: PLATFORM_CURRENCY })}
            hint={t("Leave empty to always charge shipping.")}
            error={fieldError("freeShippingThresholdCents")}
          >
            {({ id, invalid }) => (
              <Input id={id} invalid={invalid} inputMode="decimal" dir="ltr" className="rtl:text-end" value={values.freeOver} onChange={(e) => set("freeOver", e.target.value)} />
            )}
          </Field>
        </div>
      </Card>

      <Alert tone="info">
        {t("New shops are reviewed before they go live, usually within one working day. You can add products as soon as it is approved.")}
      </Alert>

      <div className="flex justify-end">
        <Button type="submit" loading={submitting} loadingText={t("Opening…")}>
          {t("Open the shop")}
        </Button>
      </div>
    </form>
  );
}
