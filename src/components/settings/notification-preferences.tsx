"use client";

import { useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleSwitch } from "@/components/ui/field";
import { Card } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/components/i18n/i18n-provider";
import { api, ApiError } from "@/lib/api-client";

export interface PreferenceRow {
  category: string;
  label: string;
  inApp: boolean;
  email: boolean;
  phone: boolean;
  mandatory: boolean;
}

type Channel = "inApp" | "email" | "phone";

export function NotificationPreferences({ rows, phoneVerified }: { rows: PreferenceRow[]; phoneVerified: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const [state, setState] = useState(rows);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  function toggle(category: string, channel: Channel, value: boolean) {
    setState((prev) =>
      prev.map((row) =>
        // Security stays on in the app and by email; the phone is the person's choice.
        row.category === category && (!row.mandatory || channel === "phone") ? { ...row, [channel]: value } : row,
      ),
    );
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      await api.post("/api/notifications", {
        action: "preferences",
        preferences: state.map((row) => ({ category: row.category, inApp: row.inApp, email: row.email, phone: row.phone })),
      });
      toast.success(t("Notification settings saved"));
      setDirty(false);
    } catch (err) {
      toast.error(t("Could not save"), err instanceof ApiError ? err.message : t("Please try again."));
    } finally {
      setSaving(false);
    }
  }

  const grid = "grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 sm:gap-x-6";

  return (
    <div className="space-y-5">
      {!phoneVerified && (
        <p className="text-sm text-fg-muted">
          {t("To get order, delivery and appointment updates on WhatsApp or by SMS,")}{" "}
          <Link href="/settings" className="font-medium text-brand hover:underline">
            {t("verify your mobile number")}
          </Link>
          .
        </p>
      )}
      <Card>
        <div className={`${grid} border-b border-[var(--border)] px-5 py-3 text-xs font-semibold uppercase tracking-wider text-fg-subtle`}>
          <span>{t("Category")}</span>
          <span className="w-14 text-center">{t("In app")}</span>
          <span className="w-14 text-center">{t("Email")}</span>
          <span className="w-16 text-center">{t("WhatsApp / SMS")}</span>
        </div>

        <ul className="divide-y divide-[var(--border)]">
          {state.map((row) => {
            const label = t(row.label);
            return (
              <li key={row.category} className={`${grid} px-5 py-3.5`}>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">{label}</p>
                  {row.mandatory && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-fg-subtle">
                      <Lock className="size-3" aria-hidden />
                      {t("Always on in the app and by email")}
                    </p>
                  )}
                </div>

                <div className="flex w-14 justify-center">
                  <ToggleSwitch
                    checked={row.inApp}
                    disabled={row.mandatory}
                    onChange={(v) => toggle(row.category, "inApp", v)}
                    label={t("{category} in the app", { category: label })}
                  />
                </div>

                <div className="flex w-14 justify-center">
                  <ToggleSwitch
                    checked={row.email}
                    disabled={row.mandatory}
                    onChange={(v) => toggle(row.category, "email", v)}
                    label={t("{category} by email", { category: label })}
                  />
                </div>

                <div className="flex w-16 justify-center">
                  <ToggleSwitch
                    checked={row.phone && phoneVerified}
                    disabled={!phoneVerified || row.category === "MARKETING"}
                    onChange={(v) => toggle(row.category, "phone", v)}
                    label={t("{category} on WhatsApp or SMS", { category: label })}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="flex items-center justify-end gap-3">
        {dirty && <span className="text-sm text-fg-muted">{t("Unsaved changes")}</span>}
        <Button onClick={save} loading={saving} loadingText={t("Saving…")} disabled={!dirty}>
          {t("Save preferences")}
        </Button>
      </div>
    </div>
  );
}
