"use client";

import { useMemo, useState } from "react";
import { Search, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n/i18n-provider";

export interface HelpArticle {
  id: string;
  category: string;
  question: string;
  answer: string[];
}

/**
 * Client-side filtering over a fixed set of articles.
 *
 * The corpus is small enough that shipping it and filtering in the browser is
 * both faster and more honest than a search endpoint that would do the same
 * substring match over a round trip.
 */
export function HelpArticles({ articles }: { articles: HelpArticle[] }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const categories = useMemo(
    () => Array.from(new Set(articles.map((a) => a.category))),
    [articles],
  );

  const results = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return articles.filter((article) => {
      if (category && article.category !== category) return false;
      if (!terms.length) return true;
      const haystack = `${article.question} ${article.answer.join(" ")} ${article.category}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [articles, query, category]);

  return (
    <div>
      <div className="relative">
        <Search
          className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("Search help — escrow, refund, verification…")}
          aria-label={t("Search help articles")}
          className="ps-10"
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={t("Filter by category")}>
        <button
          type="button"
          onClick={() => setCategory(null)}
          aria-pressed={category === null}
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            category === null
              ? "border-transparent bg-brand text-brand-fg"
              : "border-[var(--border)] text-fg-muted hover:border-[var(--border-strong)] hover:text-fg",
          )}
        >
          {t("All")}
        </button>
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(category === c ? null : c)}
            aria-pressed={category === c}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              category === c
                ? "border-transparent bg-brand text-brand-fg"
                : "border-[var(--border)] text-fg-muted hover:border-[var(--border-strong)] hover:text-fg",
            )}
          >
            {c}
          </button>
        ))}
      </div>

      <p className="mt-4 text-xs text-fg-subtle" role="status" aria-live="polite">
        {query
          ? t.plural(results.length, { one: "{count} article matching “{query}”", other: "{count} articles matching “{query}”" }, { query })
          : t.plural(results.length, { one: "{count} article", other: "{count} articles" })}
      </p>

      {results.length === 0 ? (
        <p className="mt-4 rounded-[var(--radius-card)] border border-dashed border-[var(--border-strong)] px-5 py-10 text-center text-sm text-fg-muted">
          {t("Nothing matches that. Send us a message below and a person will answer.")}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--border)] overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border)] bg-bg-elevated">
          {results.map((article) => {
            const expanded = open === article.id;
            return (
              <li key={article.id}>
                <h3>
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : article.id)}
                    aria-expanded={expanded}
                    aria-controls={`answer-${article.id}`}
                    className="flex w-full items-start justify-between gap-4 px-5 py-4 text-start hover:bg-bg-sunken"
                  >
                    <span className="min-w-0">
                      <span className="block text-[15px] font-medium text-fg">
                        {article.question}
                      </span>
                      <span className="mt-0.5 block text-xs text-fg-subtle">{article.category}</span>
                    </span>
                    <ChevronDown
                      className={cn(
                        "mt-0.5 size-4 shrink-0 text-fg-subtle transition-transform",
                        expanded && "rotate-180",
                      )}
                      aria-hidden
                    />
                  </button>
                </h3>
                {expanded && (
                  <div id={`answer-${article.id}`} className="space-y-2.5 px-5 pb-5">
                    {article.answer.map((paragraph, i) => (
                      <p key={i} className="text-sm leading-relaxed text-fg-muted">
                        {paragraph}
                      </p>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
