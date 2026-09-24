import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { clientEnv } from "@/lib/env";
import { PUBLIC_LISTING_STATUSES } from "@/lib/constants";

/**
 * Sitemap.
 *
 * Only pages worth indexing appear: live listings, active clinics, published
 * products, breed guides and the static marketing pages. A sold listing or a
 * suspended clinic is a dead result and is deliberately excluded.
 *
 * Capped so the file stays within the 50,000-URL limit. Past that it needs
 * splitting into a sitemap index — noted in docs/SEO.md.
 */
const BASE = clientEnv.NEXT_PUBLIC_APP_URL;

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [listings, clinics, products, breeds] = await Promise.all([
    db.listing.findMany({
      where: { status: { in: PUBLIC_LISTING_STATUSES }, deletedAt: null },
      select: { slug: true, updatedAt: true },
      orderBy: { publishedAt: "desc" },
      take: 10_000,
    }),
    db.clinic.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      select: { slug: true, updatedAt: true },
      take: 5_000,
    }),
    db.product.findMany({
      where: { status: { in: ["ACTIVE", "OUT_OF_STOCK"] }, deletedAt: null },
      select: { slug: true, updatedAt: true },
      orderBy: { publishedAt: "desc" },
      take: 10_000,
    }),
    db.breed.findMany({
      select: { slug: true },
      orderBy: { popularity: "desc" },
      take: 2_000,
    }),
  ]);

  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE, changeFrequency: "daily", priority: 1 },
    { url: `${BASE}/pets`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${BASE}/pets?intent=ADOPTION`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${BASE}/clinics`, changeFrequency: "daily", priority: 0.8 },
    { url: `${BASE}/store`, changeFrequency: "daily", priority: 0.8 },
    { url: `${BASE}/breeds`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE}/breeding`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE}/pricing`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/trust`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/about`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/for-clinics`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/terms`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/privacy`, changeFrequency: "yearly", priority: 0.3 },
  ];

  return [
    ...staticPages,
    ...listings.map((listing) => ({
      url: `${BASE}/pets/${listing.slug}`,
      lastModified: listing.updatedAt,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    ...clinics.map((clinic) => ({
      url: `${BASE}/clinics/${clinic.slug}`,
      lastModified: clinic.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...products.map((product) => ({
      url: `${BASE}/store/${product.slug}`,
      lastModified: product.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...breeds.map((breed) => ({
      url: `${BASE}/breeds/${breed.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
  ];
}
