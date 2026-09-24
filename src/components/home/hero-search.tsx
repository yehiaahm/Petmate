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
    <div className="[&_input]:h-14 [&_input]:ps-12 [&_input]:text-base [&_input]:shadow-[var(--shadow-card)]">
      <SearchBar placeholder="Describe the pet you are looking for…" />
    </div>
  );
}
