"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Syringe,
  Stethoscope,
  Pill,
  Scissors,
  AlertTriangle,
  Scale,
  FlaskConical,
  StickyNote,
  BadgeCheck,
  CalendarClock,
  Check,
  X,
} from "lucide-react";
import { Card, Badge, EmptyState, Alert } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { HEALTH_RECORD_TYPE, HEALTH_RECORD_LABEL, type HealthRecordType } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n/i18n-provider";

interface HealthRecordEntry {
  id: string;
  type: string;
  title: string;
  description: string | null;
  occurredAt: Date;
  nextDueAt: Date | null;
  source: string;
  verifiedAt: Date | null;
  medication: string | null;
  dosage: string | null;
  batchNumber: string | null;
  resultValue: number | null;
  resultUnit: string | null;
  vaccine: { name: string; code: string; coreVaccine: boolean } | null;
  clinic: { id: string; name: string; slug: string } | null;
}

interface Reminder {
  id: string;
  title: string;
  dueAt: Date;
  status: string;
}

interface Vaccine {
  id: string;
  code: string;
  name: string;
  description: string | null;
  coreVaccine: boolean;
  boosterMonths: number | null;
}

const TYPE_ICON: Record<string, typeof Syringe> = {
  VACCINATION: Syringe,
  CHECKUP: Stethoscope,
  TREATMENT: Pill,
  SURGERY: Scissors,
  MEDICATION: Pill,
  ALLERGY: AlertTriangle,
  WEIGHT: Scale,
  TEST: FlaskConical,
  NOTE: StickyNote,
};

/**
 * The health timeline.
 *
 * Every entry states who wrote it. A clinic-authored record carries a verified
 * mark and cannot be edited by the owner; an owner-authored one says
 * "self-reported" in plain words. That distinction is the whole reason the
 * record is worth anything to a buyer, so it is never softened in the UI.
 */
