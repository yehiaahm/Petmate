"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Copy, Lock, Save, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select, Switch, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { getResource, optionLabel, type FieldDef } from "@/lib/admin/registry";
import { cn } from "@/lib/utils";
import { Cell, formatBps, type RefLabels } from "./cell";

type Row = Record<string, unknown>;
type FormValue = string | boolean;

/** ISO instant → value for <input type="datetime-local"> in the viewer's own zone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toFormValue(field: FieldDef, value: unknown): FormValue {
  if (field.type === "boolean") return Boolean(value);
  if (value === null || value === undefined) return "";
  if (field.type === "datetime") return toLocalInput(String(value));
  if (field.type === "money") return (Number(value) / 100).toFixed(2).replace(/\.00$/, "");
  return String(value);
}

/** Form value → what the API expects, or an error message. */
function toPayload(field: FieldDef, value: FormValue): { ok: true; value: unknown } | { ok: false; message: string } {
  if (field.type === "boolean") return { ok: true, value: Boolean(value) };
  const s = String(value).trim();
  if (s === "") {
    return field.nullable ? { ok: true, value: null } : { ok: false, message: "This field is required." };
  }
  switch (field.type) {
    case "int":
    case "bps": {
      const n = Number(s);
      return Number.isInteger(n) ? { ok: true, value: n } : { ok: false, message: "Use a whole number." };
    }
    case "float": {
      const n = Number(s);
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, message: "Use a number." };
    }
    case "money": {
      const n = Number(s.replace(/,/g, ""));
      return Number.isFinite(n) ? { ok: true, value: Math.round(n * 100) } : { ok: false, message: "Use an amount like 125.50." };
    }
    case "datetime": {
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? { ok: false, message: "Enter a valid date." } : { ok: true, value: d.toISOString() };
    }
    default:
      return { ok: true, value: String(value) };
  }
}

