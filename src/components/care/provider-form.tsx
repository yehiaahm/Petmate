"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, SegmentedControl, Switch, Textarea } from "@/components/ui/field";
import { Alert, Card, CardHeader } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { parseMoneyToCents } from "@/lib/money";
import { minutesToTimeInput, timeInputToMinutes } from "@/lib/care/format";
import {
  BOARDING_AMENITIES,
  CANCELLATION_POLICY,
  CANCELLATION_POLICY_LABEL,
  CANCELLATION_POLICY_SUMMARY,
  CURRENCIES,
} from "@/lib/constants";
import type { ProviderFormValues } from "@/lib/care/provider-form-values";
import { LocationPin } from "./location-pin";

export type { ProviderFormValues } from "@/lib/care/provider-form-values";

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const noSubscription = () => () => {};

/**
 * The browser's time zone, without a hydration mismatch: the server renders
 * "UTC" and the browser swaps in its own zone straight after hydrating.
 */
function useBrowserTimeZone(): string {
  return useSyncExternalStore(noSubscription, browserTimeZone, () => "UTC");
}

/**
 * Registering or editing a pet care business. One form for both, so the
 * rules a business signs up under are exactly the rules it can later change.
 */
export function ProviderForm({
  mode,
  providerId,
  initial,
  canMarkOfficial = false,
}: {
  mode: "create" | "edit";
  providerId?: string;
  initial: ProviderFormValues;
  canMarkOfficial?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  // A new business defaults to the zone of the browser registering it.
  const detectedTimeZone = useBrowserTimeZone();
  const timezone = v.timezone || detectedTimeZone;

  const set = <K extends keyof ProviderFormValues>(key: K, value: ProviderFormValues[K]) =>
    setV((prev) => ({ ...prev, [key]: value }));
  const fieldError = (name: string) => (error instanceof ApiError ? error.fieldError(name) ?? error.fieldError(`provider.${name}`) : undefined);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const provider = {
      name: v.name,
      tagline: v.tagline || undefined,
      description: v.description || undefined,
      email: v.email,
      phone: v.phone || undefined,
      website: v.website || undefined,
      addressLine: v.addressLine,
      city: v.city,
      region: v.region || undefined,
      country: v.country,
      postalCode: v.postalCode || undefined,
      lat: v.coords?.lat,
      lng: v.coords?.lng,
      timezone,
      licenseNumber: v.licenseNumber || undefined,
      offersBoarding: v.offersBoarding,
      offersTraining: v.offersTraining,
      checkInMinute: v.checkInMinute,
      checkOutMinute: v.checkOutMinute,
      offersTransport: v.offersTransport,
      transportRadiusKm: Number(v.transportRadiusKm) || 15,
      transportBaseCents: parseMoneyToCents(v.transportBase || "0") ?? 0,
      transportPerKmCents: parseMoneyToCents(v.transportPerKm || "0") ?? 0,
      trainerCount: Number(v.trainerCount) || 1,
      amenities: v.amenities,
      requiresVaccination: v.requiresVaccination,
      cancellationPolicy: v.cancellationPolicy,
      bookingLeadHours: Number(v.bookingLeadHours) || 0,
      currency: v.currency,
      ...(mode === "create" && canMarkOfficial && v.official ? { official: true } : {}),
    };

    try {
      if (mode === "create") {
        const result = await api.post<{ provider: { id: string } }>("/api/care", { action: "create", provider });
        router.push(`/provider/${result.provider.id}`);
      } else {
        await api.post("/api/care", { action: "update", providerId, provider });
        toast.success("Saved", "Changes are live on your public page.");
        router.refresh();
        setSubmitting(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Could not save."));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {error && (
        <Alert tone="danger">
          {error instanceof ApiError && error.isValidation ? "Please check the highlighted fields." : error.message}
        </Alert>
      )}

      <Card>
        <CardHeader title="What you offer" />
        <div className="space-y-4 p-5">
          <Switch
            label="Pet hotel (boarding)"
            description="Overnight stays in rooms you list, priced per night."
            checked={v.offersBoarding}
            onChange={(next) => set("offersBoarding", next)}
          />
          <Switch
            label="Dog training"
            description="Programmes of sessions, booked into your trainers' weekly hours."
            checked={v.offersTraining}
            onChange={(next) => set("offersTraining", next)}
          />
          {fieldError("offersBoarding") && <p className="text-xs text-[var(--danger)]">{fieldError("offersBoarding")}</p>}
          {canMarkOfficial && mode === "create" && (
            <div className="rounded-[var(--radius-field)] border border-[var(--brand)] p-3">
              <Checkbox
                label="This is PetMate's own operation"
                hint="Goes live immediately with the PetMate Official badge. Every booking is platform revenue; there is no commission and no payout."
                checked={v.official}
                onChange={(e) => set("official", e.target.checked)}
              />
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="The business" />
        <div className="space-y-5 p-5">
          <Field label="Business name" required error={fieldError("name")}>
            {({ id, invalid }) => (
              <Input id={id} invalid={invalid} maxLength={120} value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="Happy Paws Hotel & Academy" />
            )}
          </Field>
          <Field label="Tagline" hint="One line shown in search results." error={fieldError("tagline")}>
            {({ id, invalid }) => (
              <Input id={id} invalid={invalid} maxLength={140} value={v.tagline} onChange={(e) => set("tagline", e.target.value)} placeholder="Climate-controlled suites, 24/7 staff and a garden to run in." />
            )}
          </Field>
          <Field label="About" hint="Your team, your facility, how a typical day goes." error={fieldError("description")}>
            {({ id, invalid }) => (
              <Textarea id={id} invalid={invalid} rows={5} maxLength={4000} value={v.description} onChange={(e) => set("description", e.target.value)} />
            )}
          </Field>
          {!v.official && (
            <Field label="Commercial registration or licence number" hint="We check this before your page goes live." error={fieldError("licenseNumber")}>
              {({ id, invalid }) => (
                <Input id={id} invalid={invalid} maxLength={60} value={v.licenseNumber} onChange={(e) => set("licenseNumber", e.target.value)} />
              )}
            </Field>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Contact and location" description="Owners search by distance, and pickup is priced from here." />
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <Field label="Email" required error={fieldError("email")}>
            {({ id, invalid }) => <Input id={id} invalid={invalid} type="email" value={v.email} onChange={(e) => set("email", e.target.value)} />}
          </Field>
          <Field label="Phone" error={fieldError("phone")}>
            {({ id, invalid }) => <Input id={id} invalid={invalid} type="tel" value={v.phone} onChange={(e) => set("phone", e.target.value)} />}
          </Field>
          <Field label="Website" error={fieldError("website")} className="sm:col-span-2">
            {({ id, invalid }) => <Input id={id} invalid={invalid} type="url" value={v.website} onChange={(e) => set("website", e.target.value)} placeholder="https://example.com" />}
          </Field>
          <div className="sm:col-span-2">
            <LocationPin
              label="Street address"
              hint="Pin the business itself on the map: pickup distances, and so prices, are measured from it."
              address={v.addressLine}
              onAddressChange={(value) => set("addressLine", value)}
              coords={v.coords}
              onCoordsChange={(value) => set("coords", value)}
              error={fieldError("addressLine") ?? fieldError("lat")}
            />
          </div>
          <Field label="City" required error={fieldError("city")}>
            {({ id, invalid }) => <Input id={id} invalid={invalid} value={v.city} onChange={(e) => set("city", e.target.value)} />}
          </Field>
          <Field label="Region or governorate" error={fieldError("region")}>
            {({ id, invalid }) => <Input id={id} invalid={invalid} value={v.region} onChange={(e) => set("region", e.target.value)} />}
          </Field>
          <Field label="Country" required error={fieldError("country")}>
            {({ id, invalid }) => <Input id={id} invalid={invalid} value={v.country} onChange={(e) => set("country", e.target.value)} />}
          </Field>
          <Field label="Time zone" hint="For example Africa/Cairo." error={fieldError("timezone")}>
            {({ id, invalid }) => <Input id={id} invalid={invalid} value={timezone} onChange={(e) => set("timezone", e.target.value)} />}
          </Field>
        </div>
      </Card>

      {v.offersBoarding && (
        <Card>
          <CardHeader title="Hotel" />
          <div className="space-y-5 p-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Check-in from">
                {({ id }) => (
                  <Input id={id} type="time" value={minutesToTimeInput(v.checkInMinute)} onChange={(e) => set("checkInMinute", timeInputToMinutes(e.target.value) ?? v.checkInMinute)} />
                )}
              </Field>
              <Field label="Check-out by" error={fieldError("checkOutMinute")}>
                {({ id }) => (
                  <Input id={id} type="time" value={minutesToTimeInput(v.checkOutMinute)} onChange={(e) => set("checkOutMinute", timeInputToMinutes(e.target.value) ?? v.checkOutMinute)} />
                )}
              </Field>
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-fg">Facilities</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {BOARDING_AMENITIES.map((a) => (
                  <Checkbox
                    key={a}
                    label={a}
                    checked={v.amenities.includes(a)}
                    onChange={(e) =>
                      set("amenities", e.target.checked ? [...v.amenities, a] : v.amenities.filter((x) => x !== a))
                    }
                  />
                ))}
              </div>
            </fieldset>
          </div>
        </Card>
      )}

      {v.offersTraining && (
        <Card>
          <CardHeader title="Training" />
          <div className="p-5">
            <Field label="Trainers on shift at once" hint="How many sessions can run at the same hour." error={fieldError("trainerCount")}>
              {({ id, invalid }) => (
                <Input id={id} invalid={invalid} type="number" min={1} max={50} className="tabular sm:max-w-40" value={v.trainerCount} onChange={(e) => set("trainerCount", e.target.value)} />
              )}
            </Field>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Pickup and drop-off" description="Your own team collects the pet and brings it home, confirmed with the owner's code." />
        <div className="space-y-5 p-5">
          <Switch label="Offer pickup and drop-off" checked={v.offersTransport} onChange={(next) => set("offersTransport", next)} />
          {v.offersTransport && (
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Coverage (km)" error={fieldError("transportRadiusKm")}>
                {({ id, invalid }) => <Input id={id} invalid={invalid} type="number" min={1} max={200} className="tabular" value={v.transportRadiusKm} onChange={(e) => set("transportRadiusKm", e.target.value)} />}
              </Field>
              <Field label={`Base fee per trip (${v.currency})`} error={fieldError("transportBaseCents")}>
                {({ id, invalid }) => <Input id={id} invalid={invalid} inputMode="decimal" className="tabular" value={v.transportBase} onChange={(e) => set("transportBase", e.target.value)} placeholder="50" />}
              </Field>
              <Field label={`Per km (${v.currency})`} error={fieldError("transportPerKmCents")}>
                {({ id, invalid }) => <Input id={id} invalid={invalid} inputMode="decimal" className="tabular" value={v.transportPerKm} onChange={(e) => set("transportPerKm", e.target.value)} placeholder="5" />}
              </Field>
            </div>
          )}
          {v.offersTransport && !v.coords && <Alert tone="warning">Pin your location above — trips are priced by distance from it.</Alert>}
        </div>
      </Card>

      <Card>
        <CardHeader title="Policies" />
        <div className="space-y-5 p-5">
          <div>
            <p className="mb-2 text-sm font-medium text-fg">Cancellation policy</p>
            <SegmentedControl
              label="Cancellation policy"
              value={v.cancellationPolicy}
              onChange={(value) => set("cancellationPolicy", value)}
              options={CANCELLATION_POLICY.map((p) => ({ value: p, label: CANCELLATION_POLICY_LABEL[p] }))}
            />
            <p className="mt-2 text-xs text-fg-muted">{CANCELLATION_POLICY_SUMMARY[v.cancellationPolicy]}</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Booking notice (hours)" error={fieldError("bookingLeadHours")}>
              {({ id, invalid }) => <Input id={id} invalid={invalid} type="number" min={0} max={168} className="tabular" value={v.bookingLeadHours} onChange={(e) => set("bookingLeadHours", e.target.value)} />}
            </Field>
            <Field label="Currency">
              {({ id }) => (
                <Select id={id} value={v.currency} onChange={(e) => set("currency", e.target.value)}>
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Checkbox
            label="Require up-to-date vaccinations"
            hint="The pet's health record must show a vaccination valid for the whole booking. In-home training is exempt."
            checked={v.requiresVaccination}
            onChange={(e) => set("requiresVaccination", e.target.checked)}
          />
        </div>
      </Card>

      {mode === "create" && !v.official && (
        <Alert tone="info">
          A person reviews every new business before it appears in search. You can add rooms, programmes and hours straight
          away, so you are ready to take bookings the moment you are approved.
        </Alert>
      )}

      <div className="flex justify-end">
        <Button
          type="submit"
          size="lg"
          loading={submitting}
          loadingText={mode === "create" ? "Registering…" : "Saving…"}
          disabled={!v.name || !v.addressLine || !v.city || !v.country || (!v.offersBoarding && !v.offersTraining)}
        >
          {mode === "create" ? "Register the business" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
