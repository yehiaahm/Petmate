import Link from "next/link";
import Image from "next/image";
import { BadgeCheck, MapPin, PawPrint, ShieldCheck, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/money";
import { formatAge, formatDistance, cn } from "@/lib/utils";
import { SPECIES_LABEL, type Species } from "@/lib/constants";
import type { ListingCard as ListingCardData } from "@/lib/services/search.service";
import { FavoriteButton } from "./favorite-button";

/**
 * The listing card.
 *
 * The signature unit of the marketplace, so it carries the things that make
 * PetMate different rather than only a photo and a price: verification level,
 * how well documented the animal's health is, and how far away it is. A
 * classifieds card shows a price; this one shows whether you can trust it.
 */
export function ListingCard({
  listing,
  priority = false,
  showFavorite = true,
  className,
}: {
  listing: ListingCardData;
  priority?: boolean;
  showFavorite?: boolean;
  className?: string;
}) {
  const verified =
    listing.pet.verificationLevel === "CLINIC_VERIFIED" ||
    listing.pet.verificationLevel === "DOCUMENTED";

  const price =
    listing.intent === "SALE"
      ? formatMoney(listing.priceCents, listing.currency)
      : listing.intent === "ADOPTION"
        ? listing.adoptionFeeCents > 0
          ? `${formatMoney(listing.adoptionFeeCents, listing.currency)} fee`
          : "Free to a good home"
        : listing.studFeeCents > 0
          ? `${formatMoney(listing.studFeeCents, listing.currency)} stud fee`
          : "Terms negotiable";

  const location =
    listing.distanceKm != null
      ? formatDistance(listing.distanceKm)
      : [listing.city, listing.country].filter(Boolean).join(", ") || "Location not set";

  return (
    <article
      className={cn(
        "@container surface-lift group relative flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-bg-elevated p-1.5 shadow-[var(--shadow-subtle)]",
        className,
      )}
    >
      <Link
        href={`/pets/${listing.slug}`}
        className="relative block overflow-hidden rounded-[calc(var(--radius-card)-0.375rem)]"
      >
        <div className="aspect-card relative bg-bg-sunken">
          {listing.pet.photo ? (
            <Image
              src={listing.pet.photo.url}
              alt={listing.pet.photo.alt ?? `${listing.pet.name}, a ${listing.pet.breedName ?? SPECIES_LABEL[listing.pet.species as Species]}`}
              fill
              sizes="(max-width: 640px) 80vw, (max-width: 1024px) 50vw, 25vw"
              priority={priority}
              className="object-cover transition-transform duration-700 ease-[var(--ease-out-soft)] group-hover:scale-[1.06]"
            />
          ) : (
            <div className="flex size-full items-center justify-center text-fg-subtle">
              <PawPrint className="size-10 opacity-40" aria-hidden />
            </div>
          )}
          {/* Legibility scrim for the price pill. */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/55 to-transparent"
            aria-hidden
          />
        </div>

        <div className="absolute left-2 top-2 flex max-w-[calc(100%-3rem)] flex-wrap gap-1.5">
          {listing.featured && (
            <Badge tone="accent" size="sm" icon={<Sparkles className="size-3" aria-hidden />} className="shadow-sm">
              Featured
            </Badge>
          )}
          {listing.status === "RESERVED" && (
            <Badge tone="warning" size="sm" className="shadow-sm">
              Reserved
            </Badge>
          )}
          {verified && (
            <Badge tone="success" size="sm" icon={<BadgeCheck className="size-3" aria-hidden />} className="shadow-sm">
              {listing.pet.verificationLevel === "CLINIC_VERIFIED" ? "Vet verified" : "Documented"}
            </Badge>
          )}
        </div>

        <p className="absolute bottom-2 left-2 right-2 flex">
          <span
            className={cn(
              "truncate rounded-full px-2.5 py-1 text-[13px] font-bold tabular shadow-sm backdrop-blur-md",
              listing.intent === "SALE"
                ? "bg-white/90 text-[var(--color-slate-900)]"
                : "bg-[color-mix(in_srgb,var(--color-lagoon-700)_88%,transparent)] text-white",
            )}
          >
            {price}
          </span>
        </p>
      </Link>

      {showFavorite && (
        <div className="absolute right-3.5 top-3.5 z-10">
          <FavoriteButton listingId={listing.id} initial={listing.isFavorited} />
        </div>
      )}

      <div className="flex flex-1 flex-col px-2 pb-2 pt-3">
        <h3 className="truncate font-display text-base font-bold leading-snug text-fg">
          <Link href={`/pets/${listing.slug}`} className="hover:text-brand">
            {listing.pet.name}
          </Link>
        </h3>

        <p className="mt-0.5 truncate text-[13px] text-fg-muted">
          {listing.pet.breedName ?? SPECIES_LABEL[listing.pet.species as Species]}
          <span className="hidden @[14rem]:inline">
            {" · "}
            {listing.pet.sex === "MALE" ? "Male" : listing.pet.sex === "FEMALE" ? "Female" : "Unknown"}
          </span>
          {" · "}
          {formatAge(listing.pet.birthDate)}
        </p>

        <div className="mt-auto space-y-2.5 pt-3">
          {/* Health documentation is the reason to buy here rather than a
              classifieds site, so it is on the card, not buried on the page. */}
          <HealthMeter score={listing.pet.healthScore} />

          <div className="flex items-center justify-between gap-2 text-xs text-fg-muted">
            <span className="flex min-w-0 items-center gap-1">
              <MapPin className="size-3.5 shrink-0 text-brand" aria-hidden />
              <span className="truncate">{location}</span>
            </span>
            <span
              className="hidden shrink-0 items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 font-semibold text-brand-soft-fg @[14rem]:flex"
              title="Seller trust score"
            >
              <ShieldCheck className="size-3" aria-hidden />
              Trust {listing.seller.trustScore}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}

function HealthMeter({ score }: { score: number }) {
  const tone =
    score >= 75
      ? "from-[var(--color-mint)] to-[var(--color-lagoon-500)]"
      : score >= 45
        ? "from-[var(--color-sun)] to-[var(--color-coral-400)]"
        : score > 0
          ? "from-[var(--color-coral-500)] to-[var(--color-rose)]"
          : "from-[var(--border-strong)] to-[var(--border-strong)]";

  const label =
    score >= 75
      ? "Well documented"
      : score >= 45
        ? "Partly documented"
        : score > 0
          ? "Little documentation"
          : "No records yet";

  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-fg-subtle">
        <span className="hidden @[14rem]:inline">Health record</span>
        <span className="truncate font-medium text-fg-muted">{label}</span>
      </div>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg-inset"
        role="img"
        aria-label={`Health record score ${score} out of 100: ${label}`}
      >
        <div
          className={cn("h-full rounded-full bg-gradient-to-r", tone)}
          style={{ width: `${Math.max(4, score)}%` }}
        />
      </div>
    </div>
  );
}

export function ListingCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-bg-elevated p-1.5">
      <div className="aspect-card skeleton rounded-[calc(var(--radius-card)-0.375rem)]" />
      <div className="space-y-3 px-2 pb-2 pt-3">
        <div className="skeleton h-4 w-2/3" />
        <div className="skeleton h-3 w-1/2" />
        <div className="skeleton h-1.5 w-full" />
        <div className="skeleton h-3 w-1/3" />
      </div>
    </div>
  );
}

/** Two columns on a phone (twice the pets per screen), up to four on desktop. */
export function ListingGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
      {children}
    </div>
  );
}

/**
 * A swipeable row on phones, a grid from tablet up. For sections that preview
 * more, so the page stays short and the next section stays within reach. The
 * grid shows exactly one or two full rows; the rest is one tap away.
 */
export function ListingRail({ children }: { children: React.ReactNode }) {
  return (
    <div className="rail reveal auto-cols-[min(16.5rem,76%)] sm:mx-0 sm:grid-flow-row sm:auto-cols-auto sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 lg:grid-cols-4 sm:[&>*:nth-child(n+5)]:hidden">
      {children}
    </div>
  );
}
