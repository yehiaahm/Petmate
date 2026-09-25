"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarDays, Phone, Globe, Loader2, Info } from "lucide-react";
import { Card, Alert } from "@/components/ui/primitives";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { goToPayment } from "@/lib/payment-redirect";
import { api, ApiError } from "@/lib/api-client";
import { uuid } from "@/lib/api-idempotency";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n/i18n-provider";
import { intlLocale } from "@/lib/i18n/config";

interface Service {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
  durationMinutes: number;
  category: string;
}

interface Slot {
  startAt: string;
  endAt: string;
  vetId: string;
  vetName: string;
}

/**
 * Booking.
 *
 * Slots come from the clinic's actual calendar, computed server-side from
 * recurring hours minus exceptions minus existing appointments. Nothing here
 * invents availability, which is why a booking either succeeds or fails with a
 * real reason rather than "the clinic will confirm".
 */
export function BookingPanel({
  clinicId,
  clinicName,
  services,
  pets,
  signedIn,
  emailVerified,
  cancellationHours,
  bookingLeadHours,
  phone,
  website,
}: {
  clinicId: string;
  clinicName: string;
  services: Service[];
  pets: { id: string; name: string; species: string }[];
  signedIn: boolean;
  emailVerified: boolean;
  cancellationHours: number;
  bookingLeadHours: number;
  phone: string | null;
  website: string | null;
}) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const toast = useToast();

  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [petId, setPetId] = useState(pets[0]?.id ?? "");
  const [reason, setReason] = useState("");
  // The slots are stored with the service they belong to, so "still loading"
  // is a comparison rather than a separate flag an effect has to keep in sync.
  const [slots, setSlots] = useState<{ serviceId: string; items: Slot[] } | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const service = services.find((s) => s.id === serviceId);

  const loadingSlots = Boolean(serviceId) && slots?.serviceId !== serviceId;

  // Picking a different service clears the slot chosen for the previous one,
  // during render, so a slot from the old service is never briefly shown as
  // selected against the new one's calendar.
  const [slotsFor, setSlotsFor] = useState(serviceId);
  if (serviceId !== slotsFor) {
    setSlotsFor(serviceId);
    setSelectedSlot(null);
  }

  useEffect(() => {
    if (!serviceId) return;

    let cancelled = false;

    api
      .get<{ slots: Slot[] }>(
        `/api/appointments?mode=availability&clinicId=${clinicId}&serviceId=${serviceId}&days=14`,
      )
      .then((result) => {
        if (!cancelled) setSlots({ serviceId, items: result.slots ?? [] });
      })
      .catch(() => {
        // An empty calendar and a failed request look the same to the picker,
        // which is honest: either way there is nothing bookable to show.
        if (!cancelled) setSlots({ serviceId, items: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [clinicId, serviceId]);

  // Group by day so the picker reads like a diary, not a list of timestamps.
  const byDay = (slots?.items ?? []).reduce<Record<string, Slot[]>>((acc, slot) => {
    const key = new Date(slot.startAt).toISOString().slice(0, 10);
    (acc[key] ??= []).push(slot);
    return acc;
  }, {});

  const days = Object.entries(byDay).slice(0, 7);

  async function book() {
    if (!selectedSlot || !service || !petId) return;

    setBooking(true);
    setError(null);

    try {
      const result = await api.post<{
        appointment: { id: string };
        payment: { id: string; redirectUrl: string | null };
      }>("/api/appointments", {
        action: "book",
        booking: {
          clinicId,
          serviceId,
          petId,
          vetId: selectedSlot.vetId,
          startAt: selectedSlot.startAt,
          reasonForVisit: reason.trim() || undefined,
        },
        idempotencyKey: uuid(),
      });

      toast.success(t("Slot held"), t("Complete payment to confirm the appointment."));

      if (result.payment.redirectUrl) {
        goToPayment(result.payment.redirectUrl, router.push);
      } else {
        router.push(`/checkout/${result.payment.id}`);
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "We could not book that slot.";
      setError(message);

      // Someone else took the slot: refresh availability so the user is not
      // staring at a time that no longer exists.
      if (/no longer available|just booked/i.test(message)) {
        setSelectedSlot(null);
        const refreshed = await api
          .get<{ slots: Slot[] }>(
            `/api/appointments?mode=availability&clinicId=${clinicId}&serviceId=${serviceId}&days=14`,
          )
          .catch(() => null);
        if (refreshed) setSlots({ serviceId, items: refreshed.slots ?? [] });
      }

      setBooking(false);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-fg">
        <CalendarDays className="size-4 text-brand" aria-hidden />
        {t("Book an appointment")}
      </h2>

      {services.length === 0 ? (
        <div className="mt-4 space-y-3">
          <Alert tone="info">
            {t("This clinic has not published bookable services yet.")}
          </Alert>
          {phone && (
            <a
              href={`tel:${phone}`}
              className="flex items-center justify-center gap-2 rounded-[var(--radius-field)] border border-[var(--border-strong)] px-4 py-2.5 text-sm font-semibold text-fg hover:bg-bg-sunken"
            >
              <Phone className="size-4" aria-hidden />
              {phone}
            </a>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <Field label={t("Service")} required>
            {({ id }) => (
              <Select id={id} value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {fmt.money(s.priceCents, s.currency)}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {signedIn && pets.length > 0 && (
            <Field label={t("Which pet?")} required>
              {({ id }) => (
                <Select id={id} value={petId} onChange={(e) => setPetId(e.target.value)}>
                  {pets.map((pet) => (
                    <option key={pet.id} value={pet.id}>
                      {pet.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}

          <div>
            <p className="mb-2 text-sm font-medium text-fg">{t("Available times")}</p>

            {loadingSlots ? (
              <div className="flex items-center gap-2 py-6 text-sm text-fg-muted">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {t("Checking the calendar…")}
              </div>
            ) : days.length === 0 ? (
              <Alert tone="warning">
                {t("No free slots in the next two weeks for this service. Try another service, or contact the clinic directly.")}
              </Alert>
            ) : (
              <div className="max-h-72 space-y-3 overflow-y-auto pe-1">
                {days.map(([day, daySlots]) => (
                  <div key={day}>
                    <p className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                      {new Date(day).toLocaleDateString("en-US", {
                        weekday: "long",
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {daySlots.slice(0, 12).map((slot) => {
                        const active = selectedSlot?.startAt === slot.startAt;
                        return (
                          <button
                            key={`${slot.startAt}-${slot.vetId}`}
                            type="button"
                            onClick={() => setSelectedSlot(slot)}
                            aria-pressed={active}
                            className={cn(
                              "rounded-[var(--radius-field)] border px-2.5 py-1.5 text-xs font-medium tabular transition-colors",
                              active
                                ? "border-transparent bg-brand text-brand-fg"
                                : "border-[var(--border-strong)] text-fg-muted hover:border-brand hover:text-fg",
                            )}
                          >
                            {new Date(slot.startAt).toLocaleTimeString("en-US", {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {selectedSlot && (
            <>
              <Field label={t("Reason for the visit")} hint={t("Optional, but it helps the vet prepare.")}>
                {({ id }) => (
                  <Textarea
                    id={id}
                    rows={2}
                    maxLength={1000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t("Limping on her back left leg since Tuesday.")}
                  />
                )}
              </Field>

              <div className="rounded-[var(--radius-field)] bg-bg-sunken p-3 text-sm">
                <div className="flex items-baseline justify-between">
                  <span className="text-fg-muted">{service?.name}</span>
                  <span className="font-display text-lg font-semibold tabular text-fg">
                    {service && fmt.money(service.priceCents, service.currency)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-fg-muted">
                  {t("{when} with {vet}", {
                    when: new Date(selectedSlot.startAt).toLocaleString(intlLocale(fmt.locale), {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    }),
                    vet: selectedSlot.vetName,
                  })}
                </p>
              </div>
            </>
          )}

          {error && <Alert tone="danger">{error}</Alert>}

          {!signedIn ? (
            <ButtonLink href="/login?next=/clinics" fullWidth size="lg">
              {t("Sign in to book")}
            </ButtonLink>
          ) : pets.length === 0 ? (
            <div className="space-y-2">
              <Alert tone="info">
                {t("Add a pet profile first — the appointment and its results attach to it.")}
              </Alert>
              <ButtonLink href="/dashboard/pets/new" fullWidth>
                {t("Add a pet")}
              </ButtonLink>
            </div>
          ) : !emailVerified ? (
            <Alert tone="warning">
              {t("Confirm your email address before booking.")}{" "}
              <Link href="/settings" className="font-semibold underline">
                {t("Resend the link")}
              </Link>
            </Alert>
          ) : (
            <Button
              fullWidth
              size="lg"
              onClick={() => void book()}
              loading={booking}
              loadingText={t("Holding your slot…")}
              disabled={!selectedSlot || !petId}
            >
              {selectedSlot ? t("Book and pay") : t("Pick a time")}
            </Button>
          )}

          <ul className="space-y-1.5 border-t border-[var(--border)] pt-3 text-xs text-fg-muted">
            <li className="flex items-start gap-1.5">
              <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
              {t("Free cancellation up to {count} hours before.", { count: cancellationHours })}
            </li>
            <li className="flex items-start gap-1.5">
              <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
              {t("{clinic} needs {count} hours notice.", { clinic: clinicName, count: bookingLeadHours })}
            </li>
            <li className="flex items-start gap-1.5">
              <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
              {t("Anything the vet records goes into your pet’s health timeline as a verified entry.")}
            </li>
          </ul>
        </div>
      )}

      {(phone || website) && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--border)] pt-4">
          {phone && (
            <a
              href={`tel:${phone}`}
              className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
            >
              <Phone className="size-3.5" aria-hidden />
              {phone}
            </a>
          )}
          {website && (
            <a
              href={website}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
            >
              <Globe className="size-3.5" aria-hidden />
              {t("Website")}
            </a>
          )}
        </div>
      )}
    </Card>
  );
}
