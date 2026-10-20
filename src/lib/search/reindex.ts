import "server-only";
import type { PrismaClient } from "@prisma/client";
import { buildSearchText, speciesSearchWords } from "@/lib/search/text";
import { parseJsonRecord } from "@/lib/json";

/**
 * Rebuilds every stored search haystack from its source columns.
 *
 * The haystack is derived data, so a change to `normalizeSearchText` — such as
 * the one that stopped it deleting every Arabic letter — needs a backfill, and
 * this is it. The field lists match what the services write on create and
 * update. Safe to run at any time; it only rewrites derived columns.
 */
export async function rebuildSearchText(db: PrismaClient): Promise<Record<string, number>> {
  const counts = { listings: 0, products: 0, shops: 0, clinics: 0 };

  const listings = await db.listing.findMany({
    select: {
      id: true, title: true, description: true, city: true, region: true, country: true,
      pet: { select: { name: true, species: true, breedText: true, breed: { select: { name: true } } } },
    },
  });
  for (const l of listings) {
    await db.listing.update({
      where: { id: l.id },
      data: {
        searchText: buildSearchText(
          l.title, l.description, l.pet.name, speciesSearchWords(l.pet.species),
          l.pet.breed?.name, l.pet.breedText, l.city, l.region, l.country,
        ),
      },
    });
    counts.listings++;
  }

  const products = await db.product.findMany({
    select: { id: true, title: true, description: true, brand: true, attributes: true },
  });
  for (const p of products) {
    const attributes = Object.values(parseJsonRecord(p.attributes)).filter((v) => typeof v === "string").join(" ");
    await db.product.update({
      where: { id: p.id },
      data: { searchText: buildSearchText(p.title, p.description, p.brand, attributes) },
    });
    counts.products++;
  }

  const shops = await db.shop.findMany({ select: { id: true, name: true, description: true, city: true, country: true } });
  for (const s of shops) {
    await db.shop.update({
      where: { id: s.id },
      data: { searchText: buildSearchText(s.name, s.description, s.city, s.country) },
    });
    counts.shops++;
  }

  const clinics = await db.clinic.findMany({
    select: { id: true, name: true, description: true, city: true, region: true, country: true },
  });
  for (const c of clinics) {
    await db.clinic.update({
      where: { id: c.id },
      data: { searchText: buildSearchText(c.name, c.description, c.city, c.region, c.country) },
    });
    counts.clinics++;
  }

  return counts;
}
