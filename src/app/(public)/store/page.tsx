import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ShoppingBag, Star, BadgeCheck } from "lucide-react";
import { searchProducts, listCategories } from "@/lib/services/commerce.service";
import { formatMoney, formatRating } from "@/lib/money";
import { Card, Badge, EmptyState, PageHeader } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { StoreFilters } from "@/components/store/store-filters";
import { AddToCartButton } from "@/components/store/add-to-cart-button";
import { getAuth } from "@/lib/auth/session";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const raw = await searchParams;
  const q = typeof raw.q === "string" ? raw.q : undefined;

  return {
    title: q ? `${q} — pet supplies` : "Pet store",
    description:
      "Food, health products, toys, beds and accessories from independent pet shops. Reviews come only from people who actually bought the item.",
    alternates: { canonical: "/store" },
  };
}

export default async function StorePage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const auth = await getAuth();

  const one = (key: string) => {
    const value = raw[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const num = (key: string) => {
    const value = Number(one(key));
    return Number.isFinite(value) ? value : undefined;
  };

  const [results, categories] = await Promise.all([
    searchProducts({
      query: one("q"),
      categoryId: one("category"),
      minPriceCents: num("minPrice") != null ? num("minPrice")! * 100 : undefined,
      maxPriceCents: num("maxPrice") != null ? num("maxPrice")! * 100 : undefined,
      inStockOnly: one("inStock") === "true",
      sort: one("sort") as
        | "relevance"
        | "price_asc"
        | "price_desc"
        | "newest"
        | "popular"
        | "rating"
        | undefined,
      page: num("page") ?? 1,
      limit: 24,
    }),
    listCategories(),
  ]);

  return (
    <div className="container-page py-8 lg:py-12">
      <PageHeader
        eyebrow="Store"
        title="Everything your pet needs"
        description="Independent shops, honest reviews. A review can only be left by someone whose order was actually delivered."
      />

      <div className="mt-8 grid gap-8 lg:grid-cols-[15rem_1fr]">
        <div className="lg:sticky lg:top-24 lg:h-fit">
          <StoreFilters categories={categories} resultCount={results.total} />
        </div>

        <div className="min-w-0">
          <p className="mb-4 text-sm text-fg-muted tabular">
            {results.total === 0
              ? "No products found"
              : `${results.total} ${results.total === 1 ? "product" : "products"}`}
          </p>

          {results.items.length === 0 ? (
            <EmptyState
              icon={<ShoppingBag className="size-6" aria-hidden />}
              title="Nothing matches those filters"
              description="Try clearing a filter, or browse a different category."
              action={
                <ButtonLink href="/store" variant="outline">
                  Clear filters
                </ButtonLink>
              }
            />
          ) : (
            <>
              <ul className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
                {results.items.map((product) => {
                  const outOfStock =
                    product.trackInventory &&
                    (product.stock <= 0 || product.status === "OUT_OF_STOCK");
                  const discounted =
                    product.compareAtCents && product.compareAtCents > product.priceCents;

                  return (
                    <li key={product.id}>
                      <Card as="article" interactive className="flex h-full flex-col overflow-hidden">
                        <Link
                          href={`/store/${product.slug}`}
                          className="relative aspect-square bg-bg-sunken"
                        >
                          {product.images[0] ? (
                            <Image
                              src={product.images[0].url}
                              alt={product.images[0].alt ?? product.title}
                              fill
                              sizes="(max-width: 640px) 50vw, 25vw"
                              className="object-cover"
                            />
                          ) : (
                            <span className="flex size-full items-center justify-center text-fg-subtle">
                              <ShoppingBag className="size-8" aria-hidden />
                            </span>
                          )}

                          {discounted && (
                            <span className="absolute start-2 top-2">
                              <Badge tone="accent" size="sm">
                                Save{" "}
                                {formatMoney(
                                  product.compareAtCents! - product.priceCents,
                                  product.currency,
                                )}
                              </Badge>
                            </span>
                          )}
                          {outOfStock && (
                            <span className="absolute inset-0 flex items-center justify-center bg-[var(--overlay)]">
                              <Badge tone="neutral">Out of stock</Badge>
                            </span>
                          )}
                        </Link>

                        <div className="flex flex-1 flex-col p-3.5">
                          <Link href={`/store/${product.slug}`}>
                            <h2 className="line-clamp-2 text-sm font-semibold leading-snug text-fg hover:underline">
                              {product.title}
                            </h2>
                          </Link>

                          {product.brand && (
                            <p className="mt-0.5 truncate text-xs text-fg-subtle">{product.brand}</p>
                          )}

                          {product.ratingCount > 0 && (
                            <p className="mt-1.5 flex items-center gap-1 text-xs text-fg-muted">
                              <Star
                                className="size-3 fill-[var(--warning)] text-[var(--warning)]"
                                aria-hidden
                              />
                              <span className="tabular">{formatRating(product.ratingAvgBps)}</span>
                              <span className="text-fg-subtle">({product.ratingCount})</span>
                            </p>
                          )}

                          <div className="mt-auto pt-3">
                            <p className="flex items-baseline gap-1.5">
                              <span className="font-display text-base font-semibold tabular text-fg">
                                {formatMoney(product.priceCents, product.currency)}
                              </span>
                              {discounted && (
                                <span className="text-xs text-fg-subtle line-through tabular">
                                  {formatMoney(product.compareAtCents!, product.currency)}
                                </span>
                              )}
                            </p>

                            <p className="mt-1 flex items-center gap-1 truncate text-xs text-fg-subtle">
                              {product.shop.verifiedAt && (
                                <BadgeCheck className="size-3 shrink-0 text-[var(--success)]" aria-hidden />
                              )}
                              <Link
                                href={`/store?shopId=${product.shop.id}`}
                                className="truncate hover:underline"
                              >
                                {product.shop.name}
                              </Link>
                            </p>

                            {product.variants[0] && !outOfStock && (
                              <div className="mt-2.5">
                                <AddToCartButton
                                  variantId={product.variants[0].id}
                                  signedIn={Boolean(auth)}
                                  compact
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ul>

              <Pagination page={results.page} pages={results.pages} className="mt-10" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
