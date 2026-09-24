"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { SlidersHorizontal, X, MapPin, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select, Checkbox } from "@/components/ui/field";
import { Badge } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { SPECIES, SPECIES_LABEL, LISTING_INTENT, LISTING_INTENT_LABEL, type Species } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * Marketplace filters.
 *
 * Filters live in the URL, not in component state. That makes every filtered
 * view shareable, bookmarkable, indexable and survivable across a refresh —
 * and it means the back button does what people expect.
 */

interface Facets {
  species: { value: string; count: number }[];
  cities: { value: string; count: number }[];
  price: { min: number; max: number; avg: number };
}

export function FilterPanel({
  facets,
  resultCount,
}: {
  facets: Facets | null;
  resultCount: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [locating, setLocating] = useState(false);

  // Local mirrors of the URL so typing in a number field does not fire a
  // navigation per keystroke.
  const [minPrice, setMinPrice] = useState(params.get("minPrice") ?? "");
  const [maxPrice, setMaxPrice] = useState(params.get("maxPrice") ?? "");

  // The URL is the source of truth; these inputs are a local buffer so typing
  // does not navigate per keystroke. When the URL changes underneath us — Back,
  // a filter chip, a fresh search — the buffer is reset during render rather
  // than in an effect, which would paint the stale value first.
  const urlPrices = `${params.get("minPrice") ?? ""}|${params.get("maxPrice") ?? ""}`;
  const [lastUrlPrices, setLastUrlPrices] = useState(urlPrices);
  if (urlPrices !== lastUrlPrices) {
    setLastUrlPrices(urlPrices);
    setMinPrice(params.get("minPrice") ?? "");
    setMaxPrice(params.get("maxPrice") ?? "");
  }

  function update(changes: Record<string, string | string[] | null>) {
    const next = new URLSearchParams(params.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
        next.delete(key);
      } else {
        next.set(key, Array.isArray(value) ? value.join(",") : value);
      }
    }

    // Any filter change resets to the first page; staying on page 7 of a
    // different result set is never what anyone wants.
    next.delete("page");

    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`, { scroll: false });
    });
  }

  function toggleSpecies(species: Species) {
    const current = (params.get("species") ?? "").split(",").filter(Boolean);
    const next = current.includes(species)
      ? current.filter((s) => s !== species)
      : [...current, species];
    update({ species: next });
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      toast.error("Location is not available", "Your browser does not support it.");
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        update({
          lat: position.coords.latitude.toFixed(4),
          lng: position.coords.longitude.toFixed(4),
          radius: params.get("radius") ?? "50",
          city: null,
        });
      },
      () => {
        setLocating(false);
        toast.info(
          "We could not get your location",
          "Allow location access, or type a city instead.",
        );
      },
      { timeout: 8000, maximumAge: 300_000 },
    );
  }

  const selectedSpecies = (params.get("species") ?? "").split(",").filter(Boolean);
  const activeCount = [
    "intent", "species", "sex", "minPrice", "maxPrice", "minAge", "maxAge",
    "city", "lat", "verified", "vaccinated", "minHealth",
  ].filter((key) => params.get(key)).length;

  const content = (
    <div className="space-y-6">
      <fieldset>
        <legend className="mb-2.5 text-sm font-semibold text-fg">Looking to</legend>
        <div className="flex flex-wrap gap-2">
          {LISTING_INTENT.map((intent) => {
            const active = params.get("intent") === intent;
            return (
              <button
                key={intent}
                type="button"
                onClick={() => update({ intent: active ? null : intent })}
                aria-pressed={active}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "border-transparent bg-brand text-brand-fg"
                    : "border-[var(--border-strong)] text-fg-muted hover:border-brand hover:text-fg",
                )}
              >
                {LISTING_INTENT_LABEL[intent]}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2.5 text-sm font-semibold text-fg">Species</legend>
        <div className="flex flex-wrap gap-2">
          {SPECIES.map((species) => {
            const active = selectedSpecies.includes(species);
            const count = facets?.species.find((s) => s.value === species)?.count;

            return (
              <button
                key={species}
                type="button"
                onClick={() => toggleSpecies(species)}
                aria-pressed={active}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "border-transparent bg-brand-soft font-medium text-brand-soft-fg"
                    : "border-[var(--border)] text-fg-muted hover:border-[var(--border-strong)] hover:text-fg",
                )}
              >
                {SPECIES_LABEL[species]}
                {count != null && count > 0 && (
                  <span className="tabular text-[11px] text-fg-subtle">{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2.5 text-sm font-semibold text-fg">Price</legend>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="Min"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            onBlur={() => update({ minPrice: minPrice || null })}
            onKeyDown={(e) => e.key === "Enter" && update({ minPrice: minPrice || null })}
            aria-label="Minimum price"
          />
          <span className="text-fg-subtle" aria-hidden>
            –
          </span>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="Max"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            onBlur={() => update({ maxPrice: maxPrice || null })}
            onKeyDown={(e) => e.key === "Enter" && update({ maxPrice: maxPrice || null })}
            aria-label="Maximum price"
          />
        </div>
        {facets && facets.price.max > 0 && (
          <p className="mt-2 text-xs text-fg-subtle tabular">
            Listings range {Math.round(facets.price.min / 100)} – {Math.round(facets.price.max / 100)},
            average {Math.round(facets.price.avg / 100)}
          </p>
        )}
      </fieldset>

      <fieldset>
        <legend className="mb-2.5 text-sm font-semibold text-fg">Age</legend>
        <Select
          value={params.get("maxAge") ?? params.get("minAge") ?? ""}
          onChange={(e) => {
            const value = e.target.value;
            if (!value) return update({ minAge: null, maxAge: null });
            if (value === "baby") return update({ maxAge: "12", minAge: null });
            if (value === "young") return update({ maxAge: "36", minAge: "12" });
            if (value === "adult") return update({ minAge: "36", maxAge: "84" });
            return update({ minAge: "84", maxAge: null });
          }}
          aria-label="Age range"
        >
          <option value="">Any age</option>
          <option value="baby">Under 1 year</option>
          <option value="young">1 – 3 years</option>
          <option value="adult">3 – 7 years</option>
          <option value="senior">7 years and over</option>
        </Select>
      </fieldset>

      <fieldset>
        <legend className="mb-2.5 text-sm font-semibold text-fg">Sex</legend>
        <div className="flex gap-2">
          {(["MALE", "FEMALE"] as const).map((sex) => {
            const active = params.get("sex") === sex;
            return (
              <button
                key={sex}
                type="button"
                onClick={() => update({ sex: active ? null : sex })}
                aria-pressed={active}
                className={cn(
                  "flex-1 rounded-[var(--radius-field)] border px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "border-transparent bg-brand-soft text-brand-soft-fg"
                    : "border-[var(--border-strong)] text-fg-muted hover:text-fg",
                )}
              >
                {sex === "MALE" ? "Male" : "Female"}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2.5 text-sm font-semibold text-fg">Location</legend>

        {params.get("lat") ? (
          <div className="flex items-center justify-between rounded-[var(--radius-field)] border border-brand bg-brand-soft px-3 py-2">
            <span className="flex items-center gap-2 text-sm font-medium text-brand-soft-fg">
              <MapPin className="size-4" aria-hidden />
              Within {params.get("radius") ?? 50} km of you
            </span>
            <button
              type="button"
              onClick={() => update({ lat: null, lng: null, radius: null })}
              className="rounded p-1 text-brand-soft-fg hover:opacity-70"
              aria-label="Clear location filter"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <Select
              value={params.get("city") ?? ""}
              onChange={(e) => update({ city: e.target.value || null })}
              aria-label="City"
            >
              <option value="">Anywhere</option>
              {facets?.cities.map((city) => (
                <option key={city.value} value={city.value}>
                  {city.value} ({city.count})
                </option>
              ))}
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              fullWidth
              onClick={useMyLocation}
              loading={locating}
              loadingText="Finding you…"
            >
              <MapPin className="size-4" aria-hidden />
              Use my location
            </Button>
          </div>
        )}

        {params.get("lat") && (
          <Select
            className="mt-2"
            value={params.get("radius") ?? "50"}
            onChange={(e) => update({ radius: e.target.value })}
            aria-label="Search radius"
          >
            {[10, 25, 50, 100, 250, 500].map((km) => (
              <option key={km} value={km}>
                Within {km} km
              </option>
            ))}
          </Select>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2.5 text-sm font-semibold text-fg">Trust filters</legend>
        <Checkbox
          label="Documented or vet-verified only"
          hint="Pets with paperwork on file"
          checked={params.get("verified") === "true"}
          onChange={(e) => update({ verified: e.target.checked ? "true" : null })}
        />
        <Checkbox
          label="Vaccinations up to date"
          hint="Nothing overdue on the record"
          checked={params.get("vaccinated") === "true"}
          onChange={(e) => update({ vaccinated: e.target.checked ? "true" : null })}
        />
        <Checkbox
          label="Well-documented health record"
          hint="Health score of 60 or above"
          checked={params.get("minHealth") === "60"}
          onChange={(e) => update({ minHealth: e.target.checked ? "60" : null })}
        />
      </fieldset>

      {activeCount > 0 && (
        <Button
          variant="ghost"
          fullWidth
          onClick={() => startTransition(() => router.push(pathname))}
        >
          Clear all filters
        </Button>
      )}
    </div>
  );

  return (
    <>
      {/* Mobile: filters open in a sheet, because a sidebar on a phone eats
          the entire screen before you see a single result. */}
      <div className="lg:hidden">
        <Button variant="outline" onClick={() => setMobileOpen(true)} fullWidth>
          <SlidersHorizontal className="size-4" aria-hidden />
          Filters
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
              aria-label="Filters"
              className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-[var(--radius-panel)] bg-bg pb-[env(safe-area-inset-bottom)]"
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border)] bg-bg px-4 py-3">
                <h2 className="font-display text-lg font-semibold">Filters</h2>
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className="rounded-full p-1.5 text-fg-muted hover:bg-bg-sunken"
                  aria-label="Close filters"
                >
                  <X className="size-5" aria-hidden />
                </button>
              </div>
              <div className="p-4">{content}</div>
              <div className="sticky bottom-0 border-t border-[var(--border)] bg-bg p-4">
                <Button fullWidth onClick={() => setMobileOpen(false)}>
                  {pending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden /> Updating…
                    </>
                  ) : (
                    `Show ${resultCount} ${resultCount === 1 ? "result" : "results"}`
                  )}
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