export function HealthTimeline({
  petId,
  petName,
  records,
  reminders,
  vaccines,
}: {
  petId: string;
  petName: string;
  records: HealthRecordEntry[];
  reminders: Reminder[];
  vaccines: Vaccine[];
}) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const toast = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);

  async function resolveReminder(id: string, action: "complete" | "dismiss") {
    try {
      await api.patch(`/api/pets/${petId}/health`, { reminderId: id, action });
      toast.success(action === "complete" ? "Marked done" : "Reminder dismissed");
      router.refresh();
    } catch (err) {
      toast.error(
        t("Could not update that reminder"),
        err instanceof ApiError ? err.message : "Please try again.",
      );
    }
  }

  return (
    <div className="space-y-8">
      {reminders.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-lg font-semibold text-fg">{t("Reminders")}</h2>
          <Card>
            <ul className="divide-y divide-[var(--border)]">
              {reminders.map((reminder) => {
                const overdue = new Date(reminder.dueAt) < new Date();
                return (
                  <li key={reminder.id} className="flex items-center gap-3 p-4">
                    <span
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-lg",
                        overdue
                          ? "bg-[var(--danger-soft)] text-[var(--danger)]"
                          : "bg-brand-soft text-brand-soft-fg",
                      )}
                    >
                      <CalendarClock className="size-4" aria-hidden />
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">{reminder.title}</p>
                      <p
                        className={cn(
                          "text-xs",
                          overdue ? "text-[var(--danger)]" : "text-fg-muted",
                        )}
                      >
                        {overdue ? t("Overdue since {date}", { date: fmt.date(reminder.dueAt, "long") }) : t("Due {date}", { date: fmt.date(reminder.dueAt, "long") })}
                      </p>
                    </div>

                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => void resolveReminder(reminder.id, "complete")}
                        className="inline-flex size-8 items-center justify-center rounded-[var(--radius-field)] text-fg-muted transition-colors hover:bg-[var(--success-soft)] hover:text-[var(--success)]"
                        aria-label={t("Mark \"{title}\" as done", { title: reminder.title })}
                      >
                        <Check className="size-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => void resolveReminder(reminder.id, "dismiss")}
                        className="inline-flex size-8 items-center justify-center rounded-[var(--radius-field)] text-fg-muted transition-colors hover:bg-bg-sunken hover:text-fg"
                        aria-label={t("Dismiss \"{title}\"", { title: reminder.title })}
                      >
                        <X className="size-4" aria-hidden />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        </section>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-fg">{t("Timeline")}</h2>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setReminderOpen(true)}>
              <CalendarClock className="size-4" aria-hidden />
              {t("Add reminder")}
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="size-4" aria-hidden />
              {t("Add record")}
            </Button>
          </div>
        </div>

        {records.length === 0 ? (
          <EmptyState
            icon={<Syringe className="size-6" aria-hidden />}
            title={t("No records yet")}
            description={t("Add {petName}'s vaccinations, check-ups and treatments. A documented animal is worth more and finds a home faster.", { petName })}
            action={
              <Button onClick={() => setAddOpen(true)}>
                <Plus className="size-4" aria-hidden />
                {t("Add the first record")}
              </Button>
            }
          />
        ) : (
          <ol className="relative space-y-3 border-s border-[var(--border)] ps-6">
            {records.map((record) => {
              const Icon = TYPE_ICON[record.type] ?? StickyNote;
              const clinicVerified = record.source === "CLINIC";

              return (
                <li key={record.id} className="relative">
                  <span
                    className={cn(
                      "absolute -start-[31px] flex size-6 items-center justify-center rounded-full ring-4 ring-[var(--bg)]",
                      clinicVerified
                        ? "bg-[var(--success-soft)] text-[var(--success)]"
                        : "bg-bg-inset text-fg-muted",
                    )}
                    aria-hidden
                  >
                    <Icon className="size-3" />
                  </span>

                  <Card as="article" className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-fg">{record.title}</h3>
                        <p className="mt-0.5 text-xs text-fg-muted">
                          {t(HEALTH_RECORD_LABEL[record.type as HealthRecordType] ?? record.type)} ·{" "}
                          {fmt.date(record.occurredAt, "long")}
                        </p>
                      </div>

                      {clinicVerified ? (
                        <Badge
                          tone="success"
                          size="sm"
                          icon={<BadgeCheck className="size-3" aria-hidden />}
                        >
                          {record.clinic?.name ?? t("Clinic verified")}
                        </Badge>
                      ) : (
                        <Badge tone="neutral" size="sm">
                          {t("Self-reported")}
                        </Badge>
                      )}
                    </div>

                    {record.description && (
                      <p className="mt-2 text-sm leading-relaxed text-fg-muted">
                        {record.description}
                      </p>
                    )}

                    <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-fg-muted">
                      {record.vaccine && (
                        <div className="flex gap-1.5">
                          <dt className="text-fg-subtle">{t("Vaccine")}</dt>
                          <dd>{record.vaccine.name}</dd>
                        </div>
                      )}
                      {record.batchNumber && (
                        <div className="flex gap-1.5">
                          <dt className="text-fg-subtle">{t("Batch")}</dt>
                          <dd className="font-mono">{record.batchNumber}</dd>
                        </div>
                      )}
                      {record.medication && (
                        <div className="flex gap-1.5">
                          <dt className="text-fg-subtle">{t("Medication")}</dt>
                          <dd>
                            {record.medication}
                            {record.dosage ? ` · ${record.dosage}` : ""}
                          </dd>
                        </div>
                      )}
                      {record.resultValue != null && (
                        <div className="flex gap-1.5">
                          <dt className="text-fg-subtle">{t("Result")}</dt>
                          <dd className="tabular">
                            {record.resultValue}
                            {record.resultUnit ? ` ${record.resultUnit}` : ""}
                          </dd>
                        </div>
                      )}
                      {record.nextDueAt && (
                        <div className="flex gap-1.5">
                          <dt className="text-fg-subtle">{t("Next due")}</dt>
                          <dd
                            className={
                              new Date(record.nextDueAt) < new Date()
                                ? "font-semibold text-[var(--danger)]"
                                : undefined
                            }
                          >
                            {fmt.date(record.nextDueAt)}
                          </dd>
                        </div>
                      )}
                    </dl>
                  </Card>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <AddRecordModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        petId={petId}
        petName={petName}
        vaccines={vaccines}
      />

      <AddReminderModal
        open={reminderOpen}
        onClose={() => setReminderOpen(false)}
        petId={petId}
      />
    </div>
  );
}

function AddRecordModal({
  open,
  onClose,
  petId,
  petName,
  vaccines,
}: {
  open: boolean;
  onClose: () => void;
  petId: string;
  petName: string;
  vaccines: Vaccine[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();

  const [type, setType] = useState<HealthRecordType>("VACCINATION");
  const [title, setTitle] = useState("");
  const [vaccineId, setVaccineId] = useState("");
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 10));
  const [nextDueAt, setNextDueAt] = useState("");
  const [description, setDescription] = useState("");
  const [medication, setMedication] = useState("");
  const [dosage, setDosage] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [resultValue, setResultValue] = useState("");
  const [resultUnit, setResultUnit] = useState("kg");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function reset() {
    setTitle("");
    setVaccineId("");
    setDescription("");
    setMedication("");
    setDosage("");
    setBatchNumber("");
    setResultValue("");
    setNextDueAt("");
    setError(null);
    setFieldErrors({});
  }

  async function save() {
    setSaving(true);
    setError(null);
    setFieldErrors({});

    try {
      await api.post(`/api/pets/${petId}/health`, {
        kind: "record",
        record: {
          type,
          title: title.trim() || defaultTitle(),
          description: description.trim() || undefined,
          occurredAt,
          nextDueAt: nextDueAt || undefined,
          vaccineId: type === "VACCINATION" && vaccineId ? vaccineId : undefined,
          batchNumber: batchNumber.trim() || undefined,
          medication: medication.trim() || undefined,
          dosage: dosage.trim() || undefined,
          resultValue: resultValue ? Number(resultValue) : undefined,
          resultUnit: resultValue ? resultUnit : undefined,
        },
      });

      toast.success(t("Record added"), `${petName}'s timeline is up to date.`);
      reset();
      onClose();
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        const map: Record<string, string> = {};
        for (const field of err.fields) {
          map[field.field.replace("record.", "")] = field.message;
        }
        setFieldErrors(map);
      } else {
        setError("We could not save that record.");
      }
    } finally {
      setSaving(false);
    }
  }

  function defaultTitle() {
    if (type === "VACCINATION") {
      const vaccine = vaccines.find((v) => v.id === vaccineId);
      return vaccine ? vaccine.name : "Vaccination";
    }
    return HEALTH_RECORD_LABEL[type];
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("Add a record for {petName}", { petName })}
      description={t("Records you add are marked self-reported. Records written by a clinic through their own account carry a verified mark.")}
      size="lg"
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Type")} required>
            {({ id }) => (
              <Select
                id={id}
                value={type}
                onChange={(e) => setType(e.target.value as HealthRecordType)}
              >
                {HEALTH_RECORD_TYPE.map((value) => (
                  <option key={value} value={value}>
                    {t(HEALTH_RECORD_LABEL[value])}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label={t("Date")} required error={fieldErrors.occurredAt}>
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
              />
            )}
          </Field>
        </div>

        {type === "VACCINATION" && vaccines.length > 0 && (
          <Field
            label={t("Vaccine")}
            hint={t("Choosing one from the catalogue schedules the booster automatically.")}
          >
            {({ id }) => (
              <Select id={id} value={vaccineId} onChange={(e) => setVaccineId(e.target.value)}>
                <option value="">{t("Not listed")}</option>
                {vaccines.map((vaccine) => (
                  <option key={vaccine.id} value={vaccine.id}>
                    {vaccine.name}
                    {vaccine.coreVaccine ? ` (${t("core")})` : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        <Field
          label={t("Title")}
          hint={t("Leave blank to use \"{value}\".", { value: defaultTitle() })}
          error={fieldErrors.title}
        >
          {({ id, invalid }) => (
            <Input
              id={id}
              invalid={invalid}
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={defaultTitle()}
            />
          )}
        </Field>

        {type === "MEDICATION" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Medication")} required error={fieldErrors.medication}>
              {({ id, invalid }) => (
                <Input
                  id={id}
                  invalid={invalid}
                  maxLength={120}
                  value={medication}
                  onChange={(e) => setMedication(e.target.value)}
                />
              )}
            </Field>
            <Field label={t("Dosage")}>
              {({ id }) => (
                <Input
                  id={id}
                  maxLength={60}
                  value={dosage}
                  onChange={(e) => setDosage(e.target.value)}
                  placeholder={t("1 tablet twice daily")}
                />
              )}
            </Field>
          </div>
        )}

        {(type === "WEIGHT" || type === "TEST") && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={type === "WEIGHT" ? t("Weight") : t("Result")}
              required
              error={fieldErrors.resultValue}
            >
              {({ id, invalid }) => (
                <Input
                  id={id}
                  invalid={invalid}
                  type="number"
                  step="0.01"
                  value={resultValue}
                  onChange={(e) => setResultValue(e.target.value)}
                />
              )}
            </Field>
            <Field label={t("Unit")}>
              {({ id }) => (
                <Input
                  id={id}
                  maxLength={20}
                  value={resultUnit}
                  onChange={(e) => setResultUnit(e.target.value)}
                />
              )}
            </Field>
          </div>
        )}

        {type === "VACCINATION" && (
          <Field label={t("Batch number")} hint={t("From the vaccination card, if you have it.")}>
            {({ id }) => (
              <Input
                id={id}
                maxLength={60}
                value={batchNumber}
                onChange={(e) => setBatchNumber(e.target.value)}
              />
            )}
          </Field>
        )}

        <Field
          label={t("Next due")}
          hint={t("Leave blank and we will work it out from the vaccine schedule where we can.")}
        >
          {({ id }) => (
            <Input
              id={id}
              type="date"
              value={nextDueAt}
              onChange={(e) => setNextDueAt(e.target.value)}
            />
          )}
        </Field>

        <Field label={t("Notes")} trailing={`${description.length}/2000`}>
          {({ id }) => (
            <Textarea
              id={id}
              rows={3}
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button onClick={() => void save()} loading={saving} loadingText={t("Saving…")}>
            {t("Add record")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function AddReminderModal({
  open,
  onClose,
  petId,
}: {
  open: boolean;
  onClose: () => void;
  petId: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();

  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);

    try {
      await api.post(`/api/pets/${petId}/health`, {
        kind: "reminder",
        title: title.trim(),
        // The API expects a full ISO timestamp, not just a date.
        dueAt: new Date(`${dueAt}T09:00:00`).toISOString(),
      });

      toast.success(t("Reminder set"), t("We will tell you when it is due."));
      setTitle("");
      setDueAt("");
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We could not set that reminder.");
    } finally {
      setSaving(false);
    }
  }

  // Computed once on mount rather than on every render: a date input's `max`
  // does not need to change while the dialog is open, and reading the clock
  // during render is what causes a hydration mismatch.
  const [tomorrow] = useState(() =>
    new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("Add a reminder")}
      description={t("We will notify you, and email you if you have those switched on.")}
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        <Field label={t("What is it?")} required>
          {({ id }) => (
            <Input
              id={id}
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("Annual booster")}
              autoFocus
            />
          )}
        </Field>

        <Field label={t("When")} required>
          {({ id }) => (
            <Input
              id={id}
              type="date"
              min={tomorrow}
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          )}
        </Field>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            onClick={() => void save()}
            loading={saving}
            loadingText={t("Saving…")}
            disabled={!title.trim() || !dueAt}
          >
            {t("Set reminder")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
