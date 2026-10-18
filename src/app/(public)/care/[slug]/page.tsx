import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BadgeCheck,
  BedDouble,
  CalendarClock,
  Check,
  Clock,
  GraduationCap,
  Home,
  KeyRound,
  MapPin,
  ShieldCheck,
  Sparkles,
  Star,
  Syringe,
  Truck,
} from "lucide-react";
import { db } from "@/lib/db";
import { getAuth } from "@/lib/auth/session";
import { getProviderBySlug } from "@/lib/services/care-provider.service";
import { listReviews } from "@/lib/services/review.service";
import { formatMoney, formatRating } from "@/lib/money";
import { splitTags } from "@/lib/utils";
import { clientEnv } from "@/lib/env";
import { WEEKDAYS, formatMinutes } from "@/lib/care/format";
import {
  CANCELLATION_POLICY_LABEL,
  CANCELLATION_POLICY_SUMMARY,
  SPECIES_PLURAL,
  TRAINING_FORMAT_LABEL,
  TRAINING_LEVEL_LABEL,
  type CancellationPolicy,
  type Species,
  type TrainingFormat,
  type TrainingLevel,
} from "@/lib/constants";
import { Badge, Breadcrumbs, Card, DataRow } from "@/components/ui/primitives";
import { ReviewList, RatingSummary } from "@/components/reviews/review-list";
import { ReportButton } from "@/components/listings/report-button";
import { BoardingBookingPanel } from "@/components/care/boarding-booking-panel";
import { TrainingBookingPanel } from "@/components/care/training-booking-panel";
import { MessageProvider } from "@/components/care/message-provider";

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const provider = await db.careProvider.findFirst({
    where: { slug, status: "ACTIVE", deletedAt: null },
    select: { name: true, tagline: true, description: true, city: true, country: true, bannerUrl: true, offersBoarding: true, offersTraining: true },
  });
  if (!provider) return { title: "Not found" };

  const what = [provider.offersBoarding && "pet hotel", provider.offersTraining && "dog training"].filter(Boolean).join(" and ");
  const location = [provider.city, provider.country].filter(Boolean).join(", ");
  return {
    title: `${provider.name}${location ? ` — ${what} in ${location}` : ""}`,
    description: (provider.tagline ?? provider.description ?? `Book ${what} with ${provider.name} on PetMate.`).slice(0, 160),
    alternates: { canonical: `/care/${slug}` },
    openGraph: {
      type: "website",
      title: provider.name,
      url: `${clientEnv.NEXT_PUBLIC_APP_URL}/care/${slug}`,
      images: provider.bannerUrl ? [{ url: provider.bannerUrl }] : undefined,
    },
  };
}

