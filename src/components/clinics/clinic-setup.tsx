"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Clock, UserPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Badge, Alert } from "@/components/ui/primitives";
import { Field, Input, Textarea, Select, Checkbox } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { SERVICE_CATEGORY, SERVICE_CATEGORY_LABEL, SPECIES, SPECIES_LABEL, type ServiceCategory, type Species } from "@/lib/constants";
import { useI18n } from "@/components/i18n/i18n-provider";
import { RichText } from "@/components/i18n/rich-text";

export interface ExistingService {
  id: string;
  name: string;
  category: string;
  durationMinutes: number;
  priceCents: number;
  currency: string;
  isActive: boolean;
  vetName: string | null;
}

export interface ExistingVet {
  id: string;
  name: string;
  licenseNumber: string | null;
  specialties: string[];
}

export interface HoursRow {
  weekday: number;
  startMinute: number;
  endMinute: number;
  slotMinutes: number;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function toTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function toMinutes(value: string): number {
  const [h, m] = value.split(":");
  return Number(h ?? 0) * 60 + Number(m ?? 0);
}

/**
 * Clinic setup.
 *
 * Services, hours and vets, each writing through the same API a clinic admin
 * would use. Hours are sent as a whole week rather than row by row, because
 * that is what `set-hours` accepts — it replaces the schedule atomically, so
 * a half-applied week is not a state the calendar can end up in.
 */
export function ClinicSetup({
  clinicId,
  services,
  vets,
  hours,
  canManage,
}: {
  clinicId: string;
  services: ExistingService[];
  vets: ExistingVet[];
  hours: HoursRow[];
  canManage: boolean;
}) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  // ---- Service form -------------------------------------------------------
  const [service, setService] = useState({
    name: "",
    category: "CONSULTATION",
    durationMinutes: "30",
    price: "",
    species: [] as string[],
    description: "",
  });

  // ---- Hours --------------------------------------------------------------
  const [week, setWeek] = useState<HoursRow[]>(
    WEEKDAYS.map((_, weekday) => {
      const existing = hours.find((h) => h.weekday === weekday);
      return (
        existing ?? { weekday, startMinute: 0, endMinute: 0, slotMinutes: 30 }
      );
    }),
  );

  // ---- Vet ----------------------------------------------------------------
  const [vetHandle, setVetHandle] = useState("");
  const [vetLicense, setVetLicense] = useState("");
  const [vetLookup, setVetLookup] = useState<{ id: string; name: string } | null>(null);
  const [vetError, setVetError] = useState<string | null>(null);

