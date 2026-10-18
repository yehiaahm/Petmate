"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BedDouble, GraduationCap, Clock, Users, Plus, Pencil, Trash2, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { Avatar, Badge, Card, CardHeader } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { formatMoney, parseMoneyToCents } from "@/lib/money";
import { splitTags } from "@/lib/utils";
import { WEEKDAYS, minutesToTimeInput, timeInputToMinutes } from "@/lib/care/format";
import {
  SPECIES,
  SPECIES_PLURAL,
  TRAINING_FORMAT,
  TRAINING_FORMAT_LABEL,
  TRAINING_LEVEL,
  TRAINING_LEVEL_LABEL,
  type TrainingFormat,
  type TrainingLevel,
} from "@/lib/constants";

export interface SetupUnit {
  id: string;
  name: string;
  description: string | null;
  species: string | null;
  maxWeightKg: number | null;
  nightlyCents: number;
  capacity: number;
  amenities: string | null;
  photoUrl: string | null;
  isActive: boolean;
}

export interface SetupProgram {
  id: string;
  name: string;
  description: string | null;
  level: string;
  format: string;
  species: string;
  sessionsCount: number;
  sessionMinutes: number;
  sessionIntervalDays: number;
  priceCents: number;
  minAgeMonths: number | null;
  outcomes: string | null;
  isActive: boolean;
}

const centsToInput = (cents: number) => (cents / 100).toFixed(2).replace(/\.00$/, "");

