import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BadgeCheck,
  CalendarDays,
  MapPin,
  ShieldCheck,
  Syringe,
  Stethoscope,
  Dna,
  Lock,
  Info,
} from "lucide-react";
import { db } from "@/lib/db";
import { getAuth } from "@/lib/auth/session";
import { recordListingView } from "@/lib/services/listing.service";
import { getPublicHealthSummary } from "@/lib/services/health.service";
import { getPublicTrust } from "@/lib/services/trust.service";
import { searchListings } from "@/lib/services/search.service";
import { formatMoney } from "@/lib/money";
import { formatAge, formatDate, splitTags, relativeTime } from "@/lib/utils";
import { clientEnv } from "@/lib/env";
import {
  SPECIES_LABEL,
  VERIFICATION_LEVEL_LABEL,
  trustTier,
  TRUST_TIER_LABEL,
  type Species,
  type VerificationLevel,
} from "@/lib/constants";
import { Badge, Card, Avatar, Alert, Breadcrumbs, DataRow, StatusPill } from "@/components/ui/primitives";
import { PhotoGallery } from "@/components/listings/photo-gallery";
import { ContactSellerCard } from "@/components/listings/contact-seller-card";
import { ReportButton } from "@/components/listings/report-button";
import { ListingCard, ListingGrid } from "@/components/listings/listing-card";
import { ReviewList } from "@/components/reviews/review-list";
import { listReviews } from "@/lib/services/review.service";

type Params = Promise<{ slug: string }>;