export default async function CareProviderPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ slug }, query, auth] = await Promise.all([params, searchParams, getAuth()]);

  const provider = await getProviderBySlug(slug).catch(() => null);
  if (!provider) notFound();

  const tabParam = typeof query.tab === "string" ? query.tab : undefined;
  const tab: "boarding" | "training" =
    provider.offersBoarding && provider.units.length > 0 && tabParam !== "training"
      ? "boarding"
      : provider.offersTraining && provider.programs.length > 0
        ? "training"
        : "boarding";

  const [reviews, pets] = await Promise.all([
    listReviews("CARE_PROVIDER", provider.id, { limit: 5 }),
    auth
      ? db.pet.findMany({
          where: { ownerId: auth.user.id, deletedAt: null, status: { notIn: ["DECEASED", "REHOMED"] } },
          select: { id: true, name: true, species: true },
          orderBy: { name: "asc" },
        })
      : [],
  ]);

  const amenities = splitTags(provider.amenities);
  const policy = provider.cancellationPolicy as CancellationPolicy;
  // Already public in the page's structured data; the booking map opens here.
  const providerLocation =
    provider.lat != null && provider.lng != null ? { lat: provider.lat, lng: provider.lng } : null;
  const average = provider.ratingCount > 0 ? provider.ratingAvgBps / 100 : 0;
  const both = provider.offersBoarding && provider.offersTraining && provider.units.length > 0 && provider.programs.length > 0;

  return (
    <div className="container-page py-6 lg:py-10">
      <Breadcrumbs
        items={[
          tab === "boarding" ? { label: "Pet hotels", href: "/boarding" } : { label: "Dog training", href: "/training" },
          ...(provider.city
            ? [{ label: provider.city, href: `/${tab === "boarding" ? "boarding" : "training"}?city=${encodeURIComponent(provider.city)}` }]
            : []),
          { label: provider.name },
        ]}
      />

      <div className="grid gap-8 lg:grid-cols-[1fr_24rem]">
        <div className="min-w-0">
          <div className="relative aspect-card overflow-hidden rounded-[var(--radius-panel)] bg-bg-sunken">
            {provider.bannerUrl || provider.logoUrl ? (
              <Image
                src={provider.bannerUrl ?? provider.logoUrl!}
                alt=""
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 60vw"
                className="object-cover"
              />
            ) : (
              <span className="flex size-full items-center justify-center text-fg-subtle">
                {tab === "boarding" ? <BedDouble className="size-12" aria-hidden /> : <GraduationCap className="size-12" aria-hidden />}
              </span>
            )}
          </div>

          <div className="mt-6">
            <div className="flex flex-wrap items-center gap-2">
              {provider.isOfficial && (
                <Badge tone="brand" icon={<Sparkles className="size-3" aria-hidden />}>
                  PetMate Official
                </Badge>
              )}
              {!provider.isOfficial && provider.verifiedAt && (
                <Badge tone="success" icon={<BadgeCheck className="size-3" aria-hidden />}>
                  Verified business
                </Badge>
              )}
              {provider.offersTransport && (
                <Badge tone="neutral" icon={<Truck className="size-3" aria-hidden />}>
                  Pickup & drop-off · {provider.transportRadiusKm} km
                </Badge>
              )}
              {provider.requiresVaccination && (
                <Badge tone="neutral" icon={<Syringe className="size-3" aria-hidden />}>
                  Vaccination required
                </Badge>
              )}
            </div>

            <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">{provider.name}</h1>
            {provider.tagline && <p className="mt-2 text-lg text-fg-muted">{provider.tagline}</p>}

            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-fg-muted">
              <span className="flex items-center gap-1.5">
                <MapPin className="size-4" aria-hidden />
                {[provider.addressLine, provider.city, provider.country].filter(Boolean).join(", ")}
              </span>
              {provider.ratingCount > 0 && (
                <span className="flex items-center gap-1.5">
                  <Star className="size-4 fill-[var(--warning)] text-[var(--warning)]" aria-hidden />
                  <span className="font-semibold tabular text-fg">{formatRating(provider.ratingAvgBps)}</span>
                  <span>({provider.ratingCount} reviews)</span>
                </span>
              )}
              {provider.bookingCount > 0 && <span className="tabular">{provider.bookingCount} bookings</span>}
            </div>
          </div>

          {both && (
            <nav aria-label="Services" className="mt-6 inline-flex rounded-[var(--radius-field)] border border-[var(--border)] bg-bg-sunken p-1">
              {(["boarding", "training"] as const).map((t) => (
                <Link
                  key={t}
                  href={`/care/${provider.slug}${t === "training" ? "?tab=training" : ""}`}
                  aria-current={tab === t ? "page" : undefined}
                  scroll={false}
                  className={
                    tab === t
                      ? "rounded-[calc(var(--radius-field)-2px)] bg-bg-elevated px-4 py-2 text-sm font-semibold text-fg shadow-[var(--shadow-subtle)]"
                      : "px-4 py-2 text-sm font-medium text-fg-muted hover:text-fg"
                  }
                >
                  {t === "boarding" ? "Pet hotel" : "Training"}
                </Link>
              ))}
            </nav>
          )}

          {provider.description && (
            <section className="mt-6">
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-fg-muted">{provider.description}</p>
            </section>
          )}

          {amenities.length > 0 && (
            <section className="mt-8">
              <h2 className="font-display text-xl font-semibold text-fg">What&rsquo;s included</h2>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {amenities.map((a) => (
                  <li key={a} className="flex items-center gap-2 text-sm text-fg">
                    <Check className="size-4 text-brand" aria-hidden />
                    {a}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {tab === "boarding" && provider.units.length > 0 && (
            <section className="mt-8">
              <h2 className="font-display text-xl font-semibold text-fg">Rooms</h2>
              <p className="mt-1 text-sm text-fg-muted">Nightly prices. Check-in from {formatMinutes(provider.checkInMinute)}, check-out by {formatMinutes(provider.checkOutMinute)}.</p>
              <ul className="mt-3 space-y-2">
                {provider.units.map((unit) => (
                  <li key={unit.id}>
                    <Card className="flex flex-col gap-3 overflow-hidden sm:flex-row">
                      {unit.photoUrl && (
                        <div className="relative aspect-card w-full shrink-0 bg-bg-sunken sm:aspect-square sm:w-32">
                          <Image src={unit.photoUrl} alt="" fill sizes="128px" className="object-cover" />
                        </div>
                      )}
                      <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-3 p-4">
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-fg">{unit.name}</h3>
                          <p className="mt-0.5 text-xs text-fg-muted">
                            {unit.species ? splitTags(unit.species).map((s) => SPECIES_PLURAL[s as Species] ?? s).join(", ") : "All pets"}
                            {unit.maxWeightKg != null && ` · up to ${unit.maxWeightKg} kg`}
                          </p>
                          {unit.description && <p className="mt-1.5 text-sm text-fg-muted">{unit.description}</p>}
                          {unit.amenities && <p className="mt-1.5 text-xs text-fg-subtle">{splitTags(unit.amenities).join(" · ")}</p>}
                        </div>
                        <p className="shrink-0 font-display text-lg font-semibold tabular text-fg">
                          {formatMoney(unit.nightlyCents, provider.currency)}
                          <span className="text-xs font-normal text-fg-muted"> /night</span>
                        </p>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {tab === "training" && provider.programs.length > 0 && (
            <section className="mt-8">
              <h2 className="font-display text-xl font-semibold text-fg">Programmes</h2>
              <p className="mt-1 text-sm text-fg-muted">One price for the whole programme. Notes from the trainer after every session.</p>
              <ul className="mt-3 space-y-2">
                {provider.programs.map((program) => (
                  <li key={program.id}>
                    <Card className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-wider text-brand">
                            {TRAINING_LEVEL_LABEL[program.level as TrainingLevel]}
                          </p>
                          <h3 className="mt-0.5 text-base font-semibold text-fg">{program.name}</h3>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-fg-muted">
                            <span className="inline-flex items-center gap-1">
                              <CalendarClock className="size-3.5" aria-hidden />
                              {program.sessionsCount} × {program.sessionMinutes} min, every {program.sessionIntervalDays === 7 ? "week" : `${program.sessionIntervalDays} days`}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Home className="size-3.5" aria-hidden />
                              {TRAINING_FORMAT_LABEL[program.format as TrainingFormat]}
                            </span>
                            {program.minAgeMonths ? <span>From {program.minAgeMonths} months</span> : null}
                          </p>
                        </div>
                        <p className="shrink-0 font-display text-lg font-semibold tabular text-fg">
                          {formatMoney(program.priceCents, provider.currency)}
                        </p>
                      </div>
                      {program.description && <p className="mt-2 text-sm text-fg-muted">{program.description}</p>}
                      {program.outcomes && (
                        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
                          {splitTags(program.outcomes).map((o) => (
                            <li key={o} className="flex items-start gap-2 text-sm text-fg">
                              <Check className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                              {o}
                            </li>
                          ))}
                        </ul>
                      )}
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {provider.offersTransport && (
            <section className="mt-8">
              <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-fg">
                <Truck className="size-5 text-brand" aria-hidden />
                How pickup and drop-off work
              </h2>
              <ol className="mt-3 grid gap-3 sm:grid-cols-3">
                {[
                  { icon: MapPin, title: "Pin your home", body: `Anywhere within ${provider.transportRadiusKm} km. The price is shown before you pay.` },
                  { icon: KeyRound, title: "Share your code", body: "When the driver sets off, a six-digit code appears on your booking. Give it only in person." },
                  { icon: ShieldCheck, title: "Handover confirmed", body: "The driver enters the code. Without it, the trip cannot be marked complete." },
                ].map((step, i) => (
                  <li key={step.title}>
                    <Card className="h-full p-4">
                      <step.icon className="size-5 text-brand" aria-hidden />
                      <p className="mt-2 text-sm font-semibold text-fg">
                        {i + 1}. {step.title}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-fg-muted">{step.body}</p>
                    </Card>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="mt-8 grid gap-4 sm:grid-cols-2">
            <Card className="p-5">
              <h2 className="flex items-center gap-2 text-base font-semibold text-fg">
                <ShieldCheck className="size-4 text-brand" aria-hidden />
                Cancellation: {CANCELLATION_POLICY_LABEL[policy]}
              </h2>
              <p className="mt-2 text-sm text-fg-muted">{CANCELLATION_POLICY_SUMMARY[policy]}</p>
              <p className="mt-2 text-xs text-fg-subtle">If {provider.name} cancels, you always get a full refund.</p>
            </Card>
            {tab === "training" && provider.hours.length > 0 ? (
              <Card className="p-5">
                <h2 className="flex items-center gap-2 text-base font-semibold text-fg">
                  <Clock className="size-4 text-brand" aria-hidden />
                  Training hours
                </h2>
                <dl className="mt-2 divide-y divide-[var(--border)]">
                  {WEEKDAYS.map((day, index) => {
                    const blocks = provider.hours.filter((h) => h.weekday === index);
                    return (
                      <DataRow
                        key={day}
                        label={day}
                        value={
                          blocks.length ? (
                            <span className="tabular">
                              {blocks.map((b) => `${formatMinutes(b.startMinute)}–${formatMinutes(b.endMinute)}`).join(", ")}
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
            ) : (
              <Card className="p-5">
                <h2 className="flex items-center gap-2 text-base font-semibold text-fg">
                  <Clock className="size-4 text-brand" aria-hidden />
                  Before you book
                </h2>
                <ul className="mt-2 space-y-1.5 text-sm text-fg-muted">
                  <li>Book at least {provider.bookingLeadHours} hours ahead.</li>
                  {provider.requiresVaccination && <li>Vaccinations must be on your pet&rsquo;s health record and valid for the whole stay.</li>}
                  <li>Your payment is held by PetMate and released after the stay.</li>
                </ul>
              </Card>
            )}
          </section>

          {reviews.total > 0 && (
            <section className="mt-8">
              <h2 className="font-display text-xl font-semibold text-fg">Reviews</h2>
              <p className="mt-1 text-sm text-fg-muted">Only owners who completed a booking here can leave one.</p>
              <Card className="mt-3 p-5">
                <RatingSummary average={average} count={reviews.total} distribution={reviews.distribution} />
              </Card>
              <div className="mt-3">
                <ReviewList reviews={reviews.items} />
              </div>
            </section>
          )}

          <div className="mt-8 flex flex-wrap items-start justify-between gap-4">
            {auth && auth.user.id !== provider.ownerUserId ? (
              <MessageProvider providerId={provider.id} providerName={provider.name} />
            ) : (
              <span />
            )}
            <ReportButton entityType="CARE_PROVIDER" entityId={provider.id} label="Report this business" />
          </div>
        </div>

        <aside className="lg:sticky lg:top-24 lg:h-fit">
          {tab === "boarding" && provider.units.length > 0 ? (
            <BoardingBookingPanel
              providerId={provider.id}
              providerName={provider.name}
              slug={provider.slug}
              currency={provider.currency}
              units={provider.units.map((u) => ({ id: u.id, name: u.name, nightlyCents: u.nightlyCents }))}
              pets={pets}
              signedIn={Boolean(auth)}
              emailVerified={auth?.user.emailVerified ?? false}
              checkInMinute={provider.checkInMinute}
              checkOutMinute={provider.checkOutMinute}
              offersTransport={provider.offersTransport}
              transportRadiusKm={provider.transportRadiusKm}
              providerLocation={providerLocation}
            />
          ) : provider.programs.length > 0 ? (
            <TrainingBookingPanel
              providerId={provider.id}
              providerName={provider.name}
              slug={provider.slug}
              currency={provider.currency}
              timezone={provider.timezone}
              programs={provider.programs.map((p) => ({
                id: p.id,
                name: p.name,
                priceCents: p.priceCents,
                format: p.format,
                sessionsCount: p.sessionsCount,
                sessionMinutes: p.sessionMinutes,
              }))}
              pets={pets}
              signedIn={Boolean(auth)}
              emailVerified={auth?.user.emailVerified ?? false}
              offersTransport={provider.offersTransport}
              transportRadiusKm={provider.transportRadiusKm}
              providerLocation={providerLocation}
            />
          ) : (
            <Card className="p-5 text-sm text-fg-muted">This business has not published anything bookable yet.</Card>
          )}
        </aside>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "LocalBusiness",
            name: provider.name,
            description: provider.description ?? provider.tagline ?? undefined,
            url: `${clientEnv.NEXT_PUBLIC_APP_URL}/care/${provider.slug}`,
            telephone: provider.phone ?? undefined,
            address: {
              "@type": "PostalAddress",
              streetAddress: provider.addressLine ?? undefined,
              addressLocality: provider.city ?? undefined,
              addressRegion: provider.region ?? undefined,
              addressCountry: provider.country ?? undefined,
            },
            ...(provider.lat != null && provider.lng != null
              ? { geo: { "@type": "GeoCoordinates", latitude: provider.lat, longitude: provider.lng } }
              : {}),
            ...(provider.ratingCount > 0
              ? { aggregateRating: { "@type": "AggregateRating", ratingValue: average.toFixed(1), reviewCount: provider.ratingCount } }
              : {}),
          }).replace(/</g, "\\u003c"),
        }}
      />
    </div>
  );
}
