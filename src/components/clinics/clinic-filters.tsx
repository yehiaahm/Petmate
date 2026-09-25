"use client";

import { useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { MapPin, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select, Checkbox } from "@/components/ui/field";
import { Badge } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { SERVICE_CATEGORY, SERVICE_CATEGORY_LABEL } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n/i18n-provider";

/**
 * Clinic filters.
 *
 * Same URL-driven approach as the pet marketplace: shareable, bookmarkable,
 * and survives a refresh. "Near me" is the one that matters most here — a vet
 * forty minutes away is not a vet you will use.
 */
export function ClinicFilters({ resultCount }: { resultCount: number }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();

  const [pending, startTransition] = useTransition();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [city, setCity] = useState(params.get("city") ?? "");

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    next.delete("page");

    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      toast.error(t("Location is not available"), t("Your browser does not support it."));
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        update({
          lat: position.coords.latitude.toFixed(4),
          lng: position.coords.longitude.toFixed(4),
          radius: params.get("radius") ?? "25",
          city: null,
        });
      },
      () => {
        setLocating(false);
        toast.info(t("We could not get your location"), t("Type a city instead."));
      },
      { timeout: 8000, maximumAge: 300_000 },
    );
  }

  const activeCount = ["city", "lat", "category", "emergency", "homeVisits", "maxPrice"].filter(
    (key) => params.get(key),
  ).length;

  const content = (
    <div className="space-y-5">
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-fg">{t("Where")}</legend>

        {params.get("lat") ? (
          <div className="flex items-center justify-between rounded-[var(--radius-field)] border border-brand bg-brand-soft px-3 py-2">
            <span className="flex items-center gap-2 text-sm font-medium text-brand-soft-fg">
              <MapPin className="size-4" aria-hidden />
              {t("Within {km} km", { km: params.get("radius") ?? 25 })}
            </span>
            <button
              type="button"
              onClick={() => update({ lat: null, lng: null, radius: null })}
              className="rounded p-1 text-brand-soft-fg hover:opacity-70"
              aria-label={t("Clear location")}
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <Input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              onBlur={() => update({ city: city || null })}
              onKeyDown={(e) => e.key === "Enter" && update({ city: city || null })}
              placeholder={t("City")}
              aria-label={t("City")}
              leading={<MapPin className="size-4" aria-hidden />}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              fullWidth
              onClick={useMyLocation}
              loading={locating}
              loadingText={t("Finding you…")}
            >
              {t("Use my location")}
            </Button>
          </div>
        )}

        {params.get("lat") && (
          <Select
            className="mt-2"
            value={params.get("radius") ?? "25"}
            onChange={(e) => update({ radius: e.target.value })}
            aria-label={t("Search radius")}
          >
            {[5, 10, 25, 50, 100].map((km) => (
              <option key={km} value={km}>
                {t("Within {km} km", { km })}
              </option>
            ))}
          </Select>
        )}
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-fg">{t("Service")}</legend>
        <Select
          value={params.get("category") ?? ""}
          onChange={(e) => update({ category: e.target.value || null })}
          aria-label={t("Service type")}
        >
          <option value="">{t("Any service")}</option>
          {SERVICE_CATEGORY.map((category) => (
            <option key={category} value={category}>
              {t(SERVICE_CATEGORY_LABEL[category])}
            </option>
          ))}
        </Select>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold text-fg">{t("Options")}</legend>
        <Checkbox
          label={t("Emergency services")}
          hint={t("Open for urgent cases")}
          checked={params.get("emergency") === "true"}
          onChange={(e) => update({ emergency: e.target.checked ? "true" : null })}
        />
        <Checkbox
          label={t("Home visits")}
          checked={params.get("homeVisits") === "true"}
          onChange={(e) => update({ homeVisits: e.target.checked ? "true" : null })}
        />
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-fg">{t("Sort by")}</legend>
        <Select
          value={params.get("sort") ?? "relevance"}
          onChange={(e) => update({ sort: e.target.value === "relevance" ? null : e.target.value })}
          aria-label={t("Sort clinics")}
        >
          <option value="relevance">{t("Best match")}</option>
          <option value="rating">{t("Highest rated")}</option>
          {params.get("lat") && <option value="distance">{t("Closest")}</option>}
        </Select>
      </fieldset>

      {activeCount > 0 && (
        <Button
          variant="ghost"
          fullWidth
          onClick={() => startTransition(() => router.push(pathname))}
        >
          {t("Clear all filters")}
        </Button>
      )}
    </div>
  );

  return (
    <>
      <div className="lg:hidden">
        <Button variant="outline" fullWidth onClick={() => setMobileOpen(true)}>
          <SlidersHorizontal className="size-4" aria-hidden />
          {t("Filters")}
          {activeCount > 0 && (
            <Badge tone="brand" size="sm">
              {activeCount}
            </Badge>
          )}
        </Button>

        {mobileOpen && (
          <div className="fixed inset-0 z-[60]">
            <div
              className="animate-fade absolute inset-0 bg-[var(--overlay)]"
              onClick={() => setMobileOpen(false)}
              aria-hidden
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={t("Clinic filters")}
              className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-[var(--radius-panel)] bg-bg pb-[env(safe-area-inset-bottom)]"
            >
              <div className="sticky top-0 flex items-center justify-between border-b border-[var(--border)] bg-bg px-4 py-3">
                <h2 className="font-display text-lg font-semibold">{t("Filters")}</h2>
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className="rounded-full p-1.5 text-fg-muted hover:bg-bg-sunken"
                  aria-label={t("Close filters")}
                >
                  <X className="size-5" aria-hidden />
                </button>
              </div>
              <div className="p-4">{content}</div>
              <div className="sticky bottom-0 border-t border-[var(--border)] bg-bg p-4">
                <Button fullWidth onClick={() => setMobileOpen(false)}>
                  {t.plural(resultCount, { one: "Show {count} clinic", other: "Show {count} clinics" })}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <aside className={cn("hidden lg:block", pending && "opacity-60 transition-opacity")}>
        {content}
      </aside>
    </>
  );
}
