"use client";

import { SearchBar } from "@/components/shell/search-bar";

/**
 * The hero search.
 *
 * A thin wrapper so the landing page reuses the header's search — including its
 * natural-language parsing — at a larger size, rather than duplicating it.
 */
export function HeroSearch() {
  return (
    <div className="[&_button[aria-label=Search]]:size-10 [&_input]:h-14 [&_input]:pl-12 [&_input]:pr-14 [&_input]:text-base [&_input]:shadow-[var(--shadow-card)]">
      <SearchBar placeholder="Describe your dream pet…" />
    </div>
  );
}
