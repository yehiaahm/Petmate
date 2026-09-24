"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select, Checkbox } from "@/components/ui/field";
import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  _count: { products: number };
}

export function StoreFilters({
  categories,
  resultCount,
}: {
  categories: Category[];
  resultCount: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [minPrice, setMinPrice] = useState(params.get("minPrice") ?? "");
  const [maxPrice, setMaxPrice] = useState(params.get("maxPrice") ?? "");

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    next.delete("page");
    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  const parents = categories.filter((c) => !c.parentId);
  const activeCategory = params.get("category");
  const activeCount = ["category", "minPrice", "maxPrice", "inStock"].filter((k) =>
    params.get(k),
  ).length;

  const content = (
    <div className="space-y-5">
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-fg">Category</legend>
        <ul className="space-y-1">
          <li>
            <button
              type="button"
              onClick={() => update({ category: null })}
              className={cn(
                "w-full rounded-[var(--radius-field)] px-2.5 py-1.5 text-start text-sm transition-colors",
                !activeCategory ? "bg-brand-soft font-medium text-brand-soft-fg" : "text-fg-muted hover:bg-bg-sunken hover:text-fg",
              )}
            >
              All categories
            </button>
          </li>
          {parents.map((parent) => {
            const children = categories.filter((c) => c.parentId === parent.id);
            return (
              <li key={parent.id}>
                <button
                  type="button"
                  onClick={() => update({ category: parent.id })}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-[var(--radius-field)] px-2.5 py-1.5 text-start text-sm transition-colors",
                    activeCategory === parent.id
                      ? "bg-brand-soft font-medium text-brand-soft-fg"
                      : "text-fg-muted hover:bg-bg-sunken hover:text-fg",
                  )}
                >
                  <span className="truncate">{parent.name}</span>
                  {parent._count.products > 0 && (
                    <span className="shrink-0 text-xs tabular text-fg-subtle">
                      {parent._count.products}
                    </span>
                  )}
                </button>

                {children.some((c) => c.id === activeCategory) && (
                  <ul className="ms-3 mt-0.5 space-y-0.5 border-s border-[var(--border)] ps-2">
                    {children.map((child) => (
                      <li key={child.id}>
                        <button
                          type="button"
                          onClick={() => update({ category: child.id })}
                          className={cn(
                            "w-full rounded px-2 py-1 text-start text-xs transition-colors",
                            activeCategory === child.id
                              ? "font-medium text-brand"
                              : "text-fg-muted hover:text-fg",
                          )}
                        >
                          {child.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-fg">Price</legend>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="Min"
            aria-label="Minimum price"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            onBlur={() => update({ minPrice: minPrice || null })}
            onKeyDown={(e) => e.key === "Enter" && update({ minPrice: minPrice || null })}
          />
          <span className="text-fg-subtle" aria-hidden>
            –
          </span>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="Max"
            aria-label="Maximum price"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            onBlur={() => update({ maxPrice: maxPrice || null })}
            onKeyDown={(e) => e.key === "Enter" && update({ maxPrice: maxPrice || null })}
          />
        </div>
      </fieldset>

      <Checkbox
        label="In stock only"
        checked={params.get("inStock") === "true"}
        onChange={(e) => update({ inStock: e.target.checked ? "true" : null })}
      />

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-fg">Sort by</legend>
        <Select
          value={params.get("sort") ?? "popular"}
          onChange={(e) => update({ sort: e.target.value })}
          aria-label="Sort products"
        >
          <option value="popular">Most popular</option>
          <option value="newest">Newest</option>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
          <option value="rating">Highest rated</option>
        </Select>
      </fieldset>

      {activeCount > 0 && (
        <Button variant="ghost" fullWidth onClick={() => startTransition(() => router.push(pathname))}>
          Clear all filters
        </Button>
      )}
    </div>
  );

  return (
    <>
      <div className="lg:hidden">
        <Button variant="outline" fullWidth onClick={() => setMobileOpen(true)}>
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
              aria-label="Product filters"
              className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-[var(--radius-panel)] bg-bg pb-[env(safe-area-inset-bottom)]"
            >
              <div className="sticky top-0 flex items-center justify-between border-b border-[var(--border)] bg-bg px-4 py-3">
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
                  Show {resultCount} {resultCount === 1 ? "product" : "products"}
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
