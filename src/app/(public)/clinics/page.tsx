import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Stethoscope, MapPin, Star, Siren, Home, BadgeCheck } from "lucide-react";
import { searchClinics } from "@/lib/services/vet.service";
import { formatMoney, formatRating } from "@/lib/money";
import { formatDistance } from "@/lib/utils";
import { Card, Badge, EmptyState, PageHeader } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { ClinicFilters } from "@/components/clinics/clinic-filters";
import { Pagination } from "@/components/ui/pagination";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const raw = await searchParams;
  const city = typeof raw.city === "string" ? raw.city : undefined;
  const emergency = raw.emergency === "true";

  const title = emergency
    ? `Emergency vets${city ? ` in ${city}` : ""}`
    : `Veterinary clinics${city ? ` in ${city}` : ""}`;

  return {
    title,
    description: `Find and book ${emergency ? "emergency " : ""}veterinary care${city ? ` in ${city}` : ""}. Real availability, transparent prices, and results recorded straight into your pet's health timeline.`,
    alternates: { canonical: city ? `/clinics?city=${encodeURIComponent(city)}` : "/clinics" },
  };
}

export default async function ClinicsPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const one = (key: string) => {
    const value = raw[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const num = (key: string) => {
    const value = Number(one(key));
    return Number.isFinite(value) ? value : undefined;
  };

  const results = await searchClinics({
    query: one("q"),
    city: one("city"),
    country: one("country"),
    lat: num("lat"),
    lng: num("lng"),
    radiusKm: num("radius") ?? (num("lat") != null ? 50 : undefined),
    category: one("category"),
    emergency: one("emergency") === "true",
    homeVisits: one("homeVisits") === "true",
    maxPriceCents: num("maxPrice") != null ? num("maxPrice")! * 100 : undefined,
    sort: one("sort") as "relevance" | "rating" | "distance" | "price" | undefined,
    page: num("page") ?? 1,
    limit: 20,
  });

  const pages = Math.max(1, Math.ceil(results.total / results.limit));

  return (
    <div className="container-page py-8 lg:py-12">
      <PageHeader
        eyebrow="Veterinary"
        title="Find a vet"
        description="Book a real slot from the clinic's own calendar. Anything the vet records lands in your pet's health timeline as a verified entry."
      />

      <div className="mt-8 grid gap-8 lg:grid-cols-[16rem_1fr]">
        <div className="lg:sticky lg:top-24 lg:h-fit">
          <ClinicFilters resultCount={results.total} />
        </div>

        <div className="min-w-0">
          <p className="mb-4 text-sm text-fg-muted tabular">
            {results.total === 0
              ? "No clinics found"
              : `${results.total} ${results.total === 1 ? "clinic" : "clinics"}`}
          </p>

          {results.items.length === 0 ? (
            <EmptyState
              icon={<Stethoscope className="size-6" aria-hidden />}
              title="No clinics match those filters"
              description="Try widening the distance or clearing a filter. We are adding clinics continuously."
              action={
                <div className="flex flex-wrap justify-center gap-3">
                  <ButtonLink href="/clinics" variant="outline">
                    Clear filters
                  </ButtonLink>
                  <ButtonLink href="/for-clinics">Run a clinic? List it</ButtonLink>
                </div>
              }
            />
          ) : (
            <>
              <ul className="space-y-3">
                {results.items.map((clinic) => (
                  <li key={clinic.id}>
                    <Card as="article" interactive className="overflow-hidden">
                      <div className="flex flex-col sm:flex-row">
                        <Link
                          href={`/clinics/${clinic.slug}`}
                          className="relative aspect-card w-full shrink-0 bg-bg-sunken sm:aspect-square sm:w-40"
                        >
                          {clinic.bannerUrl || clinic.logoUrl ? (
                            <Image
                              src={clinic.bannerUrl ?? clinic.logoUrl!}
                              alt=""
                              fill
                              sizes="160px"
                              className="object-cover"
                            />
                          ) : (
                            <span className="flex size-full items-center justify-center text-fg-subtle">
                              <Stethoscope className="size-8" aria-hidden />
                            </span>
                          )}
                        </Link>

                        <div className="min-w-0 flex-1 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <Link href={`/clinics/${clinic.slug}`}>
                                <h2 className="font-display text-lg font-semibold text-fg hover:underline">
                                  {clinic.name}
                                </h2>
                              </Link>
                              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
                                <span className="flex items-center gap-1">
                                  <MapPin className="size-3.5" aria-hidden />
                                  {clinic.distanceKm != null
                                    ? formatDistance(clinic.distanceKm)
                                    : [clinic.city, clinic.country].filter(Boolean).join(", ")}
                                </span>
                                {clinic.ratingCount > 0 && (
                                  <span className="flex items-center gap-1">
                                    <Star
                                      className="size-3.5 fill-[var(--warning)] text-[var(--warning)]"
                                      aria-hidden
                                    />
                                    <span className="tabular">
                                      {formatRating(clinic.ratingAvgBps)}
                                    </span>
                                    <span className="text-fg-subtle">({clinic.ratingCount})</span>
                                  </span>
                                )}
                              </p>
                            </div>

                            <div className="flex shrink-0 flex-wrap gap-1.5">
                              {clinic.verifiedAt && (
                                <Badge
                                  tone="success"
                                  size="sm"
                                  icon={<BadgeCheck className="size-3" aria-hidden />}
                                >
                                  Verified
                                </Badge>
                              )}
                              {clinic.emergencyServices && (
                                <Badge tone="danger" size="sm" icon={<Siren className="size-3" aria-hidden />}>
                                  Emergency
                                </Badge>
                              )}
                              {clinic.homeVisits && (
                                <Badge tone="neutral" size="sm" icon={<Home className="size-3" aria-hidden />}>
                                  Home visits
                                </Badge>
                              )}
                            </div>
                          </div>

                          {clinic.description && (
                            <p className="mt-2 line-clamp-2 text-sm text-fg-muted">
                              {clinic.description}
                            </p>
                          )}

                          {clinic.services.length > 0 && (
                            <ul className="mt-3 flex flex-wrap gap-1.5">
                              {clinic.services.map((service) => (
                                <li key={service.id}>
                                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-fg-muted">
                                    {service.name}
                                    <span className="font-semibold tabular text-fg">
                                      {formatMoney(service.priceCents, service.currency)}
                                    </span>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}

                          <div className="mt-3">
                            <ButtonLink href={`/clinics/${clinic.slug}`} size="sm">
                              See availability
                            </ButtonLink>
                          </div>
                        </div>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>

              <Pagination page={results.page} pages={pages} className="mt-10" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
