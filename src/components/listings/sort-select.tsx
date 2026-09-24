"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function SortSelect({ hasLocation }: { hasLocation?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function change(value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === "relevance") next.delete("sort");
    else next.set("sort", value);
    next.delete("page");

    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  return (
    <label className={cn("flex items-center gap-2 text-sm", pending && "opacity-60")}>
      <ArrowUpDown className="size-4 text-fg-subtle" aria-hidden />
      <span className="sr-only">Sort results by</span>
      <select
        value={params.get("sort") ?? "relevance"}
        onChange={(e) => change(e.target.value)}
        className="h-9 cursor-pointer rounded-[var(--radius-field)] border border-[var(--border-strong)] bg-bg-elevated px-2.5 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
      >
        <option value="relevance">Best match</option>
        <option value="newest">Newest first</option>
        <option value="price_asc">Price: low to high</option>
        <option value="price_desc">Price: high to low</option>
        <option value="health">Best documented</option>
        {/* Only offered when a location is set, because otherwise it silently
            does nothing and the user thinks the sort is broken. */}
        {hasLocation && <option value="distance">Closest first</option>}
      </select>
    </label>
  );
}