async function loadListing(slug: string) {
  return db.listing.findFirst({
    where: { slug, deletedAt: null },
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      intent: true,
      status: true,
      priceCents: true,
      adoptionFeeCents: true,
      studFeeCents: true,
      currency: true,
      negotiable: true,
      city: true,
      region: true,
      country: true,
      publishedAt: true,
      viewCount: true,
      favoriteCount: true,
      sellerId: true,
      questions: { orderBy: { position: "asc" }, select: { id: true, prompt: true, required: true } },
      pet: {
        select: {
          id: true,
          name: true,
          species: true,
          sex: true,
          birthDate: true,
          birthDateIsEstimate: true,
          weightKg: true,
          color: true,
          temperament: true,
          isNeutered: true,
          verificationLevel: true,
          healthScore: true,
          passportNo: true,
          microchipId: true,
          description: true,
          breedText: true,
          breed: { select: { id: true, name: true, slug: true, sizeClass: true, careLevel: true } },
          photos: {
            orderBy: { position: "asc" },
            select: { id: true, url: true, alt: true, width: true, height: true },
          },
          dam: { select: { id: true, name: true, passportNo: true } },
          sire: { select: { id: true, name: true, passportNo: true } },
        },
      },
      seller: {
        select: {
          id: true,
          name: true,
          handle: true,
          avatarUrl: true,
          bio: true,
          city: true,
          country: true,
          createdAt: true,
          trustScore: true,
          ratingAvgBps: true,
          ratingCount: true,
          completedSales: true,
          roles: { select: { role: true } },
        },
      },
    },
  });
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const listing = await loadListing(slug);

  if (!listing) return { title: "Listing not found" };

  const breed = listing.pet.breed?.name ?? listing.pet.breedText ?? SPECIES_LABEL[listing.pet.species as Species];
  const location = [listing.city, listing.country].filter(Boolean).join(", ");
  const price =
    listing.intent === "SALE" ? ` — ${formatMoney(listing.priceCents, listing.currency)}` : "";

  const description = `${listing.pet.name}, a ${formatAge(listing.pet.birthDate).toLowerCase()} ${breed}${location ? ` in ${location}` : ""}. ${listing.description.slice(0, 140)}`;

  const image = listing.pet.photos[0]?.url;

  return {
    title: `${listing.title}${price}`,
    description,
    alternates: { canonical: `/pets/${listing.slug}` },
    robots: {
      // Only live listings are worth indexing; a sold pet is a dead result.
      index: listing.status === "ACTIVE",
      follow: true,
    },
    openGraph: {
      type: "article",
      title: listing.title,
      description,
      url: `${clientEnv.NEXT_PUBLIC_APP_URL}/pets/${listing.slug}`,
      images: image ? [{ url: image, alt: listing.pet.name }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: listing.title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function ListingPage({ params }: { params: Params }) {
  const { slug } = await params;
  const [listing, auth] = await Promise.all([loadListing(slug), getAuth()]);

  if (!listing) notFound();

  const isOwner = auth?.user.id === listing.sellerId;
  const publiclyVisible = listing.status === "ACTIVE" || listing.status === "RESERVED";

  // A draft or removed listing is only visible to its owner.
  if (!publiclyVisible && !isOwner) notFound();

  const [health, sellerTrust, favorited, similar, reviews] = await Promise.all([
    getPublicHealthSummary(listing.pet.id),
    getPublicTrust(listing.sellerId),
    auth
      ? db.favorite.findUnique({
          where: { userId_listingId: { userId: auth.user.id, listingId: listing.id } },
          select: { id: true },
        })
      : null,
    searchListings({
      species: [listing.pet.species as Species],
      intent: listing.intent as "SALE" | "ADOPTION" | "BREEDING",
      limit: 4,
      country: listing.country ?? undefined,
      viewerId: auth?.user.id,
    }),
    listReviews("SELLER", listing.sellerId, { limit: 3 }),
  ]);

  // Fire and forget: a view should never delay the page.
  void recordListingView({
    listingId: listing.id,
    userId: auth?.user.id,
    source: "DIRECT",
  }).catch(() => undefined);

  const breedName = listing.pet.breed?.name ?? listing.pet.breedText ?? SPECIES_LABEL[listing.pet.species as Species];
  const temperament = splitTags(listing.pet.temperament);
  const tier = trustTier(listing.seller.trustScore);
  const isBreeder = listing.seller.roles.some((r) => r.role === "BREEDER");

  const priceLabel =
    listing.intent === "SALE"
      ? formatMoney(listing.priceCents, listing.currency)
      : listing.intent === "ADOPTION"
        ? listing.adoptionFeeCents > 0
          ? formatMoney(listing.adoptionFeeCents, listing.currency)
          : "Free to a good home"
        : listing.studFeeCents > 0
          ? formatMoney(listing.studFeeCents, listing.currency)
          : "Terms negotiable";

  return (
    <div className="container-page py-6 lg:py-10">
      <Breadcrumbs
        items={[
          { label: "Pets", href: "/pets" },
          { label: SPECIES_LABEL[listing.pet.species as Species], href: `/pets?species=${listing.pet.species}` },
          ...(listing.pet.breed
            ? [{ label: listing.pet.breed.name, href: `/breeds/${listing.pet.breed.slug}` }]
            : []),
          { label: listing.pet.name },
        ]}
      />

      {!publiclyVisible && (
        <Alert tone="warning" className="mb-5" icon={<Info className="size-4" aria-hidden />}>
          This listing is {listing.status.toLowerCase().replace("_", " ")} and is only visible to you.
        </Alert>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0">
          <PhotoGallery photos={listing.pet.photos} petName={listing.pet.name} />

          <div className="mt-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={listing.intent === "ADOPTION" ? "success" : "brand"}>
                {listing.intent === "SALE"
                  ? "For sale"
                  : listing.intent === "ADOPTION"
                    ? "For adoption"
                    : "Available for breeding"}
              </Badge>
              {listing.status === "RESERVED" && <Badge tone="warning">Reserved</Badge>}
              {listing.pet.verificationLevel !== "NONE" && (
                <Badge tone="success" icon={<BadgeCheck className="size-3" aria-hidden />}>
                  {VERIFICATION_LEVEL_LABEL[listing.pet.verificationLevel as VerificationLevel]}
                </Badge>
              )}
            </div>

            <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
              {listing.pet.name}
            </h1>

            <p className="mt-2 text-[15px] text-fg-muted">
              {breedName} · {listing.pet.sex === "MALE" ? "Male" : listing.pet.sex === "FEMALE" ? "Female" : "Sex unknown"} ·{" "}
              {formatAge(listing.pet.birthDate)}
              {listing.pet.birthDateIsEstimate && " (estimated)"}
              {listing.pet.isNeutered && " · Neutered"}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-fg-muted">
              {(listing.city || listing.country) && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="size-4" aria-hidden />
                  {[listing.city, listing.region, listing.country].filter(Boolean).join(", ")}
                </span>
              )}
              {listing.publishedAt && (
                <span className="flex items-center gap-1.5">
                  <CalendarDays className="size-4" aria-hidden />
                  Listed {relativeTime(listing.publishedAt)}
                </span>
              )}
              <span className="tabular">{listing.viewCount} views</span>
            </div>
          </div>

          {/* The health panel is the product's whole argument, so it sits above
              the description rather than below it. */}
          <HealthPanel health={health} pet={listing.pet} />

          <section className="mt-8">
            <h2 className="font-display text-xl font-semibold text-fg">
              About {listing.pet.name}
            </h2>
            <div className="prose-petmate mt-3 space-y-4 text-[15px] leading-relaxed text-fg-muted">
              {listing.description.split("\n\n").map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
              ))}
            </div>

            {temperament.length > 0 && (
              <div className="mt-5">
                <h3 className="text-sm font-semibold text-fg">Temperament</h3>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {temperament.map((trait) => (
                    <li key={trait}>
                      <Badge tone="neutral">{trait}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="mt-8">
            <h2 className="font-display text-xl font-semibold text-fg">Details</h2>
            <Card className="mt-3 p-5">
              <dl className="divide-y divide-[var(--border)]">
                <DataRow label="PetMate passport" value={<span className="font-mono text-xs">{listing.pet.passportNo}</span>} />
                <DataRow label="Species" value={SPECIES_LABEL[listing.pet.species as Species]} />
                <DataRow
                  label="Breed"
                  value={
                    listing.pet.breed ? (
                      <Link href={`/breeds/${listing.pet.breed.slug}`} className="text-brand hover:underline">
                        {listing.pet.breed.name}
                      </Link>
                    ) : (
                      (listing.pet.breedText ?? "Not specified")
                    )
                  }
                />
                <DataRow
                  label="Date of birth"
                  value={
                    listing.pet.birthDate
                      ? `${formatDate(listing.pet.birthDate, "long")}${listing.pet.birthDateIsEstimate ? " (est.)" : ""}`
                      : "Not recorded"
                  }
                />
                {listing.pet.weightKg && <DataRow label="Weight" value={`${listing.pet.weightKg} kg`} />}
                {listing.pet.color && <DataRow label="Colour" value={listing.pet.color} />}
                <DataRow label="Neutered" value={listing.pet.isNeutered ? "Yes" : "No"} />
                <DataRow
                  label="Microchip"
                  value={
                    listing.pet.microchipId ? (
                      <Badge tone="success" size="sm">Registered</Badge>
                    ) : (
                      <span className="text-fg-subtle">Not recorded</span>
                    )
                  }
                />
              </dl>
            </Card>
          </section>

          {(listing.pet.dam || listing.pet.sire) && (
            <section className="mt-8">
              <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-fg">
                <Dna className="size-5 text-brand" aria-hidden />
                Parentage
              </h2>
              <p className="mt-1 text-sm text-fg-muted">
                Recorded on PetMate, which means the lineage is checkable rather than claimed.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {[
                  { label: "Mother", pet: listing.pet.dam },
                  { label: "Father", pet: listing.pet.sire },
                ]
                  .filter((entry) => entry.pet)
                  .map((entry) => (
                    <Card key={entry.label} className="p-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                        {entry.label}
                      </p>
                      <Link
                        href={`/p/${entry.pet!.id}`}
                        className="mt-1 block font-medium text-fg hover:underline"
                      >
                        {entry.pet!.name}
                      </Link>
                      <p className="mt-0.5 font-mono text-xs text-fg-subtle">
                        {entry.pet!.passportNo}
                      </p>
                    </Card>
                  ))}
              </div>
            </section>
          )}

          <section className="mt-8">
            <h2 className="font-display text-xl font-semibold text-fg">
              About the {isBreeder ? "breeder" : "owner"}
            </h2>
            <Card className="mt-3 p-5">
              <div className="flex items-start gap-4">
                <Avatar src={listing.seller.avatarUrl} name={listing.seller.name} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/u/${listing.seller.handle}`}
                      className="font-display text-lg font-semibold text-fg hover:underline"
                    >
                      {listing.seller.name}
                    </Link>
                    <StatusPill tone={listing.seller.trustScore >= 60 ? "success" : listing.seller.trustScore >= 30 ? "brand" : "neutral"}>
                      {TRUST_TIER_LABEL[tier]} · {listing.seller.trustScore}
                    </StatusPill>
                  </div>

                  <p className="mt-1 text-sm text-fg-muted">
                    Member since {formatDate(listing.seller.createdAt, "long")}
                    {listing.seller.completedSales > 0 &&
                      ` · ${listing.seller.completedSales} completed ${listing.seller.completedSales === 1 ? "sale" : "sales"}`}
                    {listing.seller.ratingCount > 0 &&
                      ` · ${(listing.seller.ratingAvgBps / 100).toFixed(1)}★ from ${listing.seller.ratingCount} reviews`}
                  </p>

                  {listing.seller.bio && (
                    <p className="mt-3 text-[15px] leading-relaxed text-fg-muted">{listing.seller.bio}</p>
                  )}

                  {sellerTrust.badges.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-1.5">
                      {sellerTrust.badges.map((badge) => (
                        <li key={badge}>
                          <Badge tone="success" size="sm" icon={<ShieldCheck className="size-3" aria-hidden />}>
                            {badge}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </Card>
          </section>

          {reviews.items.length > 0 && (
            <section className="mt-8">
              <h2 className="font-display text-xl font-semibold text-fg">
                Reviews of this seller
              </h2>
              <p className="mt-1 text-sm text-fg-muted">
                Only people who completed a transaction on PetMate can leave one.
              </p>
              <div className="mt-3">
                <ReviewList reviews={reviews.items} />
              </div>
            </section>
          )}

          <section className="mt-8">
            <Alert
              tone="info"
              title="Staying safe"
              icon={<Lock className="size-4" aria-hidden />}
            >
              Keep messages and payment on PetMate. Your money is held in escrow until you have met{" "}
              {listing.pet.name} and confirmed the handover. Anyone asking you to pay by bank
              transfer, gift card or crypto is running a scam —{" "}
              <Link href="/trust" className="font-semibold underline">
                read how this works
              </Link>
              .
            </Alert>
          </section>

          <div className="mt-6 flex justify-end">
            <ReportButton entityType="LISTING" entityId={listing.id} />
          </div>
        </div>

        {/* Sticky action rail on desktop; on mobile the contact card moves
            inline above the description via CSS order. */}
        <aside className="lg:sticky lg:top-24 lg:h-fit">
          <ContactSellerCard
            listing={{
              id: listing.id,
              slug: listing.slug,
              intent: listing.intent,
              status: listing.status,
              priceLabel,
              negotiable: listing.negotiable,
              currency: listing.currency,
              petName: listing.pet.name,
              sellerId: listing.sellerId,
              sellerName: listing.seller.name,
              questions: listing.questions,
            }}
            viewer={
              auth
                ? { id: auth.user.id, emailVerified: auth.user.emailVerified, name: auth.user.name }
                : null
            }
            favorited={Boolean(favorited)}
          />
        </aside>
      </div>

      {similar.items.filter((l) => l.id !== listing.id).length > 0 && (
        <section className="mt-16">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">
            Similar {SPECIES_LABEL[listing.pet.species as Species].toLowerCase()}s
          </h2>
          <div className="mt-5">
            <ListingGrid>
              {similar.items
                .filter((l) => l.id !== listing.id)
                .slice(0, 4)
                .map((l) => (
                  <ListingCard key={l.id} listing={l} />
                ))}
            </ListingGrid>
          </div>
        </section>
      )}

      {/* Structured data so the listing can appear as a rich result. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Product",
            name: listing.title,
            description: listing.description.slice(0, 400),
            image: listing.pet.photos.map((p) => p.url),
            category: `Pets > ${SPECIES_LABEL[listing.pet.species as Species]}`,
            ...(listing.intent === "SALE" && listing.priceCents > 0
              ? {
                  offers: {
                    "@type": "Offer",
                    price: (listing.priceCents / 100).toFixed(2),
                    priceCurrency: listing.currency,
                    availability:
                      listing.status === "ACTIVE"
                        ? "https://schema.org/InStock"
                        : "https://schema.org/OutOfStock",
                    url: `${clientEnv.NEXT_PUBLIC_APP_URL}/pets/${listing.slug}`,
                    seller: { "@type": "Person", name: listing.seller.name },
                  },
                }
              : {}),
            ...(listing.seller.ratingCount > 0
              ? {
                  aggregateRating: {
                    "@type": "AggregateRating",
                    ratingValue: (listing.seller.ratingAvgBps / 100).toFixed(1),
                    reviewCount: listing.seller.ratingCount,
                  },
                }
              : {}),
          }),
        }}
      />
    </div>
  );
}

function HealthPanel({
  health,
  pet,
}: {
  health: Awaited<ReturnType<typeof getPublicHealthSummary>>;
  pet: { healthScore: number; name: string; verificationLevel: string };
}) {
  const tone =
    pet.healthScore >= 75 ? "success" : pet.healthScore >= 45 ? "warning" : "danger";

  return (
    <section className="mt-6">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-bg-sunken px-5 py-3.5">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <Stethoscope className="size-4 text-brand" aria-hidden />
            Health record
          </h2>
          <StatusPill tone={tone}>
            {pet.healthScore >= 75
              ? "Well documented"
              : pet.healthScore >= 45
                ? "Partly documented"
                : health.recordCount > 0
                  ? "Little documentation"
                  : "No records yet"}
          </StatusPill>
        </div>

        <div className="grid gap-px bg-[var(--border)] sm:grid-cols-3">
          <HealthStat
            label="Vaccinations"
            value={
              health.vaccinated
                ? health.vaccinationsCurrent
                  ? "Up to date"
                  : "Overdue"
                : "None recorded"
            }
            tone={health.vaccinated ? (health.vaccinationsCurrent ? "good" : "warn") : "none"}
            icon={<Syringe className="size-4" aria-hidden />}
          />
          <HealthStat
            label="Clinic-verified entries"
            value={
              health.clinicVerifiedCount > 0
                ? `${health.clinicVerifiedCount} of ${health.recordCount}`
                : "None"
            }
            tone={health.clinicVerifiedCount > 0 ? "good" : "none"}
            icon={<BadgeCheck className="size-4" aria-hidden />}
          />
          <HealthStat
            label="Last check-up"
            value={health.lastCheckupAt ? formatDate(health.lastCheckupAt) : "Not recorded"}
            tone={health.lastCheckupAt ? "good" : "none"}
            icon={<CalendarDays className="size-4" aria-hidden />}
          />
        </div>

        <div className="border-t border-[var(--border)] bg-bg-sunken px-5 py-3">
          <p className="text-xs leading-relaxed text-fg-muted">
            {health.clinicVerifiedCount > 0 ? (
              <>
                <span className="font-semibold text-fg">
                  {health.clinicVerifiedCount} {health.clinicVerifiedCount === 1 ? "entry was" : "entries were"} written by a clinic
                </span>{" "}
                through its own PetMate account, not typed in by the seller. The full record
                transfers to you on completion.
              </>
            ) : health.recordCount > 0 ? (
              <>
                All {health.recordCount} entries were added by the owner and have not been
                confirmed by a clinic. Ask to see the original paperwork before you commit.
              </>
            ) : (
              <>
                No health records have been added. That is not necessarily a red flag for a very
                young animal, but ask what veterinary care has been given.
              </>
            )}
          </p>
        </div>
      </Card>
    </section>
  );
}

function HealthStat({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone: "good" | "warn" | "none";
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-bg-elevated px-5 py-4">
      <p className="flex items-center gap-1.5 text-xs text-fg-muted">
        <span
          className={
            tone === "good"
              ? "text-[var(--success)]"
              : tone === "warn"
                ? "text-[var(--warning)]"
                : "text-fg-subtle"
          }
        >
          {icon}
        </span>
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-fg">{value}</p>
    </div>
  );
}
