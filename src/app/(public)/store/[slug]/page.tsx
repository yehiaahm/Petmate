import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Truck, BadgeCheck, Star, Package } from "lucide-react";
import { getProductBySlug, searchProducts } from "@/lib/services/commerce.service";
import { listReviews } from "@/lib/services/review.service";
import { getAuth } from "@/lib/auth/session";
import { formatRating } from "@/lib/money";
import { parseJsonRecord } from "@/lib/json";
import { clientEnv } from "@/lib/env";
import { Card, Breadcrumbs, DataRow, Alert } from "@/components/ui/primitives";
import { ProductGallery } from "@/components/store/product-gallery";
import { AddToCartButton } from "@/components/store/add-to-cart-button";
import { ReviewList, RatingSummary } from "@/components/reviews/review-list";
import { ReportButton } from "@/components/listings/report-button";
import { getI18n } from "@/lib/i18n/server";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug).catch(() => null);

  if (!product) return { title: "Product not found" };

  return {
    title: product.title,
    description: product.description.slice(0, 160),
    alternates: { canonical: `/store/${slug}` },
    openGraph: {
      type: "website",
      title: product.title,
      description: product.description.slice(0, 200),
      url: `${clientEnv.NEXT_PUBLIC_APP_URL}/store/${slug}`,
      images: product.images.map((i) => ({ url: i.url, alt: i.alt ?? product.title })),
    },
  };
}

export default async function ProductPage({ params }: { params: Params }) {
  const { t, fmt } = await getI18n();
  const { slug } = await params;
  const auth = await getAuth();

  const product = await getProductBySlug(slug).catch(() => null);
  if (!product) notFound();

  const [reviews, related] = await Promise.all([
    listReviews("PRODUCT", product.id, { limit: 5 }),
    searchProducts({
      categoryId: product.category?.id,
      limit: 4,
      sort: "popular",
    }),
  ]);

  const defaultVariant = product.variants.find((v) => v.isDefault) ?? product.variants[0];
  const outOfStock =
    product.trackInventory && (product.stock <= 0 || product.status === "OUT_OF_STOCK");
  const lowStock = product.trackInventory && product.stock > 0 && product.stock <= 5;
  const attributes = parseJsonRecord(product.attributes);
  const averageRating = product.ratingCount > 0 ? product.ratingAvgBps / 100 : 0;

  const freeShippingAt = product.shop.freeShippingThresholdCents;

  return (
    <div className="container-page py-6 lg:py-10">
      <Breadcrumbs
        items={[
          { label: "Store", href: "/store" },
          ...(product.category
            ? [{ label: product.category.name, href: `/store?category=${product.category.id}` }]
            : []),
          { label: product.title },
        ]}
      />

      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0">
          <ProductGallery images={product.images} title={product.title} />

          <div className="mt-6 lg:hidden">
            <ProductSummary
              product={product}
              defaultVariantId={defaultVariant?.id}
              outOfStock={outOfStock}
              lowStock={lowStock}
              signedIn={Boolean(auth)}
              freeShippingAt={freeShippingAt}
            />
          </div>

          <section className="mt-8">
            <h2 className="font-display text-xl font-semibold text-fg">{t("About this product")}</h2>
            <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-fg-muted">
              {product.description}
            </p>
          </section>

          {Object.keys(attributes).length > 0 && (
            <section className="mt-8">
              <h2 className="font-display text-xl font-semibold text-fg">{t("Details")}</h2>
              <Card className="mt-3 p-5">
                <dl className="divide-y divide-[var(--border)]">
                  {Object.entries(attributes).map(([key, value]) => (
                    <DataRow key={key} label={key} value={String(value)} />
                  ))}
                  {product.weightGrams && (
                    <DataRow label={t("Weight")} value={`${(product.weightGrams / 1000).toFixed(2)} kg`} />
                  )}
                </dl>
              </Card>
            </section>
          )}

          {reviews.total > 0 && (
            <section className="mt-8">
              <h2 className="font-display text-xl font-semibold text-fg">{t("Reviews")}</h2>
              <p className="mt-1 text-sm text-fg-muted">
                {t("Only buyers whose order was delivered can review this.")}
              </p>

              <Card className="mt-3 p-5">
                <RatingSummary
                  average={averageRating}
                  count={reviews.total}
                  distribution={reviews.distribution}
                />
              </Card>

              <div className="mt-3">
                <ReviewList reviews={reviews.items} />
              </div>
            </section>
          )}

          <div className="mt-8 flex justify-end">
            <ReportButton entityType="PRODUCT" entityId={product.id} label={t("Report this product")} />
          </div>
        </div>

        <aside className="hidden lg:sticky lg:top-24 lg:block lg:h-fit">
          <ProductSummary
            product={product}
            defaultVariantId={defaultVariant?.id}
            outOfStock={outOfStock}
            lowStock={lowStock}
            signedIn={Boolean(auth)}
            freeShippingAt={freeShippingAt}
          />
        </aside>
      </div>

      {related.items.filter((p) => p.id !== product.id).length > 0 && (
        <section className="mt-16">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">
            {t("You might also need")}
          </h2>
          <ul className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {related.items
              .filter((p) => p.id !== product.id)
              .slice(0, 4)
              .map((item) => (
                <li key={item.id}>
                  <Card as="article" interactive className="overflow-hidden">
                    <Link href={`/store/${item.slug}`} className="relative block aspect-square bg-bg-sunken">
                      {item.images[0] && (
                        <Image
                          src={item.images[0].url}
                          alt=""
                          fill
                          sizes="25vw"
                          className="object-cover"
                        />
                      )}
                    </Link>
                    <div className="p-3">
                      <Link href={`/store/${item.slug}`}>
                        <h3 className="line-clamp-2 text-sm font-medium text-fg hover:underline">
                          {item.title}
                        </h3>
                      </Link>
                      <p className="mt-1 font-semibold tabular text-fg">
                        {fmt.money(item.priceCents, item.currency)}
                      </p>
                    </div>
                  </Card>
                </li>
              ))}
          </ul>
        </section>
      )}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Product",
            name: product.title,
            description: product.description.slice(0, 400),
            image: product.images.map((i) => i.url),
            brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
            offers: {
              "@type": "Offer",
              price: (product.priceCents / 100).toFixed(2),
              priceCurrency: product.currency,
              availability: outOfStock
                ? "https://schema.org/OutOfStock"
                : "https://schema.org/InStock",
              url: `${clientEnv.NEXT_PUBLIC_APP_URL}/store/${product.slug}`,
              seller: { "@type": "Organization", name: product.shop.name },
            },
            ...(product.ratingCount > 0
              ? {
                  aggregateRating: {
                    "@type": "AggregateRating",
                    ratingValue: averageRating.toFixed(1),
                    reviewCount: product.ratingCount,
                  },
                }
              : {}),
          }),
        }}
      />
    </div>
  );
}

