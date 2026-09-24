import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import {
  Stethoscope,
  MapPin,
  Siren,
  Home,
  BadgeCheck,
  Clock,
  Star,
} from "lucide-react";
import { db } from "@/lib/db";
import { getAuth } from "@/lib/auth/session";
import { getClinicBySlug } from "@/lib/services/vet.service";
import { listReviews } from "@/lib/services/review.service";
import { formatMoney, formatRating } from "@/lib/money";
import { splitTags } from "@/lib/utils";
import { clientEnv } from "@/lib/env";
import { Card, Badge, Breadcrumbs, DataRow, Avatar } from "@/components/ui/primitives";
import { BookingPanel } from "@/components/clinics/booking-panel";
import { ReviewList, RatingSummary } from "@/components/reviews/review-list";
import { ReportButton } from "@/components/listings/report-button";
import { SERVICE_CATEGORY_LABEL, type ServiceCategory } from "@/lib/constants";

type Params = Promise<{ slug: string }>;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h >= 12 ? "pm" : "am";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${period}` : `${hour12}:${String(m).padStart(2, "0")}${period}`;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const clinic = await db.clinic.findFirst({
    where: { slug, status: "ACTIVE", deletedAt: null },
    select: { name: true, description: true, city: true, country: true, logoUrl: true },
  });

  if (!clinic) return { title: "Clinic not found" };

  const location = [clinic.city, clinic.country].filter(Boolean).join(", ");

  return {
    title: `${clinic.name}${location ? ` — ${location}` : ""}`,
    description:
      clinic.description?.slice(0, 160) ??
      `Book an appointment at ${clinic.name}${location ? ` in ${location}` : ""} on PetMate.`,
    alternates: { canonical: `/clinics/${slug}` },
    openGraph: {
      type: "website",
      title: clinic.name,
      description: clinic.description?.slice(0, 200) ?? undefined,
      url: `${clientEnv.NEXT_PUBLIC_APP_URL}/clinics/${slug}`,
      images: clinic.logoUrl ? [{ url: clinic.logoUrl }] : undefined,
    },
  };
}

export default async function ClinicPage({ params }: { params: Params }) {
  const { slug } = await params;
  const auth = await getAuth();

  const clinic = await getClinicBySlug(slug).catch(() => null);
  if (!clinic) notFound();

  const [reviews, pets] = await Promise.all([
    listReviews("CLINIC", clinic.id, { limit: 5 }),
    auth
      ? db.pet.findMany({
          where: { ownerId: auth.user.id, deletedAt: null, status: { notIn: ["DECEASED"] } },
          select: { id: true, name: true, species: true },
          orderBy: { name: "asc" },
        })
      : [],
  ]);

  const averageRating = clinic.ratingCount > 0 ? clinic.ratingAvgBps / 100 : 0;

  return (
    <div className="container-page py-6 lg:py-10">
      <Breadcrumbs
        items={[
          { label: "Vets", href: "/clinics" },
          ...(clinic.city ? [{ label: clinic.city, href: `/clinics?city=${encodeURIComponent(clinic.city)}` }] : []),
          { label: clinic.name },
        ]}
      />

      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0">
          <div className="relative aspect-card overflow-hidden rounded-[var(--radius-panel)] bg-bg-sunken">
            {clinic.bannerUrl || clinic.logoUrl ? (
              <Image
                src={clinic.bannerUrl ?? clinic.logoUrl!}
                alt=""
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 60vw"
                className="object-cover"
              />
            ) : (
              <span className="flex size-full items-center justify-center text-fg-subtle">
                <Stethoscope className="size-12" aria-hidden />
              </span>
            )}
          </div>

          <div className="mt-6">
            <div className="flex flex-wrap items-center gap-2">
              {clinic.verifiedAt && (
                <Badge tone="success" icon={<BadgeCheck className="size-3" aria-hidden />}>
                  Licence verified
                </Badge>
              )}
              {clinic.emergencyServices && (
                <Badge tone="danger" icon={<Siren className="size-3" aria-hidden />}>
                  Emergency services
                </Badge>
              )}
              {clinic.homeVisits && (
                <Badge tone="neutral" icon={<Home className="size-3" aria-hidden />}>
                  Home visits
                </Badge>
              )}
              {clinic.acceptsWalkIns && <Badge tone="neutral">Walk-ins accepted</Badge>}
            </div>

            <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
              {clinic.name}
            </h1>

            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-fg-muted">
              <span className="flex items-center gap-1.5">
                <MapPin className="size-4" aria-hidden />
                {[clinic.addressLine, clinic.city, clinic.country].filter(Boolean).join(", ")}
              </span>
              {clinic.ratingCount > 0 && (
                <span className="flex items-center gap-1.5">
                  <Star className="size-4 fill-[var(--warning)] text-[var(--warning)]" aria-hidden />
                  <span className="font-semibold tabular text-fg">
                    {formatRating(clinic.ratingAvgBps)}
                  </span>
                  <span>({clinic.ratingCount} reviews)</span>
                </span>
              )}
              {clinic.bookingCount > 0 && (
                <span className="tabular">{clinic.bookingCount} bookings</span>
              )}
            </div>
          </div>

          {clinic.description && (
            <section className="mt-6">
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-fg-muted">
                {clinic.description}
              </p>
            </section>
          )}

          <section className="mt-8">
            <h2 className="font-display text-xl font-semibold text-fg">Services and prices</h2>
            <p className="mt-1 text-sm text-fg-muted">
              Prices are what you pay. No booking fee is added at checkout.
            </p>

            {clinic.services.length === 0 ? (
              <Card className="mt-3 p-5 text-sm text-fg-muted">
                This clinic has not published its services yet. Contact them directly.
              </Card>
            ) : (
              <ul className="mt-3 space-y-2">
                {clinic.services.map((service) => (
                  <li key={service.id}>
                    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-fg">{service.name}</h3>
                        <p className="mt-0.5 text-xs text-fg-muted">
                          {SERVICE_CATEGORY_LABEL[service.category as ServiceCategory]} ·{" "}
                          {service.durationMinutes} min
                          {service.species && ` · ${splitTags(service.species).join(", ")}`}
                        </p>
                        {service.description && (
                          <p className="mt-1.5 text-sm text-fg-muted">{service.description}</p>
                        )}
                      </div>
                      <p className="shrink-0 font-display text-lg font-semibold tabular text-fg">
                        {formatMoney(service.priceCents, service.currency)}
                      </p>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {clinic.vets.length > 0 && (
            <section className="mt-8">
              <h2 className="font-display text-xl font-semibold text-fg">The team</h2>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {clinic.vets.map((vet) => (
                  <li key={vet.id}>
                    <Card className="flex gap-3 p-4">
                      <Avatar src={vet.user.avatarUrl} name={vet.user.name} size="md" />
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                          {vet.user.name}
                          {vet.licenseVerifiedAt && (
                            <BadgeCheck
                              className="size-3.5 text-[var(--success)]"
                              aria-label="Licence verified"
                            />
                          )}
                        </p>
                        {vet.specialties && (
                          <p className="mt-0.5 text-xs text-fg-muted">
                            {splitTags(vet.specialties).join(" · ")}
                          </p>
                        )}
                        {vet.yearsExperience != null && (
                          <p className="text-xs text-fg-subtle">
                            {vet.yearsExperience} years experience
                          </p>
                        )}
                        {vet.bio && (
                          <p className="mt-1.5 text-xs leading-relaxed text-fg-muted">{vet.bio}</p>
                        )}
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {clinic.hours.length > 0 && (
            <section className="mt-8">
              <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-fg">
                <Clock className="size-4 text-brand" aria-hidden />
                Opening hours
              </h2>
              <Card className="mt-3 p-5">
                <dl className="divide-y divide-[var(--border)]">
                  {WEEKDAYS.map((day, index) => {
                    const hours = clinic.hours.find((h) => h.weekday === index);
                    return (
                      <DataRow
                        key={day}
                        label={day}
                        value={
                          hours ? (
                            <span className="tabular">
                              {formatMinutes(hours.startMinute)} – {formatMinutes(hours.endMinute)}
                            </span>
                          ) : (
                            <span className="text-fg-subtle">Closed</span>
                          )
                        }
                      />
                    );
                  })}
                </dl>
              </Card>
            </section>
          )}

          {reviews.total > 0 && (
            <section className="mt-8">
              <h2 className="font-display text-xl font-semibold text-fg">Reviews</h2>
              <p className="mt-1 text-sm text-fg-muted">
                Only people who completed an appointment here can leave one.
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
            <ReportButton entityType="CLINIC" entityId={clinic.id} label="Report this clinic" />
          </div>
        </div>

        <aside className="lg:sticky lg:top-24 lg:h-fit">
          <BookingPanel
            clinicId={clinic.id}
            clinicName={clinic.name}
            services={clinic.services.map((s) => ({
              id: s.id,
              name: s.name,
              priceCents: s.priceCents,
              currency: s.currency,
              durationMinutes: s.durationMinutes,
              category: s.category,
            }))}
            pets={pets}
            signedIn={Boolean(auth)}
            emailVerified={auth?.user.emailVerified ?? false}
            cancellationHours={clinic.cancellationHours}
            bookingLeadHours={clinic.bookingLeadHours}
            phone={clinic.phone}
            website={clinic.website}
          />
        </aside>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "VeterinaryCare",
            name: clinic.name,
            description: clinic.description ?? undefined,
            url: `${clientEnv.NEXT_PUBLIC_APP_URL}/clinics/${clinic.slug}`,
            telephone: clinic.phone ?? undefined,
            address: {
              "@type": "PostalAddress",
              streetAddress: clinic.addressLine ?? undefined,
              addressLocality: clinic.city ?? undefined,
              addressRegion: clinic.region ?? undefined,
              addressCountry: clinic.country ?? undefined,
              postalCode: clinic.postalCode ?? undefined,
            },
            ...(clinic.lat != null && clinic.lng != null
              ? { geo: { "@type": "GeoCoordinates", latitude: clinic.lat, longitude: clinic.lng } }
              : {}),
            ...(clinic.ratingCount > 0
              ? {
                  aggregateRating: {
                    "@type": "AggregateRating",
                    ratingValue: averageRating.toFixed(1),
                    reviewCount: clinic.ratingCount,
                  },
                }
              : {}),
          }),
        }}
      />
    </div>
  );
}
