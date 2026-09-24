"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleSwitch } from "@/components/ui/field";
import { Card } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";

export interface PreferenceRow {
  category: string;
  label: string;
  inApp: boolean;
  email: boolean;
  mandatory: boolean;
}

export function NotificationPreferences({ rows }: { rows: PreferenceRow[] }) {
  const toast = useToast();
  const [state, setState] = useState(rows);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  function toggle(category: string, channel: "inApp" | "email", value: boolean) {
    setState((prev) =>
      prev.map((row) =>
        row.category === category && !row.mandatory ? { ...row, [channel]: value } : row,
      ),
    );
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      await api.post("/api/notifications", {
        action: "preferences",
        preferences: state.map((row) => ({
          category: row.category,
          inApp: row.inApp,
          email: row.email,
        })),
      });
      toast.success("Notification settings saved");
      setDirty(false);
    } catch (err) {
      toast.error(
        "Could not save",
        err instanceof ApiError ? err.message : "Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 border-b border-[var(--border)] px-5 py-3 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
          <span>Category</span>
          <span className="w-14 text-center">In app</span>
          <span className="w-14 text-center">Email</span>
        </div>

        <ul className="divide-y divide-[var(--border)]">
          {state.map((row) => (
            <li
              key={row.category}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 px-5 py-3.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg">{row.label}</p>
                {row.mandatory && (
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-fg-subtle">
                    <Lock className="size-3" aria-hidden />
                    Always on
                  </p>
                )}
              </div>

              <div className="flex w-14 justify-center">
                <ToggleSwitch
                  checked={row.inApp}
                  disabled={row.mandatory}
                  onChange={(v) => toggle(row.category, "inApp", v)}
                  label={`${row.label} in the app`}
                />
              </div>

              <div className="flex w-14 justify-center">
                <ToggleSwitch
                  checked={row.email}
                  disabled={row.mandatory}
                  onChange={(v) => toggle(row.category, "email", v)}
                  label={`${row.label} by email`}
                />
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <div className="flex items-center justify-end gap-3">
        {dirty && <span className="text-sm text-fg-muted">Unsaved changes</span>}
        <Button onClick={save} loading={saving} loadingText="Saving…" disabled={!dirty}>
          Save preferences
        </Button>
      </div>
    </div>
  );
}
