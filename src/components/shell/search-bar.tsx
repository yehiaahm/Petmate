"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, ArrowRight, Sparkles } from "lucide-react";
import { api, qs } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface Suggestion {
  type: "breed" | "listing" | "clinic";
  label: string;
  sublabel: string;
  href: string;
}

/**
 * Search.
 *
 * Accepts a plain phrase and turns it into filters — "calm small dog near cairo
 * under 300" becomes species, temperament, city and price. The label under the
 * box always states which engine interpreted it, so a rule-based parse is never
 * dressed up as something cleverer.
 */
const EMPTY_SUGGESTIONS: Suggestion[] = [];

export function SearchBar({
  className,
  placeholder = "Search pets, breeds, clinics…",
  autoFocus,
  onNavigate,
}: {
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [interpreting, setInterpreting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // A query shorter than two characters has no suggestions by definition, so
  // that is derived during render rather than cleared by the effect below —
  // which would otherwise paint the previous query's list for one frame after
  // the box is emptied.
  const tooShort = value.trim().length < 2;
  const visibleSuggestions = tooShort ? EMPTY_SUGGESTIONS : suggestions;

  useEffect(() => {
    if (tooShort) return;

    const controller = new AbortController();
    // Debounced: typing should not fire a request per keystroke.
    const timer = setTimeout(async () => {
      try {
        const result = await api.get<{ suggestions: Suggestion[] }>(
          `/api/search${qs({ q: value, mode: "suggest" })}`,
          controller.signal,
        );
        setSuggestions(result.suggestions ?? []);
      } catch {
        setSuggestions([]);
      }
    }, 220);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, tooShort]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function runSearch() {
    const query = value.trim();
    if (!query) return;

    setInterpreting(true);
    setOpen(false);

    try {
      const { filters } = await api.post<{ filters: Record<string, unknown> }>("/api/search", {
        action: "parse",
        query,
      });

      const params = qs({
        q: filters.query ?? undefined,
        intent: filters.intent,
        species: filters.species,
        sex: filters.sex,
        minPrice: filters.minPriceCents != null ? Number(filters.minPriceCents) / 100 : undefined,
        maxPrice: filters.maxPriceCents != null ? Number(filters.maxPriceCents) / 100 : undefined,
        minAge: filters.minAgeMonths,
        maxAge: filters.maxAgeMonths,
        city: filters.city,
        vaccinated: filters.vaccinatedOnly,
        verified: filters.verifiedOnly,
      });

      router.push(`/pets${params}`);
    } catch {
      // A parse failure should never block the search: fall back to plain text.
      router.push(`/pets${qs({ q: query })}`);
    } finally {
      setInterpreting(false);
      onNavigate?.();
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlighted((i) => Math.min(i + 1, visibleSuggestions.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((i) => Math.max(i - 1, -1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const picked = visibleSuggestions[highlighted];
      if (picked) {
        router.push(picked.href);
        setOpen(false);
        onNavigate?.();
      } else {
        void runSearch();
      }
    } else if (event.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute start-3.5 top-1/2 size-[18px] -translate-y-1/2 text-fg-subtle"
          aria-hidden
        />
        <input
          ref={inputRef}
          type="search"
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
            setHighlighted(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label="Search PetMate"
          aria-expanded={open && visibleSuggestions.length > 0}
          aria-autocomplete="list"
          role="combobox"
          aria-controls="search-suggestions"
          className="h-11 w-full rounded-full border border-[var(--border-strong)] bg-bg-elevated ps-11 pe-11 text-[15px] text-fg placeholder:text-fg-subtle focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
        />
        <button
          type="button"
          onClick={() => void runSearch()}
          disabled={!value.trim() || interpreting}
          aria-label="Search"
          className="absolute end-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-brand text-brand-fg transition-colors hover:bg-brand-hover disabled:opacity-40"
        >
          {interpreting ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <ArrowRight className="rtl:-scale-x-100 size-4" aria-hidden />
          )}
        </button>
      </div>

      {open && (visibleSuggestions.length > 0 || !tooShort) && (
        <div
          id="search-suggestions"
          role="listbox"
          className="absolute start-0 end-0 top-full z-50 mt-2 overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-bg-elevated shadow-[var(--shadow-pop)]"
        >
          {visibleSuggestions.map((suggestion, index) => (
            <button
              key={`${suggestion.type}-${suggestion.href}`}
              type="button"
              role="option"
              aria-selected={index === highlighted}
              onMouseEnter={() => setHighlighted(index)}
              onClick={() => {
                router.push(suggestion.href);
                setOpen(false);
                onNavigate?.();
              }}
              className={cn(
                "flex w-full items-center gap-3 px-4 py-2.5 text-start transition-colors",
                index === highlighted ? "bg-bg-sunken" : "hover:bg-bg-sunken",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">{suggestion.label}</span>
                <span className="block truncate text-xs text-fg-muted">{suggestion.sublabel}</span>
              </span>
              <span className="shrink-0 rounded-full bg-bg-sunken px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
                {suggestion.type}
              </span>
            </button>
          ))}

          {value.trim().length >= 2 && (
            <button
              type="button"
              onClick={() => void runSearch()}
              className="flex w-full items-center gap-2.5 border-t border-[var(--border)] px-4 py-3 text-start text-sm text-fg-muted transition-colors hover:bg-bg-sunken"
            >
              <Sparkles className="size-4 shrink-0 text-brand" aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                Search for <span className="font-medium text-fg">{value.trim()}</span>
              </span>
              <kbd className="hidden shrink-0 rounded border border-[var(--border)] px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle sm:block">
                Enter
              </kbd>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
