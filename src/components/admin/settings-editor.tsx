"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Badge } from "@/components/ui/primitives";
import { Field, Input, ToggleSwitch } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { formatMoney, bpsToPercent } from "@/lib/money";
import { PLATFORM_CURRENCY } from "@/lib/currency";

export interface SettingField {
  key: string;
  value: string | number | boolean;
  defaultValue: string | number | boolean;
  description: string;
}

export interface SettingGroup {
  title: string;
  blurb: string;
  fields: SettingField[];
}

/** Human-readable preview of what a raw value actually means. */
function preview(key: string, value: string | number | boolean): string | null {
  if (typeof value !== "number") return null;
  if (key.endsWith("Bps")) return bpsToPercent(value);
  if (key.endsWith("Cents")) return formatMoney(value, PLATFORM_CURRENCY);
  if (key.endsWith("Hours")) {
    const days = value / 24;
    return Number.isInteger(days) ? `${days} day${days === 1 ? "" : "s"}` : `${value} hours`;
  }
  if (key.endsWith("Days")) return `${value} day${value === 1 ? "" : "s"}`;
  return null;
}

export function SettingsEditor({ groups }: { groups: SettingGroup[] }) {
  const router = useRouter();
  const toast = useToast();

  const [values, setValues] = useState<Record<string, string | number | boolean>>(
    Object.fromEntries(groups.flatMap((g) => g.fields.map((f) => [f.key, f.value]))),
  );
  const [saving, setSaving] = useState<string | null>(null);

  async function save(key: string, value: string | number | boolean) {
    setSaving(key);
    try {
      await api.post("/api/admin", { action: "update-setting", key, value });
      setValues((v) => ({ ...v, [key]: value }));
      toast.success("Saved", "It applies to everything from now on.");
      router.refresh();
    } catch (err) {
      toast.error(
        "Could not save that",
        err instanceof ApiError ? err.message : "Please try again.",
      );
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <Card key={group.title}>
          <CardHeader title={group.title} description={group.blurb} />
          <ul className="divide-y divide-[var(--border)]">
            {group.fields.map((field) => {
              const current = values[field.key] ?? field.value;
              const changed = current !== field.defaultValue;
              const hint = preview(field.key, current);

              return (
                <li key={field.key} className="p-5">
                  {typeof field.defaultValue === "boolean" ? (
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-fg">{field.key}</p>
                        <p className="mt-0.5 text-sm text-fg-muted">{field.description}</p>
                      </div>
                      <div className="shrink-0 pt-1">
                        <ToggleSwitch
                          checked={Boolean(current)}
                          label={field.description}
                          disabled={saving === field.key}
                          onChange={(next) => save(field.key, next)}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-end gap-4">
                      <div className="min-w-0 flex-1">
                        <Field
                          label={field.key}
                          hint={hint ? `${field.description} Currently ${hint}.` : field.description}
                        >
                          {({ id, invalid }) => (
                            <Input
                              id={id}
                              invalid={invalid}
                              type={typeof field.defaultValue === "number" ? "number" : "text"}
                              value={String(current)}
                              className={typeof field.defaultValue === "number" ? "tabular" : ""}
                              onChange={(e) =>
                                setValues((v) => ({
                                  ...v,
                                  [field.key]:
                                    typeof field.defaultValue === "number"
                                      ? Number(e.target.value)
                                      : e.target.value,
                                }))
                              }
                            />
                          )}
                        </Field>
                      </div>

                      <div className="flex shrink-0 items-center gap-2 pb-0.5">
                        {changed && (
                          <Button
                            size="sm"
                            variant="ghost"
                            title={`Reset to ${field.defaultValue}`}
                            onClick={() => save(field.key, field.defaultValue)}
                            loading={saving === `${field.key}:reset`}
                          >
                            <RotateCcw className="size-4" aria-hidden />
                            <span className="sr-only">
                              Reset {field.key} to {String(field.defaultValue)}
                            </span>
                          </Button>
                        )}
                        <Button
                          size="sm"
                          loading={saving === field.key}
                          disabled={current === field.value}
                          onClick={() => save(field.key, current)}
                        >
                          Save
                        </Button>
                      </div>

                      {changed && (
                        <Badge tone="warning" size="sm">
                          differs from default ({String(field.defaultValue)})
                        </Badge>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
    </div>
  );
}
