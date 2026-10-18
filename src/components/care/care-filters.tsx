"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LocateFixed, Search, X } from "lucide-react";
import { Card } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { SPECIES, SPECIES_PLURAL } from "@/lib/constants";

/**
 * Filters live in the URL, so a search can be shared, bookmarked and indexed,
 * and the back button undoes a filter rather than leaving the page.
 */
export function CareFilters({ kind, resultCount }: { kind: "BOARDING" | "TRAINING"; resultCount: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [q, setQ] = useState(params.get("q") ?? "");
  const [city, setCity] = useState(params.get("city") ?? "");
  const [locating, setLocating] = useState(false);

  const nearMe = params.has("lat") && params.has("lng");

  function push(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    next.delete("page");
    router.push(`${pathname}${next.size ? `?${next.toString()}` : ""}`);
  }

  function locate() {
    if (!("geolocation" in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        push({
          lat: pos.coords.latitude.toFixed(4),
          lng: pos.coords.longitude.toFixed(4),
          radius: params.get("radius") ?? "25",
          sort: "distance",
          city: null,
        });
      },
      () => setLocating(false),
      { timeout: 15_000, maximumAge: 300_000 },
    );
  }

  return (
    <Card className="space-y-4 p-4">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          push({ q: q.trim() || null, city: city.trim() || null });
        }}
      >
        <Field label="Search">
          {({ id }) => (
            <Input
              id={id}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={kind === "BOARDING" ? "Name, area…" : "Name, skill…"}
              leading={<Search className="size-4" aria-hidden />}
            />
          )}
        </Field>
        <Field label="City">
          {({ id }) => <Input id={id} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Cairo" />}
        </Field>
        <Button type="submit" size="sm" fullWidth>
          Apply
        </Button>
      </form>

      <div className="space-y-2 border-t border-[var(--border)] pt-4">
        {nearMe ? (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-fg">Near you · {params.get("radius") ?? "25"} km</span>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
              onClick={() => push({ lat: null, lng: null, radius: null, sort: null })}
            >
              <X className="size-3.5" aria-hidden /> Clear
            </button>
          </div>
        ) : (
          <Button type="button" variant="outline" size="sm" fullWidth onClick={locate} loading={locating} loadingText="Locating…">
            <LocateFixed className="size-4" aria-hidden />
            Near me
          </Button>
        )}
        {nearMe && (
          <Select
            aria-label="Distance"
            value={params.get("radius") ?? "25"}
            onChange={(e) => push({ radius: e.target.value })}
          >
            {["5", "10", "25", "50", "100"].map((r) => (
              <option key={r} value={r}>
                Within {r} km
              </option>
            ))}
          </Select>
        )}
      </div>

      <div className="space-y-3 border-t border-[var(--border)] pt-4">
        <Field label={kind === "BOARDING" ? "Your pet" : "Your animal"}>
          {({ id }) => (
            <Select id={id} value={params.get("species") ?? ""} onChange={(e) => push({ species: e.target.value || null })}>
              <option value="">Any</option>
              {(kind === "TRAINING" ? (["DOG"] as const) : SPECIES).map((s) => (
                <option key={s} value={s}>
                  {SPECIES_PLURAL[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Checkbox
          label="Pickup and drop-off"
          checked={params.get("transport") === "true"}
          onChange={(e) => push({ transport: e.target.checked ? "true" : null })}
        />
        {kind === "TRAINING" && (
          <Checkbox
            label="Trainer comes to my home"
            checked={params.get("inHome") === "true"}
            onChange={(e) => push({ inHome: e.target.checked ? "true" : null })}
          />
        )}

        <Field label="Sort">
          {({ id }) => (
            <Select id={id} value={params.get("sort") ?? "recommended"} onChange={(e) => push({ sort: e.target.value })}>
              <option value="recommended">Recommended</option>
              <option value="rating">Highest rated</option>
              <option value="price">Lowest price</option>
              {nearMe && <option value="distance">Nearest</option>}
            </Select>
          )}
        </Field>
      </div>

      <p className="text-xs text-fg-subtle tabular">
        {resultCount} {resultCount === 1 ? "result" : "results"}
      </p>
    </Card>
  );
}
