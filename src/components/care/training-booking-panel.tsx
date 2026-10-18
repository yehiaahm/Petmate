"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, Loader2, Info, Truck } from "lucide-react";
import { Card, Alert } from "@/components/ui/primitives";
import { Button, ButtonLink } from "@/components/ui/button";
import { Checkbox, Field, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ResendVerification } from "@/components/auth/resend-verification";
import { api, ApiError } from "@/lib/api-client";
import { uuid } from "@/lib/api-idempotency";
import { formatMoney } from "@/lib/money";
import { formatInZone } from "@/lib/care/format";
import { cn } from "@/lib/utils";
import { LocationPin, type Coords } from "./location-pin";
import { QuoteSummary, useCareQuote } from "./care-quote";

interface Program {
  id: string;
  name: string;
  priceCents: number;
  format: string;
  sessionsCount: number;
  sessionMinutes: number;
}

interface Slot {
  startAt: string;
  sessions: { startAt: string; endAt: string }[];
}

/**
 * Training booking.
 *
 * The customer picks a first session; the rest follow at the same time on the
 * programme's interval. Only starts from which the *whole* programme fits are
 * offered, so a booked course never has a week that cannot happen.
 */
export function TrainingBookingPanel({
  providerId,
  providerName,
  slug,
  currency,
  timezone,
  programs,
  pets,
  signedIn,
  emailVerified,
  offersTransport,
  transportRadiusKm,
  initialProgramId,
}: {
  providerId: string;
  providerName: string;
  slug: string;
  currency: string;
  timezone: string;
  programs: Program[];
  pets: { id: string; name: string }[];
  signedIn: boolean;
  emailVerified: boolean;
  offersTransport: boolean;
  transportRadiusKm: number;
  initialProgramId?: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [programId, setProgramId] = useState(initialProgramId ?? programs[0]?.id ?? "");
  const [petId, setPetId] = useState(pets[0]?.id ?? "");
  const [slots, setSlots] = useState<{ programId: string; items: Slot[] } | null>(null);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [roundTrip, setRoundTrip] = useState(false);
  const [address, setAddress] = useState("");
  const [coords, setCoords] = useState<Coords | null>(null);
  const [careInstructions, setCareInstructions] = useState("");
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped when a slot is lost to someone else, to re-read the diary.
  const [refresh, setRefresh] = useState(0);

  const program = programs.find((p) => p.id === programId);
  const inHome = program?.format === "IN_HOME";
  const needsAddress = inHome || roundTrip;
  const loadingSlots = Boolean(programId) && slots?.programId !== programId;

  // A slot belongs to the programme it was offered for.
  const [slotsFor, setSlotsFor] = useState(programId);
  if (programId !== slotsFor) {
    setSlotsFor(programId);
    setSelected(null);
    setRoundTrip(false);
  }

  useEffect(() => {
    if (!programId) return;
    let cancelled = false;
    api
      .get<{ slots: Slot[] }>(`/api/care?mode=training-slots&providerId=${providerId}&programId=${programId}&days=28`)
      .then((r) => {
        if (!cancelled) setSlots({ programId, items: r.slots ?? [] });
      })
      .catch(() => {
        if (!cancelled) setSlots({ programId, items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [providerId, programId, refresh]);

  const byDay = (slots?.items ?? []).reduce<Record<string, Slot[]>>((acc, slot) => {
    const key = new Date(slot.startAt).toLocaleDateString("en-CA", { timeZone: timezone });
    (acc[key] ??= []).push(slot);
    return acc;
  }, {});
  const days = Object.entries(byDay).slice(0, 10);

  const payload = useMemo(() => {
    if (!program || !petId || !selected) return null;
    if (needsAddress && (!coords || address.trim().length < 5)) return null;
    return {
      kind: "TRAINING",
      providerId,
      programId: program.id,
      petId,
      startAt: selected.startAt,
      roundTrip: !inHome && roundTrip,
      ...(needsAddress ? { address: address.trim(), lat: coords!.lat, lng: coords!.lng } : {}),
    };
  }, [program, petId, selected, needsAddress, coords, address, providerId, inHome, roundTrip]);

  const { quote, loading: quoting, error: quoteError } = useCareQuote(payload, signedIn && emailVerified && pets.length > 0);

  async function book() {
    if (!payload) return;
    setBooking(true);
    setError(null);
    try {
      const result = await api.post<{ payment: { id: string; redirectUrl: string | null } }>("/api/care/bookings", {
        action: "book",
        booking: { ...payload, ...(careInstructions.trim() ? { careInstructions: careInstructions.trim() } : {}) },
        idempotencyKey: uuid(),
      });
      toast.success("Sessions held for 30 minutes", "Complete payment to confirm the programme.");
      router.push(result.payment.redirectUrl ?? `/checkout/${result.payment.id}`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "We could not book that programme.";
      setError(message);
      setBooking(false);
      if (/no longer available|just been taken|a moment ago/i.test(message)) {
        setSelected(null);
        setRefresh((n) => n + 1);
      }
    }
  }

  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-fg">
        <GraduationCap className="size-4 text-brand" aria-hidden />
        Book a programme
      </h2>

      <div className="mt-4 space-y-4">
        <Field label="Programme" required>
          {({ id }) => (
            <Select id={id} value={programId} onChange={(e) => setProgramId(e.target.value)}>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {formatMoney(p.priceCents, currency)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {program && (
          <p className="-mt-2 text-xs text-fg-subtle">
            {program.sessionsCount} sessions of {program.sessionMinutes} minutes ·{" "}
            {inHome ? "the trainer comes to you" : "at the training centre"}
          </p>
        )}

        {signedIn && pets.length > 0 && (
          <Field label="Which dog?" required>
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
          <p className="mb-1 text-sm font-medium text-fg">First session</p>
          <p className="mb-2 text-xs text-fg-subtle">
            The rest follow at the same time each week. Times in {timezone.replace(/_/g, " ")}.
          </p>
          {loadingSlots ? (
            <div className="flex items-center gap-2 py-6 text-sm text-fg-muted">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Checking the trainers&apos; diary…
            </div>
          ) : days.length === 0 ? (
            <Alert tone="warning">No start in the next four weeks fits the whole programme. Message the school.</Alert>
          ) : (
            <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
              {days.map(([dayKey, daySlots]) => (
                <div key={dayKey}>
                  <p className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                    {new Date(`${dayKey}T00:00:00Z`).toLocaleDateString("en-US", {
                      weekday: "long",
                      month: "short",
                      day: "numeric",
                      timeZone: "UTC",
                    })}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {daySlots.slice(0, 10).map((slot) => {
                      const active = selected?.startAt === slot.startAt;
                      return (
                        <button
                          key={slot.startAt}
                          type="button"
                          onClick={() => setSelected(slot)}
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
                            timeZone: timezone,
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

        {selected && (
          <div className="rounded-[var(--radius-field)] border border-[var(--border)] p-3 text-xs text-fg-muted">
            <p className="mb-1 font-semibold text-fg">Your sessions</p>
            <ol className="space-y-0.5">
              {selected.sessions.map((s, i) => (
                <li key={s.startAt} className="tabular">
                  {i + 1}. {formatInZone(s.startAt, timezone)}
                </li>
              ))}
            </ol>
          </div>
        )}

        {selected && !inHome && offersTransport && (
          <Checkbox
            label={
              <span className="inline-flex items-center gap-1.5">
                <Truck className="size-3.5 text-brand" aria-hidden />
                Pickup and drop-off for every session
              </span>
            }
            hint={`Within ${transportRadiusKm} km of ${providerName}.`}
            checked={roundTrip}
            onChange={(e) => setRoundTrip(e.target.checked)}
          />
        )}

        {selected && needsAddress && (
          <LocationPin
            address={address}
            onAddressChange={setAddress}
            coords={coords}
            onCoordsChange={setCoords}
            label={inHome ? "Where the sessions happen" : "Your address"}
            hint={`The trainer covers up to ${transportRadiusKm} km. Pin your location so the distance can be checked.`}
          />
        )}

        {selected && signedIn && pets.length > 0 && (
          <Field label="About your dog" hint="What you want to work on, triggers, anything the trainer should know.">
            {({ id }) => (
              <Textarea
                id={id}
                rows={3}
                maxLength={2000}
                value={careInstructions}
                onChange={(e) => setCareInstructions(e.target.value)}
                placeholder="Pulls hard on the lead and barks at bicycles."
              />
            )}
          </Field>
        )}

        <QuoteSummary quote={quote} loading={quoting} />
        {(quoteError || error) && <Alert tone="danger">{error ?? quoteError}</Alert>}

        {!signedIn ? (
          <ButtonLink href={`/login?next=/care/${slug}`} fullWidth size="lg">
            Sign in to book
          </ButtonLink>
        ) : pets.length === 0 ? (
          <div className="space-y-2">
            <Alert tone="info">Add your dog&apos;s profile first — progress notes attach to it.</Alert>
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
            loadingText="Holding your sessions…"
            disabled={!quote || !payload}
          >
            {quote
              ? `Book and pay ${formatMoney(quote.totalCents, quote.currency)}`
              : !selected
                ? "Pick a first session"
                : needsAddress && !coords
                  ? "Pin your location"
                  : "Book"}
          </Button>
        )}

        <ul className="space-y-1.5 border-t border-[var(--border)] pt-3 text-xs text-fg-muted">
          <li className="flex items-start gap-1.5">
            <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
            The trainer writes notes after every session, so you can practise the same things at home.
          </li>
        </ul>
      </div>
    </Card>
  );
}
