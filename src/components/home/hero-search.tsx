"use client";

import { SearchBar } from "@/components/shell/search-bar";
import { useI18n } from "@/components/i18n/i18n-provider";

/**
 * The hero search.
 *
 * A thin wrapper so the landing page reuses the header's search — including its
 * natural-language parsing — at a larger size, rather than duplicating it.
 */
export function HeroSearch() {
  const { t } = useI18n();
  return (
    <div className="[&_input]:h-14 [&_input]:ps-12 [&_input]:text-base [&_input]:shadow-[var(--shadow-card)]">
      <SearchBar placeholder={t("Describe the pet you are looking for…")} />
    </div>
  );
}
