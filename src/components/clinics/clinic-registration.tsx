"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, Checkbox } from "@/components/ui/field";
import { Alert, Card, CardHeader } from "@/components/ui/primitives";
import { api, ApiError } from "@/lib/api-client";
import { useI18n } from "@/components/i18n/i18n-provider";

export function ClinicRegistration({
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
    website: "",
    addressLine: "",
    city: defaultCity ?? "",
    region: "",
    country: defaultCountry ?? "",
    postalCode: "",
    licenseNumber: "",
    emergencyServices: false,
    homeVisits: false,
    acceptsWalkIns: false,
    bookingLeadHours: "2",
    cancellationHours: "24",
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const fieldError = (name: string) =>
    error instanceof ApiError ? error.fieldError(name) : undefined;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.post<{ clinic: { id: string } }>("/api/clinics", {
        action: "create",
        clinic: {
          name: values.name,
          description: values.description || undefined,
          email: values.email,
          phone: values.phone || undefined,
          website: values.website || undefined,
          addressLine: values.addressLine,
          city: values.city,
          region: values.region || undefined,
          country: values.country,
          postalCode: values.postalCode || undefined,
          licenseNumber: values.licenseNumber || undefined,
          emergencyServices: values.emergencyServices,
          homeVisits: values.homeVisits,
          acceptsWalkIns: values.acceptsWalkIns,
          bookingLeadHours: Number(values.bookingLeadHours),
          cancellationHours: Number(values.cancellationHours),
        },
      });
      router.push(`/clinic/${result.clinic.id}`);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Could not register the clinic."));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {error && !(error instanceof ApiError && error.isValidation) && (
        <Alert tone="danger">{error.message}</Alert>
      )}

      <Card>
        <CardHeader title={t("The practice")} />
        <div className="space-y-5 p-5">
          <Field label={t("Clinic name")} required error={fieldError("name")}>
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                required
                maxLength={120}
                value={values.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder={t("Maadi Veterinary Centre")}
              />
            )}
          </Field>

          <Field
            label={t("Veterinary registration or licence number")}
            hint={t("We verify this against the register before the clinic goes live.")}
            error={fieldError("licenseNumber")}
          >
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                maxLength={60}
                value={values.licenseNumber}
                onChange={(e) => set("licenseNumber", e.target.value)}
              />
            )}
          </Field>

          <Field
            label={t("About the practice")}
            hint={t("What you do, who your vets are, what you are known for.")}
            error={fieldError("description")}
          >
            {({ id, invalid }) => (
              <Textarea
                id={id}
                invalid={invalid}
                rows={4}
                maxLength={3000}
                value={values.description}
                onChange={(e) => set("description", e.target.value)}
              />
            )}
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title={t("Contact")} description={t("Shown publicly on your clinic page.")} />
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <Field label={t("Email")} required error={fieldError("email")}>
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                type="email"
                required
                value={values.email}
                onChange={(e) => set("email", e.target.value)}
              />
            )}
          </Field>

          <Field label={t("Phone")} error={fieldError("phone")}>
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                type="tel"
                value={values.phone}
                onChange={(e) => set("phone", e.target.value)}
              />
            )}
          </Field>

          <Field label={t("Website")} error={fieldError("website")} className="sm:col-span-2">
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                type="url"
                value={values.website}
                onChange={(e) => set("website", e.target.value)}
                placeholder="https://example.com"
              />
            )}
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={t("Where you are")}
          description={t("Owners search by distance, so this needs to be the address they would actually drive to.")}
        />
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <Field
            label={t("Street address")}
            required
            error={fieldError("addressLine")}
            className="sm:col-span-2"
          >
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                required
                maxLength={200}
                value={values.addressLine}
                onChange={(e) => set("addressLine", e.target.value)}
                autoComplete="street-address"
              />
            )}
          </Field>

          <Field label={t("City")} required error={fieldError("city")}>
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                required
                value={values.city}
                onChange={(e) => set("city", e.target.value)}
                autoComplete="address-level2"
              />
            )}
          </Field>

          <Field label={t("Region or governorate")} error={fieldError("region")}>
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                value={values.region}
                onChange={(e) => set("region", e.target.value)}
                autoComplete="address-level1"
              />
            )}
          </Field>

          <Field label={t("Country")} required error={fieldError("country")}>
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                required
                value={values.country}
                onChange={(e) => set("country", e.target.value)}
                autoComplete="country-name"
              />
            )}
          </Field>

          <Field label={t("Postcode")} error={fieldError("postalCode")}>
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                value={values.postalCode}
                onChange={(e) => set("postalCode", e.target.value)}
                autoComplete="postal-code"
              />
            )}
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title={t("How you work")} />
        <div className="space-y-5 p-5">
          <div className="space-y-3">
            <Checkbox
              label={t("Emergency services")}
              hint={t("You take urgent cases outside normal appointments.")}
              checked={values.emergencyServices}
              onChange={(e) => set("emergencyServices", e.target.checked)}
            />
            <Checkbox
              label={t("Home visits")}
              checked={values.homeVisits}
              onChange={(e) => set("homeVisits", e.target.checked)}
            />
            <Checkbox
              label={t("Walk-ins accepted")}
              checked={values.acceptsWalkIns}
              onChange={(e) => set("acceptsWalkIns", e.target.checked)}
            />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label={t("Booking lead time (hours)")}
              hint={t("How far ahead a slot must be booked.")}
              error={fieldError("bookingLeadHours")}
            >
              {({ id, invalid }) => (
                <Input
                  id={id}
                  invalid={invalid}
                  type="number"
                  min={0}
                  max={168}
                  value={values.bookingLeadHours}
                  onChange={(e) => set("bookingLeadHours", e.target.value)}
                  className="tabular"
                />
              )}
            </Field>

            <Field
              label={t("Free cancellation window (hours)")}
              hint={t("Cancelling inside this window may incur a fee.")}
              error={fieldError("cancellationHours")}
            >
              {({ id, invalid }) => (
                <Input
                  id={id}
                  invalid={invalid}
                  type="number"
                  min={0}
                  max={168}
                  value={values.cancellationHours}
                  onChange={(e) => set("cancellationHours", e.target.value)}
                  className="tabular"
                />
              )}
            </Field>
          </div>
        </div>
      </Card>

      <Alert tone="info">
        <p>
          {t("Weekday hours of 9am–5pm are created for you so the calendar is never empty. You can change them, add services and add vets as soon as the clinic exists — you do not have to wait for verification to do the setup.")}
        </p>
      </Alert>

      <div className="flex justify-end">
        <Button
          type="submit"
          size="lg"
          loading={submitting}
          loadingText={t("Registering…")}
          disabled={!values.name || !values.addressLine || !values.city || !values.country}
        >
          {t("Register the clinic")}
        </Button>
      </div>
    </form>
  );
}