async function ProductSummary({
  product,
  defaultVariantId,
  outOfStock,
  lowStock,
  signedIn,
  freeShippingAt,
}: {
  product: Awaited<ReturnType<typeof getProductBySlug>>;
  defaultVariantId: string | undefined;
  outOfStock: boolean;
  lowStock: boolean;
  signedIn: boolean;
  freeShippingAt: number | null;
}) {
  const { t, fmt } = await getI18n();
  const discounted = product.compareAtCents && product.compareAtCents > product.priceCents;

  return (
    <Card className="p-5">
      {product.brand && (
        <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
          {product.brand}
        </p>
      )}

      <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-fg">
        {product.title}
      </h1>

      {product.ratingCount > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-fg-muted">
          <Star className="size-4 fill-[var(--warning)] text-[var(--warning)]" aria-hidden />
          <span className="font-semibold tabular text-fg">
            {formatRating(product.ratingAvgBps)}
          </span>
          <span>({t.plural(product.ratingCount, { one: "{count} review", other: "{count} reviews" })})</span>
        </p>
      )}

      <div className="mt-4 flex items-baseline gap-2">
        <span className="font-display text-3xl font-semibold tabular text-fg">
          {fmt.money(product.priceCents, product.currency)}
        </span>
        {discounted && (
          <span className="text-sm text-fg-subtle line-through tabular">
            {fmt.money(product.compareAtCents!, product.currency)}
          </span>
        )}
      </div>

      {lowStock && (
        <p className="mt-2 text-sm font-medium text-[var(--warning)]">
          {t("Only {count} left", { count: product.stock })}
        </p>
      )}

      <div className="mt-5">
        {outOfStock ? (
          <Alert tone="warning" title={t("Out of stock")}>
            {t("This item is not available right now.")}
          </Alert>
        ) : defaultVariantId ? (
          <AddToCartButton variantId={defaultVariantId} signedIn={signedIn} fullWidth />
        ) : null}
      </div>

      <div className="mt-5 space-y-2.5 border-t border-[var(--border)] pt-4 text-sm">
        <p className="flex items-start gap-2 text-fg-muted">
          <Truck className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {freeShippingAt
              ? t("{amount} shipping, free over {threshold}", {
                  amount: fmt.money(product.shop.flatShippingCents, product.currency),
                  threshold: fmt.money(freeShippingAt, product.currency),
                })
              : t("{amount} shipping", { amount: fmt.money(product.shop.flatShippingCents, product.currency) })}
          </span>
        </p>
        <p className="flex items-start gap-2 text-fg-muted">
          <Package className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{t("Dispatched by {shop}", { shop: product.shop.name })}</span>
        </p>
      </div>

      <div className="mt-4 flex items-center gap-3 border-t border-[var(--border)] pt-4">
        {product.shop.logoUrl && (
          <div className="relative size-10 shrink-0 overflow-hidden rounded-full bg-bg-sunken">
            <Image src={product.shop.logoUrl} alt="" fill sizes="40px" className="object-cover" />
          </div>
        )}
        <div className="min-w-0">
          <Link
            href={`/store?shopId=${product.shop.id}`}
            className="flex items-center gap-1.5 text-sm font-semibold text-fg hover:underline"
          >
            {product.shop.name}
            {product.shop.verifiedAt && (
              <BadgeCheck className="size-3.5 text-[var(--success)]" aria-label={t("Verified shop")} />
            )}
          </Link>
          <p className="text-xs text-fg-muted">
            {product.shop.orderCount > 0 && t.plural(product.shop.orderCount, { one: "{count} order", other: "{count} orders" })}
            {product.shop.ratingCount > 0 &&
              ` · ${formatRating(product.shop.ratingAvgBps)}★ (${product.shop.ratingCount})`}
          </p>
        </div>
      </div>
    </Card>
  );
}
