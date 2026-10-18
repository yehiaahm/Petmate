"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BedDouble, Truck, Info } from "lucide-react";
import { Card, Alert } from "@/components/ui/primitives";
import { Button, ButtonLink } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ResendVerification } from "@/components/auth/resend-verification";
import { api, ApiError } from "@/lib/api-client";
import { uuid } from "@/lib/api-idempotency";
import { formatMoney } from "@/lib/money";
import { addDaysToDateString, formatMinutes, localDateString } from "@/lib/care/format";
import { LocationPin, type Coords } from "./location-pin";
import { QuoteSummary, useCareQuote } from "./care-quote";
import { cn } from "@/lib/utils";

interface Unit {
  id: string;
  name: string;
  nightlyCents: number;
}

interface Availability {
  nights: number;
  units: { unitId: string; available: number; serviceCents: number }[];
}

export function BoardingBookingPanel({
  providerId,
  providerName,
  slug,
  currency,
  units,
  pets,
  signedIn,
  emailVerified,
  checkInMinute,
  checkOutMinute,
  offersTransport,
  transportRadiusKm,
  initialUnitId,
}: {
  providerId: string;
  providerName: string;
  slug: string;
  currency: string;
  units: Unit[];
  pets: { id: string; name: string }[];
  signedIn: boolean;
  emailVerified: boolean;
  checkInMinute: number;
  checkOutMinute: number;
  offersTransport: boolean;
  transportRadiusKm: number;
  initialUnitId?: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [unitId, setUnitId] = useState(initialUnitId ?? units[0]?.id ?? "");
  const [petId, setPetId] = useState(pets[0]?.id ?? "");
  const [checkIn, setCheckIn] = useState(() => localDateString(1));
  const [checkOut, setCheckOut] = useState(() => localDateString(4));
  const [pickup, setPickup] = useState(false);
  const [dropoff, setDropoff] = useState(false);
  const [address, setAddress] = useState("");
  const [coords, setCoords] = useState<Coords | null>(null);
  const [contactPhone, setContactPhone] = useState("");
  const [careInstructions, setCareInstructions] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");
  const [availability, setAvailability] = useState<{ key: string; data: Availability } | null>(null);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transport = pickup || dropoff;
  const datesValid = Boolean(checkIn && checkOut && checkOut > checkIn);
  const availabilityKey = `${checkIn}|${checkOut}`;

  useEffect(() => {
    if (!datesValid) return;
    let cancelled = false;
    api
      .get<Availability>(
        `/api/care?mode=boarding-availability&providerId=${providerId}&checkIn=${checkIn}&checkOut=${checkOut}`,
      )
      .then((data) => {
        if (!cancelled) setAvailability({ key: `${checkIn}|${checkOut}`, data });
      })
      .catch(() => {
        if (!cancelled) setAvailability({ key: `${checkIn}|${checkOut}`, data: { nights: 0, units: [] } });
      });
    return () => {
      cancelled = true;
    };
  }, [providerId, checkIn, checkOut, datesValid]);

  const current = availability?.key === availabilityKey ? availability.data : null;
  const roomsLeft = current?.units.find((u) => u.unitId === unitId)?.available ?? null;

  const payload = useMemo(() => {
    if (!datesValid || !unitId || !petId) return null;
    if (transport && (!coords || address.trim().length < 5)) return null;
    return {
      kind: "BOARDING",
      providerId,
      unitId,
      petId,
      checkIn,
      checkOut,
      pickup,
      dropoff,
      ...(transport ? { address: address.trim(), lat: coords!.lat, lng: coords!.lng } : {}),
      ...(contactPhone.trim() ? { contactPhone: contactPhone.trim() } : {}),
      ...(careInstructions.trim() ? { careInstructions: careInstructions.trim() } : {}),
      ...(emergencyContact.trim() ? { emergencyContact: emergencyContact.trim() } : {}),
    };
  }, [providerId, unitId, petId, checkIn, checkOut, pickup, dropoff, transport, address, coords, contactPhone, careInstructions, emergencyContact, datesValid]);

  // Free-text fields do not change the price; leaving them out of the quote
  // key stops a re-price on every keystroke.
  const quoteKey = useMemo(
    () =>
      payload
        ? { ...payload, careInstructions: undefined, emergencyContact: undefined, contactPhone: undefined }
        : null,
    [payload],
  );
  const { quote, loading: quoting, error: quoteError } = useCareQuote(quoteKey, signedIn && emailVerified && pets.length > 0);

  async function book() {
    if (!payload) return;
    setBooking(true);
    setError(null);
    try {
      const result = await api.post<{ booking: { id: string }; payment: { id: string; redirectUrl: string | null } }>(
        "/api/care/bookings",
        { action: "book", booking: payload, idempotencyKey: uuid() },
      );
      toast.success("Room held for 30 minutes", "Complete payment to confirm the stay.");
      router.push(result.payment.redirectUrl ?? `/checkout/${result.payment.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We could not book that stay.");
      setBooking(false);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-fg">
        <BedDouble className="size-4 text-brand" aria-hidden />
        Book a stay
      </h2>

      <div className="mt-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Check-in" required>
            {({ id }) => (
              <Input
                id={id}
                type="date"
                min={localDateString(0)}
                value={checkIn}
                onChange={(e) => {
                  setCheckIn(e.target.value);
                  if (checkOut <= e.target.value) setCheckOut(addDaysToDateString(e.target.value, 1));
                }}
              />
            )}
          </Field>
          <Field label="Check-out" required>
            {({ id }) => (
              <Input
                id={id}
                type="date"
                min={checkIn ? addDaysToDateString(checkIn, 1) : undefined}
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
              />
            )}
          </Field>
        </div>
        <p className="-mt-2 text-xs text-fg-subtle">
          Check-in from {formatMinutes(checkInMinute)}, check-out by {formatMinutes(checkOutMinute)}.
        </p>

        <Field label="Room type" required>
          {({ id }) => (
            <Select id={id} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              {units.map((u) => {
                const left = current?.units.find((a) => a.unitId === u.id)?.available;
                return (
                  <option key={u.id} value={u.id} disabled={left === 0}>
                    {u.name} — {formatMoney(u.nightlyCents, currency)}/night{left === 0 ? " (full)" : ""}
                  </option>
                );
              })}
            </Select>
          )}
        </Field>
        {roomsLeft != null && roomsLeft > 0 && roomsLeft <= 2 && (
          <p className={cn("-mt-2 text-xs font-medium text-[var(--warning)]")}>
            Only {roomsLeft} left for these dates.
          </p>
        )}
        {roomsLeft === 0 && <Alert tone="warning">That room type is full on at least one night. Try other dates.</Alert>}

        {signedIn && pets.length > 0 && (
          <Field label="Which pet?" required>
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

        {offersTransport && (
          <fieldset className="space-y-3 rounded-[var(--radius-field)] border border-[var(--border)] p-3.5">
            <legend className="flex items-center gap-1.5 px-1 text-sm font-semibold text-fg">
              <Truck className="size-4 text-brand" aria-hidden />
              Pickup and drop-off
            </legend>
            <Checkbox
              label="Collect my pet from home"
              hint="On check-in day. The driver confirms the handover with your code."
              checked={pickup}
              onChange={(e) => setPickup(e.target.checked)}
            />
            <Checkbox
              label="Bring my pet home"
              hint="On check-out day."
              checked={dropoff}
              onChange={(e) => setDropoff(e.target.checked)}
            />
            {transport && (
              <LocationPin
                address={address}
                onAddressChange={setAddress}
                coords={coords}
                onCoordsChange={setCoords}
                hint={`${providerName} covers up to ${transportRadiusKm} km. Pin your location to price the trip.`}
              />
            )}
          </fieldset>
        )}

        {signedIn && pets.length > 0 && (
          <details className="group rounded-[var(--radius-field)] border border-[var(--border)] p-3.5">
            <summary className="cursor-pointer text-sm font-semibold text-fg">Care instructions</summary>
            <div className="mt-3 space-y-3">
              <Field label="Feeding, medication, habits" hint="The team reads this before your pet arrives.">
                {({ id }) => (
                  <Textarea
                    id={id}
                    rows={3}
                    maxLength={2000}
                    value={careInstructions}
                    onChange={(e) => setCareInstructions(e.target.value)}
                    placeholder="Two meals a day, 150 g each. Half a tablet of Apoquel with breakfast."
                  />
                )}
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Your phone">
                  {({ id }) => (
                    <Input id={id} type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
                  )}
                </Field>
                <Field label="Emergency contact">
                  {({ id }) => (
                    <Input
                      id={id}
                      maxLength={160}
                      value={emergencyContact}
                      onChange={(e) => setEmergencyContact(e.target.value)}
                      placeholder="Name and phone"
                    />
                  )}
                </Field>
              </div>
            </div>
          </details>
        )}

        <QuoteSummary quote={quote} loading={quoting} />
        {(quoteError || error) && <Alert tone="danger">{error ?? quoteError}</Alert>}

        {!signedIn ? (
          <ButtonLink href={`/login?next=/care/${slug}`} fullWidth size="lg">
            Sign in to book
          </ButtonLink>
        ) : pets.length === 0 ? (
          <div className="space-y-2">
            <Alert tone="info">Add a pet profile first — the stay and its updates attach to it.</Alert>
            <ButtonLink href="/dashboard/pets/new" fullWidth>
              Add a pet
            </ButtonLink>
          </div>
        ) : !emailVerified ? (
          <Alert tone="warning">
            <p>Confirm your email address before booking.</p>
            <div className="mt-2">
              <ResendVerification variant="outline" label="Resend the link" />
            </div>
          </Alert>
        ) : (
          <Button
            fullWidth
            size="lg"
            onClick={() => void book()}
            loading={booking}
            loadingText="Holding your room…"
            disabled={!quote || !payload}
          >
            {quote ? `Book and pay ${formatMoney(quote.totalCents, quote.currency)}` : transport && !coords ? "Pin your location" : "Choose your dates"}
          </Button>
        )}

        <ul className="space-y-1.5 border-t border-[var(--border)] pt-3 text-xs text-fg-muted">
          <li className="flex items-start gap-1.5">
            <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
            Payment is held by PetMate and released to the hotel after the stay.
          </li>
          <li className="flex items-start gap-1.5">
            <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
            You get photo updates from the team while your pet is in their care.
          </li>
        </ul>
      </div>
    </Card>
  );
}
