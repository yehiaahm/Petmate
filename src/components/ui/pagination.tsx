"use client";

import Link from "next/link";
import { useSearchParams, usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Pagination.
 *
 * Real anchors with real hrefs, not buttons that call `router.push`. Search
 * engines can follow them, and a person can middle-click page 3.
 */
export function Pagination({
  page,
  pages,
  className,
}: {
  page: number;
  pages: number;
  className?: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();

  if (pages <= 1) return null;

  function hrefFor(target: number) {
    const next = new URLSearchParams(params.toString());
    if (target <= 1) next.delete("page");
    else next.set("page", String(target));
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  // A compact window with ellipses: 1 … 4 5 [6] 7 8 … 20
  const window = new Set<number>([1, pages, page, page - 1, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((n) => window.add(n));
  if (page >= pages - 2) [pages - 1, pages - 2, pages - 3].forEach((n) => window.add(n));

  const visible = [...window].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);

  return (
    <nav aria-label="Pagination" className={cn("flex items-center justify-center gap-1", className)}>
      {page > 1 ? (
        <Link
          href={hrefFor(page - 1)}
          rel="prev"
          className="inline-flex h-10 items-center gap-1 rounded-[var(--radius-field)] border border-[var(--border-strong)] px-3 text-sm font-medium text-fg transition-colors hover:bg-bg-sunken"
        >
          <ChevronLeft className="rtl:-scale-x-100 size-4" aria-hidden />
          <span className="hidden sm:inline">Previous</span>
        </Link>
      ) : (
        <span
          className="inline-flex h-10 items-center gap-1 rounded-[var(--radius-field)] border border-[var(--border)] px-3 text-sm text-fg-subtle"
          aria-disabled="true"
        >
          <ChevronLeft className="rtl:-scale-x-100 size-4" aria-hidden />
          <span className="hidden sm:inline">Previous</span>
        </span>
      )}

      <ol className="flex items-center gap-1">
        {visible.map((target, index) => {
          const previous = visible[index - 1];
          const gap = previous != null && target - previous > 1;

          return (
            <li key={target} className="flex items-center gap-1">
              {gap && (
                <span className="px-1 text-fg-subtle" aria-hidden>
                  …
                </span>
              )}
              <Link
                href={hrefFor(target)}
                aria-current={target === page ? "page" : undefined}
                aria-label={`Page ${target}`}
                className={cn(
                  "inline-flex size-10 items-center justify-center rounded-[var(--radius-field)] text-sm font-medium tabular transition-colors",
                  target === page
                    ? "bg-brand text-brand-fg"
                    : "text-fg-muted hover:bg-bg-sunken hover:text-fg",
                )}
              >
                {target}
              </Link>
            </li>
          );
        })}
      </ol>

      {page < pages ? (
        <Link
          href={hrefFor(page + 1)}
          rel="next"
          className="inline-flex h-10 items-center gap-1 rounded-[var(--radius-field)] border border-[var(--border-strong)] px-3 text-sm font-medium text-fg transition-colors hover:bg-bg-sunken"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="rtl:-scale-x-100 size-4" aria-hidden />
        </Link>
      ) : (
        <span
          className="inline-flex h-10 items-center gap-1 rounded-[var(--radius-field)] border border-[var(--border)] px-3 text-sm text-fg-subtle"
          aria-disabled="true"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="rtl:-scale-x-100 size-4" aria-hidden />
        </span>
      )}
    </nav>
  );
}