function useSave() {
  const router = useRouter();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  async function save(body: Record<string, unknown>, success: string) {
    setSaving(true);
    try {
      await api.post("/api/care", body);
      toast.success(success);
      router.refresh();
      return true;
    } catch (err) {
      toast.error("Not saved", err instanceof ApiError ? err.message : "Please try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }
  return { save, saving };
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

function UnitEditor({ providerId, unit, currency, onDone }: { providerId: string; unit: SetupUnit | null; currency: string; onDone: () => void }) {
  const { save, saving } = useSave();
  const toast = useToast();
  const [name, setName] = useState(unit?.name ?? "");
  const [description, setDescription] = useState(unit?.description ?? "");
  const [species, setSpecies] = useState<string[]>(splitTags(unit?.species));
  const [maxWeight, setMaxWeight] = useState(unit?.maxWeightKg != null ? String(unit.maxWeightKg) : "");
  const [price, setPrice] = useState(unit ? centsToInput(unit.nightlyCents) : "");
  const [capacity, setCapacity] = useState(String(unit?.capacity ?? 1));
  const [amenities, setAmenities] = useState(unit?.amenities ?? "");
  const [isActive, setIsActive] = useState(unit?.isActive ?? true);
  const [photoFileId, setPhotoFileId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("purpose", "CARE_PHOTO");
      const { file: stored } = await api.upload<{ file: { id: string } }>("/api/uploads", form);
      setPhotoFileId(stored.id);
      toast.info("Photo ready", "Save the room to apply it.");
    } catch (err) {
      toast.error("That image was not accepted", err instanceof ApiError ? err.message : "Try another file.");
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    const nightlyCents = parseMoneyToCents(price);
    if (nightlyCents == null || nightlyCents <= 0) {
      toast.error("Set a nightly price");
      return;
    }
    const ok = await save(
      {
        action: "save-unit",
        providerId,
        unit: {
          ...(unit ? { id: unit.id } : {}),
          name,
          description: description || undefined,
          species: species.length ? species : undefined,
          maxWeightKg: maxWeight ? Number(maxWeight) : undefined,
          nightlyCents,
          capacity: Number(capacity) || 1,
          amenities: amenities ? amenities.split(",").map((a) => a.trim()).filter(Boolean) : undefined,
          isActive,
          ...(photoFileId ? { photoFileId } : {}),
        },
      },
      unit ? "Room updated" : "Room added",
    );
    if (ok) onDone();
  }

  return (
    <div className="space-y-4 rounded-[var(--radius-field)] border border-[var(--border)] bg-bg-sunken/40 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Room name" required>
          {({ id }) => <Input id={id} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Deluxe suite" />}
        </Field>
        <Field label={`Price per night (${currency})`} required>
          {({ id }) => <Input id={id} inputMode="decimal" className="tabular" value={price} onChange={(e) => setPrice(e.target.value)} />}
        </Field>
        <Field label="How many of these rooms" hint="Identical rooms of this type.">
          {({ id }) => <Input id={id} type="number" min={1} max={200} className="tabular" value={capacity} onChange={(e) => setCapacity(e.target.value)} />}
        </Field>
        <Field label="Weight limit (kg)" hint="Leave empty for no limit.">
          {({ id }) => <Input id={id} inputMode="decimal" className="tabular" value={maxWeight} onChange={(e) => setMaxWeight(e.target.value)} />}
        </Field>
      </div>
      <Field label="Description">
        {({ id }) => <Textarea id={id} rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />}
      </Field>
      <Field label="In the room" hint="Comma-separated, e.g. Orthopaedic bed, Webcam, Private yard.">
        {({ id }) => <Input id={id} value={amenities} onChange={(e) => setAmenities(e.target.value)} />}
      </Field>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-fg">For</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {SPECIES.map((s) => (
            <Checkbox
              key={s}
              label={SPECIES_PLURAL[s]}
              checked={species.includes(s)}
              onChange={(e) => setSpecies(e.target.checked ? [...species, s] : species.filter((x) => x !== s))}
            />
          ))}
        </div>
        <p className="mt-1 text-xs text-fg-subtle">Tick none to accept every animal.</p>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-fg-muted hover:text-fg">
          <ImagePlus className="size-4" aria-hidden />
          {uploading ? "Uploading…" : photoFileId ? "Photo ready" : unit?.photoUrl ? "Replace photo" : "Add a photo"}
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        </label>
        <Switch label="Bookable" checked={isActive} onChange={setIsActive} />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void submit()} loading={saving} disabled={!name || !price || uploading}>
          {unit ? "Save room" : "Add room"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function RoomsSection({ providerId, units, currency, canEdit }: { providerId: string; units: SetupUnit[]; currency: string; canEdit: boolean }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><BedDouble className="size-4 text-brand" aria-hidden />Rooms</span>}
        description="Each room type is priced per night. Capacity is enforced by the booking system — it cannot be oversold."
        action={canEdit && editing === null ? <Button size="sm" variant="outline" onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden />Add</Button> : undefined}
      />
      <div className="space-y-3 p-5">
        {editing === "new" && <UnitEditor providerId={providerId} unit={null} currency={currency} onDone={() => setEditing(null)} />}
        {units.length === 0 && editing !== "new" && <p className="text-sm text-fg-muted">No rooms yet. Add one so owners can book.</p>}
        {units.map((unit) =>
          editing === unit.id ? (
            <UnitEditor key={unit.id} providerId={providerId} unit={unit} currency={currency} onDone={() => setEditing(null)} />
          ) : (
            <div key={unit.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-field)] border border-[var(--border)] p-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-fg">
                  {unit.name} {!unit.isActive && <Badge size="sm">Hidden</Badge>}
                </p>
                <p className="text-xs text-fg-muted tabular">
                  {formatMoney(unit.nightlyCents, currency)}/night · {unit.capacity} {unit.capacity === 1 ? "room" : "rooms"}
                  {unit.maxWeightKg != null && ` · up to ${unit.maxWeightKg} kg`}
                </p>
              </div>
              {canEdit && (
                <Button size="sm" variant="ghost" onClick={() => setEditing(unit.id)}>
                  <Pencil className="size-4" aria-hidden />Edit
                </Button>
              )}
            </div>
          ),
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Programmes
// ---------------------------------------------------------------------------

function ProgramEditor({ providerId, program, currency, onDone }: { providerId: string; program: SetupProgram | null; currency: string; onDone: () => void }) {
  const { save, saving } = useSave();
  const toast = useToast();
  const [name, setName] = useState(program?.name ?? "");
  const [description, setDescription] = useState(program?.description ?? "");
  const [level, setLevel] = useState<TrainingLevel>((program?.level as TrainingLevel) ?? "FOUNDATION");
  const [format, setFormat] = useState<TrainingFormat>((program?.format as TrainingFormat) ?? "AT_FACILITY");
  const [sessions, setSessions] = useState(String(program?.sessionsCount ?? 6));
  const [minutes, setMinutes] = useState(String(program?.sessionMinutes ?? 60));
  const [intervalDays, setIntervalDays] = useState(String(program?.sessionIntervalDays ?? 7));
  const [price, setPrice] = useState(program ? centsToInput(program.priceCents) : "");
  const [minAge, setMinAge] = useState(program?.minAgeMonths != null ? String(program.minAgeMonths) : "");
  const [outcomes, setOutcomes] = useState(splitTags(program?.outcomes).join("\n"));
  const [isActive, setIsActive] = useState(program?.isActive ?? true);

  async function submit() {
    const priceCents = parseMoneyToCents(price);
    if (priceCents == null || priceCents <= 0) {
      toast.error("Set a price for the programme");
      return;
    }
    const ok = await save(
      {
        action: "save-program",
        providerId,
        program: {
          ...(program ? { id: program.id } : {}),
          name,
          description: description || undefined,
          level,
          format,
          species: ["DOG"],
          sessionsCount: Number(sessions) || 1,
          sessionMinutes: Number(minutes) || 60,
          sessionIntervalDays: Number(intervalDays) || 7,
          priceCents,
          minAgeMonths: minAge ? Number(minAge) : undefined,
          outcomes: outcomes.split("\n").map((o) => o.trim()).filter(Boolean).map((o) => o.replace(/,/g, " ")),
          isActive,
        },
      },
      program ? "Programme updated" : "Programme added",
    );
    if (ok) onDone();
  }

  return (
    <div className="space-y-4 rounded-[var(--radius-field)] border border-[var(--border)] bg-bg-sunken/40 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Programme name" required>
          {({ id }) => <Input id={id} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="Six-week obedience" />}
        </Field>
        <Field label={`Price for the whole programme (${currency})`} required>
          {({ id }) => <Input id={id} inputMode="decimal" className="tabular" value={price} onChange={(e) => setPrice(e.target.value)} />}
        </Field>
        <Field label="Level">
          {({ id }) => (
            <Select id={id} value={level} onChange={(e) => setLevel(e.target.value as TrainingLevel)}>
              {TRAINING_LEVEL.map((l) => <option key={l} value={l}>{TRAINING_LEVEL_LABEL[l]}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Where">
          {({ id }) => (
            <Select id={id} value={format} onChange={(e) => setFormat(e.target.value as TrainingFormat)}>
              {TRAINING_FORMAT.map((f) => <option key={f} value={f}>{TRAINING_FORMAT_LABEL[f]}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Sessions">
          {({ id }) => <Input id={id} type="number" min={1} max={30} className="tabular" value={sessions} onChange={(e) => setSessions(e.target.value)} />}
        </Field>
        <Field label="Minutes per session">
          {({ id }) => <Input id={id} type="number" min={15} max={240} step={15} className="tabular" value={minutes} onChange={(e) => setMinutes(e.target.value)} />}
        </Field>
        <Field label="Days between sessions">
          {({ id }) => <Input id={id} type="number" min={1} max={14} className="tabular" value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} />}
        </Field>
        <Field label="Minimum age (months)">
          {({ id }) => <Input id={id} type="number" min={0} max={240} className="tabular" value={minAge} onChange={(e) => setMinAge(e.target.value)} />}
        </Field>
      </div>
      <Field label="Description">
        {({ id }) => <Textarea id={id} rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />}
      </Field>
      <Field label="What the dog will learn" hint="One per line.">
        {({ id }) => <Textarea id={id} rows={3} value={outcomes} onChange={(e) => setOutcomes(e.target.value)} placeholder={"Loose-lead walking\nReliable recall\nSit, down and stay"} />}
      </Field>
      <Switch label="Bookable" checked={isActive} onChange={setIsActive} />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void submit()} loading={saving} disabled={!name || !price}>
          {program ? "Save programme" : "Add programme"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}

function ProgramsSection({ providerId, programs, currency, canEdit }: { providerId: string; programs: SetupProgram[]; currency: string; canEdit: boolean }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><GraduationCap className="size-4 text-brand" aria-hidden />Training programmes</span>}
        description="Priced per programme. Booked customers keep the price and schedule they agreed to."
        action={canEdit && editing === null ? <Button size="sm" variant="outline" onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden />Add</Button> : undefined}
      />
      <div className="space-y-3 p-5">
        {editing === "new" && <ProgramEditor providerId={providerId} program={null} currency={currency} onDone={() => setEditing(null)} />}
        {programs.length === 0 && editing !== "new" && <p className="text-sm text-fg-muted">No programmes yet.</p>}
        {programs.map((p) =>
          editing === p.id ? (
            <ProgramEditor key={p.id} providerId={providerId} program={p} currency={currency} onDone={() => setEditing(null)} />
          ) : (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-field)] border border-[var(--border)] p-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-fg">
                  {p.name} {!p.isActive && <Badge size="sm">Hidden</Badge>}
                </p>
                <p className="text-xs text-fg-muted tabular">
                  {formatMoney(p.priceCents, currency)} · {p.sessionsCount} × {p.sessionMinutes} min · {TRAINING_FORMAT_LABEL[p.format as TrainingFormat]}
                </p>
              </div>
              {canEdit && (
                <Button size="sm" variant="ghost" onClick={() => setEditing(p.id)}>
                  <Pencil className="size-4" aria-hidden />Edit
                </Button>
              )}
            </div>
          ),
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Hours
// ---------------------------------------------------------------------------

function HoursSection({ providerId, hours, canEdit }: { providerId: string; hours: { weekday: number; startMinute: number; endMinute: number; slotMinutes: number }[]; canEdit: boolean }) {
  const { save, saving } = useSave();
  const [rows, setRows] = useState(() =>
    WEEKDAYS.map((_, weekday) => {
      const h = hours.find((x) => x.weekday === weekday);
      return { weekday, open: Boolean(h), start: h?.startMinute ?? 540, end: h?.endMinute ?? 1020, slot: h?.slotMinutes ?? 60 };
    }),
  );

  const update = (weekday: number, patch: Partial<(typeof rows)[number]>) =>
    setRows((prev) => prev.map((r) => (r.weekday === weekday ? { ...r, ...patch } : r)));

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Clock className="size-4 text-brand" aria-hidden />Training hours</span>}
        description="Sessions are offered inside these hours, in steps of the slot length. Existing bookings are not moved."
      />
      <div className="divide-y divide-[var(--border)]">
        {rows.map((r) => (
          <div key={r.weekday} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <div className="w-32">
              <Checkbox label={WEEKDAYS[r.weekday]!} checked={r.open} disabled={!canEdit} onChange={(e) => update(r.weekday, { open: e.target.checked })} />
            </div>
            {r.open ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Input aria-label={`${WEEKDAYS[r.weekday]} opens`} type="time" className="h-9 w-28" disabled={!canEdit} value={minutesToTimeInput(r.start)} onChange={(e) => update(r.weekday, { start: timeInputToMinutes(e.target.value) ?? r.start })} />
                <span className="text-fg-subtle">to</span>
                <Input aria-label={`${WEEKDAYS[r.weekday]} closes`} type="time" className="h-9 w-28" disabled={!canEdit} value={minutesToTimeInput(r.end)} onChange={(e) => update(r.weekday, { end: timeInputToMinutes(e.target.value) ?? r.end })} />
                <Select aria-label="Slot length" className="h-9 w-28" disabled={!canEdit} value={String(r.slot)} onChange={(e) => update(r.weekday, { slot: Number(e.target.value) })}>
                  {[30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} min</option>)}
                </Select>
              </div>
            ) : (
              <span className="text-sm text-fg-subtle">Closed</span>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="flex justify-end border-t border-[var(--border)] p-4">
          <Button
            size="sm"
            loading={saving}
            onClick={() =>
              void save(
                {
                  action: "set-hours",
                  providerId,
                  hours: {
                    entries: rows.filter((r) => r.open).map((r) => ({ weekday: r.weekday, startMinute: r.start, endMinute: r.end, slotMinutes: r.slot })),
                  },
                },
                "Hours saved",
              )
            }
          >
            Save hours
          </Button>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

function TeamSection({
  providerId,
  members,
  ownerUserId,
  canManage,
}: {
  providerId: string;
  members: { role: string; user: { id: string; name: string; email: string; avatarUrl: string | null } }[];
  ownerUserId: string;
  canManage: boolean;
}) {
  const { save, saving } = useSave();
  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState<"STAFF" | "MANAGER">("STAFF");

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Users className="size-4 text-brand" aria-hidden />Team</span>}
        description="Staff run the day: check-ins, updates, pickups. Managers also edit rooms, programmes and prices. Only the owner handles money."
      />
      <ul className="divide-y divide-[var(--border)]">
        {members.map((m) => (
          <li key={m.user.id} className="flex items-center justify-between gap-3 px-5 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar src={m.user.avatarUrl} name={m.user.name} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-fg">{m.user.name}</p>
                <p className="truncate text-xs text-fg-muted">{m.user.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge size="sm" tone={m.role === "OWNER" ? "brand" : "neutral"}>{m.role.toLowerCase()}</Badge>
              {canManage && m.user.id !== ownerUserId && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove ${m.user.name}`}
                  onClick={() => void save({ action: "remove-member", providerId, userId: m.user.id }, "Removed from the team")}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {canManage && (
        <form
          className="flex flex-wrap items-end gap-3 border-t border-[var(--border)] p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await save({ action: "add-member", providerId, member: { identifier, role } }, "Added to the team")) setIdentifier("");
          }}
        >
          <Field label="Email or @handle" className="min-w-56 flex-1">
            {({ id }) => <Input id={id} value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="driver@example.com" />}
          </Field>
          <Field label="Role">
            {({ id }) => (
              <Select id={id} value={role} onChange={(e) => setRole(e.target.value as "STAFF" | "MANAGER")}>
                <option value="STAFF">Staff</option>
                <option value="MANAGER">Manager</option>
              </Select>
            )}
          </Field>
          <Button type="submit" loading={saving} disabled={identifier.trim().length < 2}>Add</Button>
        </form>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------

export function ProviderSetup({
  providerId,
  role,
  offersBoarding,
  offersTraining,
  currency,
  units,
  programs,
  hours,
  members,
  ownerUserId,
}: {
  providerId: string;
  role: "STAFF" | "MANAGER" | "OWNER";
  offersBoarding: boolean;
  offersTraining: boolean;
  currency: string;
  units: SetupUnit[];
  programs: SetupProgram[];
  hours: { weekday: number; startMinute: number; endMinute: number; slotMinutes: number }[];
  members: { role: string; user: { id: string; name: string; email: string; avatarUrl: string | null } }[];
  ownerUserId: string;
}) {
  const canEdit = role !== "STAFF";
  return (
    <div className="space-y-5">
      {offersBoarding && <RoomsSection providerId={providerId} units={units} currency={currency} canEdit={canEdit} />}
      {offersTraining && <ProgramsSection providerId={providerId} programs={programs} currency={currency} canEdit={canEdit} />}
      {offersTraining && <HoursSection providerId={providerId} hours={hours} canEdit={canEdit} />}
      <TeamSection providerId={providerId} members={members} ownerUserId={ownerUserId} canManage={role === "OWNER"} />
      {!canEdit && (
        <p className="text-xs text-fg-subtle">You are on the team as staff. A manager or the owner changes rooms, programmes and prices.</p>
      )}
    </div>
  );
}
