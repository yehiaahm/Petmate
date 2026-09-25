"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BellPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Checkbox } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { useI18n } from "@/components/i18n/i18n-provider";

/**
 * Saves the current filter set and offers alerts.
 *
 * The retention mechanic for the marketplace: most people do not find the
 * right animal on their first visit, and an alert is the reason they come back
 * rather than drifting to a Facebook group.
 */
export function SaveSearchButton() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [alerts, setAlerts] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgradeUrl, setUpgradeUrl] = useState<string | null>(null);

  function suggestName() {
    const parts: string[] = [];
    const species = params.get("species");
    const intent = params.get("intent");
    const city = params.get("city");
    const maxPrice = params.get("maxPrice");
    const q = params.get("q");

    if (q) parts.push(q);
    if (species) parts.push(species.split(",").map((s) => s.toLowerCase().replace("_", " ")).join("/"));
    if (intent) parts.push(intent.toLowerCase());
    if (city) parts.push(`in ${city}`);
    if (maxPrice) parts.push(`under ${maxPrice}`);

    return parts.length ? parts.join(" ").slice(0, 60) : "My pet search";
  }

  async function save() {
    setSaving(true);
    setError(null);
    setUpgradeUrl(null);

    const filters: Record<string, unknown> = {};
    for (const [key, value] of params.entries()) {
      if (key === "page") continue;
      filters[key] = value;
    }

    try {
      await api.post("/api/search", {
        action: "save",
        name: name.trim() || suggestName(),
        filters,
        alerts,
      });

      setOpen(false);
      setName("");
      toast.success(
        t("Search saved"),
        alerts ? "We will tell you when something new matches." : "Find it under saved searches.",
      );
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.isAuth) {
          setOpen(false);
          toast.info(t("Sign in to save searches"), t("Alerts are free on every plan."));
          router.push("/login?next=/pets");
          return;
        }
        setError(err.message);
        if (err.needsUpgrade) setUpgradeUrl("/pricing");
      } else {
        setError("We could not save that search. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setName(suggestName());
          setOpen(true);
        }}
      >
        <BellPlus className="size-4" aria-hidden />
        {t("Save this search")}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("Save this search")}
        description={t("We will check for new matches and let you know, so you do not have to keep refreshing.")}
      >
        <div className="space-y-4">
          <Field label={t("Name this search")} error={error && !upgradeUrl ? error : null}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                placeholder={t("Calm small dog near me")}
              />
            )}
          </Field>

          <Checkbox
            label={t("Alert me when something new matches")}
            hint={t("A notification, and an email if you have those on.")}
            checked={alerts}
            onChange={(e) => setAlerts(e.target.checked)}
          />

          {upgradeUrl && (
            <div className="rounded-[var(--radius-field)] border border-[var(--warning)]/30 bg-[var(--warning-soft)] p-3 text-sm text-[var(--warning)]">
              <p>{error}</p>
              <a href={upgradeUrl} className="mt-1 inline-block font-semibold underline">
                {t("See plans")}
              </a>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button onClick={() => void save()} loading={saving} loadingText={t("Saving…")}>
              {t("Save search")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