export function RecordEditor({
  resource,
  row,
  refs,
  editable,
  readOnlyReason,
}: {
  resource: string;
  row: Row;
  refs: RefLabels;
  editable: string[];
  readOnlyReason: string | null;
}) {
  const def = getResource(resource)!;
  const router = useRouter();
  const toast = useToast();

  const initial = useMemo(
    () => Object.fromEntries(def.fields.filter((f) => editable.includes(f.key)).map((f) => [f.key, toFormValue(f, row[f.key])])),
    [def, editable, row],
  );
  const [values, setValues] = useState<Record<string, FormValue>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const dirtyKeys = Object.keys(initial).filter((k) => values[k] !== initial[k]);
  const editableFields = def.fields.filter((f) => editable.includes(f.key));
  const readOnlyFields = def.fields.filter((f) => !editable.includes(f.key));

  function set(key: string, value: FormValue) {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  async function save() {
    const payload: Record<string, unknown> = {};
    const nextErrors: Record<string, string> = {};
    for (const key of dirtyKeys) {
      const field = def.fields.find((f) => f.key === key)!;
      const result = toPayload(field, values[key]!);
      if (result.ok) payload[key] = result.value;
      else nextErrors[key] = result.message;
    }
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }

    setSaving(true);
    try {
      const result = await api.patch<{ changed: string[] }>(`/api/admin/data/${resource}/${row.id as string}`, { data: payload });
      toast.success(
        result.changed.length ? `${def.label} saved` : "Nothing changed",
        result.changed.length ? `${result.changed.length} field${result.changed.length === 1 ? "" : "s"} updated and logged.` : undefined,
      );
      setErrors({});
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.fields.length) {
        setErrors(Object.fromEntries(err.fields.map((f) => [f.field.replace(/^data\./, ""), f.message])));
      }
      toast.error("Not saved", err instanceof ApiError ? err.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {editableFields.length > 0 && (
        <section className="surface shadow-[var(--shadow-subtle)]" aria-labelledby="edit-heading">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
            <div>
              <h2 id="edit-heading" className="text-lg font-semibold text-fg">
                Edit {def.label.toLowerCase()}
              </h2>
              <p className="mt-0.5 text-sm text-fg-muted">Every change is validated on the server and written to the audit log with its old value.</p>
            </div>
          </div>
          <div className="grid gap-x-5 gap-y-4 p-5 md:grid-cols-2">
            {editableFields.map((field) => (
              <FieldControl
                key={field.key}
                field={field}
                value={values[field.key] ?? ""}
                original={row[field.key]}
                currency={field.currencyField ? ((row[field.currencyField] as string | undefined) ?? "USD") : "USD"}
                error={errors[field.key]}
                dirty={values[field.key] !== initial[field.key]}
                onChange={(v) => set(field.key, v)}
              />
            ))}
          </div>

          <div
            className={cn(
              "sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-b-[var(--radius-card)] border-t border-[var(--border)] px-5 py-3 transition-colors",
              dirtyKeys.length ? "bg-brand-soft" : "bg-bg-elevated",
            )}
          >
            <p className="text-sm text-fg-muted">
              {dirtyKeys.length ? (
                <span className="font-semibold text-brand-soft-fg">
                  {dirtyKeys.length} unsaved change{dirtyKeys.length === 1 ? "" : "s"}
                </span>
              ) : (
                "No unsaved changes"
              )}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={!dirtyKeys.length || saving}
                onClick={() => {
                  setValues(initial);
                  setErrors({});
                }}
              >
                <Undo2 className="size-4" aria-hidden />
                Discard
              </Button>
              <Button size="sm" disabled={!dirtyKeys.length} loading={saving} onClick={() => void save()}>
                <Save className="size-4" aria-hidden />
                Save changes
              </Button>
            </div>
          </div>
        </section>
      )}

      <section className="surface shadow-[var(--shadow-subtle)]" aria-labelledby="fields-heading">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <h2 id="fields-heading" className="text-lg font-semibold text-fg">
            {editableFields.length ? "Read-only fields" : "Record"}
          </h2>
          {readOnlyReason && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted">
              <Lock className="size-3.5" aria-hidden />
              {readOnlyReason}
            </span>
          )}
        </div>
        <dl className="grid divide-y divide-[var(--border)] md:grid-cols-2 md:divide-y-0">
          {readOnlyFields.map((field) => (
            <div
              key={field.key}
              className={cn(
                "flex flex-col gap-1 px-5 py-3 md:border-b md:border-[var(--border)]",
                (field.type === "json" || field.type === "textarea") && "md:col-span-2",
              )}
            >
              <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-fg-subtle">
                {field.label}
                {field.type === "id" && (
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(String(row[field.key]));
                      toast.info("Copied");
                    }}
                    className="rounded p-0.5 text-fg-subtle hover:text-fg"
                    aria-label={`Copy ${field.label}`}
                  >
                    <Copy className="size-3" aria-hidden />
                  </button>
                )}
              </dt>
              <dd className="min-w-0 text-sm text-fg">
                <Cell def={def} field={field} row={row} refs={refs} compact={false} />
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

function FieldControl({
  field,
  value,
  original,
  error,
  dirty,
  onChange,
  currency,
}: {
  field: FieldDef;
  value: FormValue;
  original: unknown;
  currency: string;
  error?: string;
  dirty: boolean;
  onChange: (v: FormValue) => void;
}) {
  const id = `field-${field.key}`;
  const wide = field.type === "textarea" || field.type === "json";
  const hint =
    field.type === "bps" && value !== "" && Number.isFinite(Number(value))
      ? `${formatBps(Number(value))}${field.hint ? ` · ${field.hint}` : ""}`
      : field.type === "datetime"
        ? `Your local time${field.hint ? ` · ${field.hint}` : ""}`
        : field.hint;

  if (field.type === "boolean") {
    return (
      <div className={cn("rounded-[var(--radius-field)] border px-4 py-3", dirty ? "border-[var(--brand)]" : "border-[var(--border)]")}>
        <Switch checked={Boolean(value)} onChange={onChange} label={field.label} description={hint} />
      </div>
    );
  }

  const options = field.options ? [...field.options] : [];
  if (field.type === "enum" && typeof original === "string" && original && !options.includes(original)) options.unshift(original);

  return (
    <div className={cn("space-y-1.5", wide && "md:col-span-2")}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-fg">
          {field.label}
          {!field.nullable && field.type !== "enum" && (
            <span className="ml-0.5 text-[var(--danger)]" aria-hidden>
              *
            </span>
          )}
        </label>
        {dirty && <span className="text-[11px] font-semibold uppercase tracking-wide text-brand">Edited</span>}
      </div>

      {field.type === "enum" ? (
        <Select id={id} value={String(value)} invalid={Boolean(error)} onChange={(e) => onChange(e.target.value)}>
          {field.nullable && <option value="">— None —</option>}
          {options.map((o) => (
            <option key={o} value={o}>
              {optionLabel(field, o)}
            </option>
          ))}
        </Select>
      ) : field.type === "textarea" || field.type === "json" ? (
        <Textarea
          id={id}
          value={String(value)}
          invalid={Boolean(error)}
          rows={field.type === "json" ? 8 : 4}
          maxLength={field.type === "json" ? 20000 : field.max}
          onChange={(e) => onChange(e.target.value)}
          className={cn(field.type === "json" && "font-mono text-xs")}
          spellCheck={field.type !== "json"}
        />
      ) : (
        <Input
          id={id}
          value={String(value)}
          invalid={Boolean(error)}
          onChange={(e) => onChange(e.target.value)}
          type={
            field.type === "datetime"
              ? "datetime-local"
              : field.type === "email"
                ? "email"
                : field.type === "url"
                  ? "url"
                  : field.type === "int" || field.type === "bps" || field.type === "float"
                    ? "number"
                    : "text"
          }
          inputMode={field.type === "money" ? "decimal" : undefined}
          step={field.type === "float" ? "any" : undefined}
          min={field.type === "int" || field.type === "bps" || field.type === "float" ? field.min : undefined}
          max={field.type === "int" || field.type === "bps" || field.type === "float" ? field.max : undefined}
          maxLength={field.type === "text" || field.type === "email" || field.type === "url" ? (field.max ?? 500) : undefined}
          leading={field.type === "money" ? <span className="text-[11px] font-semibold">{currency}</span> : undefined}
          className={cn((field.type === "int" || field.type === "money" || field.type === "bps" || field.type === "float") && "tabular", field.type === "ref" && "font-mono text-sm")}
        />
      )}

      {error ? (
        <p className="flex items-start gap-1.5 text-xs font-medium text-[var(--danger)]">
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-fg-muted">{hint}</p>
      )}
    </div>
  );
}