  async function post(key: string, body: unknown, title: string, description?: string) {
    setBusy(key);
    try {
      await api.post("/api/clinics", body);
      toast.success(title, description);
      router.refresh();
      return true;
    } catch (err) {
      toast.error(
        t("That did not go through"),
        err instanceof ApiError ? err.message : "Please try again.",
      );
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function findVet() {
    setVetError(null);
    setVetLookup(null);
    try {
      const result = await api.get<{ user: { id: string; name: string } | null }>(
        `/api/users/lookup?handle=${encodeURIComponent(vetHandle.trim().toLowerCase())}`,
      );
      if (!result.user) {
        setVetError("No member with that handle. They need a PetMate account first.");
        return;
      }
      setVetLookup(result.user);
    } catch (err) {
      setVetError(err instanceof ApiError ? err.message : "Could not look that up.");
    }
  }

  if (!canManage) {
    return (
      <Alert tone="info">
        <p>
          {t("Services, hours and vets are managed by the clinic owner. You have access to the calendar and to the records of animals this clinic has treated.")}
        </p>
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      {/* ---- Services ------------------------------------------------- */}
      <Card>
        <CardHeader
          title={t("Services")}
          description={t("What can be booked, how long it takes and what it costs. The price here is the price charged — a client never states an amount.")}
        />
        <div className="p-5">
          {services.length > 0 && (
            <ul className="mb-5 divide-y divide-[var(--border)]">
              {services.map((s) => (
                <li key={s.id} className="flex items-baseline justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-fg">
                      {s.name}
                      {!s.isActive && (
                        <Badge tone="neutral" size="sm" className="ms-2">
                          {t("inactive")}
                        </Badge>
                      )}
                    </span>
                    <span className="block text-xs text-fg-subtle">
                      {t(SERVICE_CATEGORY_LABEL[s.category as ServiceCategory] ?? s.category)} · {t("{count} min", { count: s.durationMinutes })}
                      {s.vetName ? ` · ${s.vetName}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular text-fg">
                    {fmt.money(s.priceCents, s.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await post(
                "service",
                {
                  action: "add-service",
                  clinicId,
                  service: {
                    name: service.name,
                    category: service.category,
                    durationMinutes: Number(service.durationMinutes),
                    priceCents: Math.round(Number(service.price) * 100),
                    species: service.species.length ? service.species : undefined,
                    description: service.description || undefined,
                    isActive: true,
                  },
                },
                "Service added",
                "It is bookable straight away.",
              );
              if (ok) {
                setService({
                  name: "",
                  category: "CONSULTATION",
                  durationMinutes: "30",
                  price: "",
                  species: [],
                  description: "",
                });
              }
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("Name")} required>
                {({ id, invalid }) => (
                  <Input
                    id={id}
                    invalid={invalid}
                    required
                    maxLength={120}
                    value={service.name}
                    onChange={(e) => setService((s) => ({ ...s, name: e.target.value }))}
                    placeholder={t("Annual health check")}
                  />
                )}
              </Field>

              <Field label={t("Category")} required>
                {({ id }) => (
                  <Select
                    id={id}
                    value={service.category}
                    onChange={(e) => setService((s) => ({ ...s, category: e.target.value }))}
                  >
                    {SERVICE_CATEGORY.map((c) => (
                      <option key={c} value={c}>
                        {c.charAt(0) + c.slice(1).toLowerCase()}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label={t("Duration (minutes)")} required>
                {({ id, invalid }) => (
                  <Input
                    id={id}
                    invalid={invalid}
                    type="number"
                    min={5}
                    max={480}
                    step={5}
                    required
                    value={service.durationMinutes}
                    onChange={(e) =>
                      setService((s) => ({ ...s, durationMinutes: e.target.value }))
                    }
                    className="tabular"
                  />
                )}
              </Field>

              <Field label={t("Price")} required>
                {({ id, invalid }) => (
                  <Input
                    id={id}
                    invalid={invalid}
                    type="number"
                    min={0}
                    step="0.01"
                    required
                    value={service.price}
                    onChange={(e) => setService((s) => ({ ...s, price: e.target.value }))}
                    className="tabular"
                    placeholder="45.00"
                  />
                )}
              </Field>
            </div>

            <fieldset>
              <legend className="text-sm font-medium text-fg">{t("Species")}</legend>
              <p className="mt-0.5 text-xs text-fg-muted">
                {t("Leave all unticked to offer it for every species.")}
              </p>
              <div className="mt-2 flex flex-wrap gap-3">
                {SPECIES.map((s) => (
                  <Checkbox
                    key={s}
                    label={t(SPECIES_LABEL[s as Species])}
                    checked={service.species.includes(s)}
                    onChange={(e) =>
                      setService((prev) => ({
                        ...prev,
                        species: e.target.checked
                          ? [...prev.species, s]
                          : prev.species.filter((x) => x !== s),
                      }))
                    }
                  />
                ))}
              </div>
            </fieldset>

            <Field label={t("Description")}>
              {({ id, invalid }) => (
                <Textarea
                  id={id}
                  invalid={invalid}
                  rows={2}
                  maxLength={1000}
                  value={service.description}
                  onChange={(e) => setService((s) => ({ ...s, description: e.target.value }))}
                  placeholder={t("Full physical, weight check and vaccination review.")}
                />
              )}
            </Field>

            <Button
              type="submit"
              loading={busy === "service"}
              loadingText={t("Adding…")}
              disabled={!service.name || !service.price}
            >
              <Plus className="size-4" aria-hidden />
              {t("Add service")}
            </Button>
          </form>
        </div>
      </Card>

      {/* ---- Hours ---------------------------------------------------- */}
      <Card>
        <CardHeader
          title={t("Opening hours")}
          description={t("Saved as a whole week. A day with both times at 00:00 is closed.")}
        />
        <div className="p-5">
          <ul className="space-y-2">
            {week.map((row, index) => {
              const closed = row.startMinute === 0 && row.endMinute === 0;
              return (
                <li
                  key={row.weekday}
                  className="grid grid-cols-[92px_1fr_1fr_84px] items-center gap-3"
                >
                  <span className="text-sm text-fg">{t(WEEKDAYS[row.weekday] ?? "")}</span>

                  <input
                    type="time"
                    aria-label={t("{value} opening time", { value: t(WEEKDAYS[row.weekday] ?? "") })}
                    value={toTime(row.startMinute)}
                    onChange={(e) =>
                      setWeek((w) =>
                        w.map((r, i) =>
                          i === index ? { ...r, startMinute: toMinutes(e.target.value) } : r,
                        ),
                      )
                    }
                    className="h-10 rounded-[var(--radius-field)] border border-[var(--border)] bg-bg-elevated px-2.5 text-sm text-fg tabular"
                  />
                  <input
                    type="time"
                    aria-label={t("{value} closing time", { value: t(WEEKDAYS[row.weekday] ?? "") })}
                    value={toTime(row.endMinute)}
                    onChange={(e) =>
                      setWeek((w) =>
                        w.map((r, i) =>
                          i === index ? { ...r, endMinute: toMinutes(e.target.value) } : r,
                        ),
                      )
                    }
                    className="h-10 rounded-[var(--radius-field)] border border-[var(--border)] bg-bg-elevated px-2.5 text-sm text-fg tabular"
                  />

                  {closed ? (
                    <span className="text-xs text-fg-subtle">{t("Closed")}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        setWeek((w) =>
                          w.map((r, i) =>
                            i === index ? { ...r, startMinute: 0, endMinute: 0 } : r,
                          ),
                        )
                      }
                      className="flex items-center gap-1 text-xs text-fg-subtle hover:text-fg"
                    >
                      <Trash2 className="size-3" aria-hidden />
                      {t("Close")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="mt-4 flex items-end gap-3">
            <div className="w-40">
              <Field label={t("Slot length")} hint={t("Minutes per bookable slot.")}>
                {({ id }) => (
                  <Select
                    id={id}
                    value={String(week[0]?.slotMinutes ?? 30)}
                    onChange={(e) =>
                      setWeek((w) =>
                        w.map((r) => ({ ...r, slotMinutes: Number(e.target.value) })),
                      )
                    }
                  >
                    {[15, 20, 30, 45, 60].map((n) => (
                      <option key={n} value={n}>
                        {t.plural(n, { one: "{count} minute", other: "{count} minutes" })}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>

            <Button
              loading={busy === "hours"}
              loadingText={t("Saving…")}
              onClick={() =>
                post(
                  "hours",
                  {
                    action: "set-hours",
                    clinicId,
                    hours: {
                      // Closed days are simply omitted, which is what the
                      // availability engine reads as "not open".
                      entries: week
                        .filter((r) => r.endMinute > r.startMinute)
                        .map((r) => ({
                          weekday: r.weekday,
                          startMinute: r.startMinute,
                          endMinute: r.endMinute,
                          slotMinutes: r.slotMinutes,
                        })),
                    },
                  },
                  "Hours saved",
                  "The booking calendar has been rebuilt.",
                )
              }
            >
              <Clock className="size-4" aria-hidden />
              {t("Save the week")}
            </Button>
          </div>
        </div>
      </Card>

      {/* ---- Vets ------------------------------------------------------ */}
      <Card>
        <CardHeader
          title={t("Vets")}
          description={t("Each vet gets their own calendar, and anything they record carries the clinic-verified badge.")}
        />
        <div className="p-5">
          {vets.length > 0 && (
            <ul className="mb-5 divide-y divide-[var(--border)]">
              {vets.map((v) => (
                <li key={v.id} className="py-2.5">
                  <p className="text-sm font-medium text-fg">{v.name}</p>
                  <p className="text-xs text-fg-subtle">
                    {v.licenseNumber ? t("Licence {number}", { number: v.licenseNumber }) : t("No licence recorded")}
                    {v.specialties.length ? ` · ${v.specialties.join(", ")}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-4">
            {vetError && <Alert tone="danger">{vetError}</Alert>}

            <div className="flex items-end gap-3">
              <div className="flex-1">
                <Field
                  label={t("Their PetMate handle")}
                  hint={t("They need an account first — we add them to the clinic, we do not create accounts for people.")}
                >
                  {({ id, invalid }) => (
                    <Input
                      id={id}
                      invalid={invalid}
                      value={vetHandle}
                      onChange={(e) => {
                        setVetHandle(e.target.value);
                        setVetLookup(null);
                      }}
                      placeholder={t("dr-amani")}
                    />
                  )}
                </Field>
              </div>
              <Button variant="outline" onClick={findVet} disabled={vetHandle.trim().length < 2}>
                {t("Find")}
              </Button>
            </div>

            {vetLookup && (
              <div className="rounded-[var(--radius-card)] bg-bg-sunken p-4">
                <p className="text-sm text-fg">
                  <RichText
                    text={t("Found {name}. Adding them grants access to this clinic’s calendar and to the records of animals it has treated.")}
                    values={{ name: <span className="font-semibold">{vetLookup.name}</span> }}
                  />
                </p>

                <div className="mt-3">
                  <Field label={t("Veterinary licence number")}>
                    {({ id, invalid }) => (
                      <Input
                        id={id}
                        invalid={invalid}
                        maxLength={60}
                        value={vetLicense}
                        onChange={(e) => setVetLicense(e.target.value)}
                      />
                    )}
                  </Field>
                </div>

                <Button
                  className="mt-3"
                  loading={busy === "vet"}
                  loadingText={t("Adding…")}
                  onClick={async () => {
                    const ok = await post(
                      "vet",
                      {
                        action: "add-vet",
                        clinicId,
                        userId: vetLookup.id,
                        licenseNumber: vetLicense || undefined,
                      },
                      "Vet added",
                    );
                    if (ok) {
                      setVetLookup(null);
                      setVetHandle("");
                      setVetLicense("");
                    }
                  }}
                >
                  <UserPlus className="size-4" aria-hidden />
                  {t("Add {name}", { name: vetLookup.name })}
                </Button>
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
