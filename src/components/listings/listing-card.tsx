import Link from "next/link";
import Image from "next/image";
import { BadgeCheck, MapPin, ShieldCheck, Sparkles } from "lucide-react";
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

  return (
    <article
      className={cn(
        "surface surface-lift group relative flex flex-col overflow-hidden",
        className,
      )}
    >
      <Link href={`/pets/${listing.slug}`} className="relative block overflow-hidden">
        <div className="aspect-card relative bg-bg-sunken">
          {listing.pet.photo ? (
            <Image
              src={listing.pet.photo.url}
              alt={listing.pet.photo.alt ?? `${listing.pet.name}, a ${listing.pet.breedName ?? SPECIES_LABEL[listing.pet.species as Species]}`}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
              priority={priority}
              className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            />
          ) : (
            <div className="flex size-full items-center justify-center text-sm text-fg-subtle">
              No photo
            </div>
          )}
        </div>

        <div className="absolute start-3 top-3 flex flex-wrap gap-1.5">
          {listing.featured && (
            <Badge tone="accent" size="sm" icon={<Sparkles className="size-3" aria-hidden />}>
              Featured
            </Badge>
          )}
          {listing.status === "RESERVED" && (
            <Badge tone="warning" size="sm">
              Reserved
            </Badge>
          )}
          {verified && (
            <Badge tone="success" size="sm" icon={<BadgeCheck className="size-3" aria-hidden />}>
              {listing.pet.verificationLevel === "CLINIC_VERIFIED" ? "Vet verified" : "Documented"}
            </Badge>
          )}
        </div>
      </Link>

      {showFavorite && (
        <div className="absolute end-3 top-3">
          <FavoriteButton listingId={listing.id} initial={listing.isFavorited} />
        </div>
      )}

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 font-display text-[15px] font-semibold leading-snug text-fg">
            <Link href={`/pets/${listing.slug}`} className="hover:underline">
              {listing.pet.name}
            </Link>
          </h3>
          <p className="shrink-0 text-end text-[15px] font-semibold tabular text-fg">
            {listing.intent === "SALE" ? (
              price
            ) : (
              <span className="text-sm font-medium text-brand">{price}</span>
            )}
          </p>
        </div>

        <p className="mt-0.5 truncate text-sm text-fg-muted">
          {listing.pet.breedName ?? SPECIES_LABEL[listing.pet.species as Species]}
          {" · "}
          {listing.pet.sex === "MALE" ? "Male" : listing.pet.sex === "FEMALE" ? "Female" : "Unknown"}
          {" · "}
          {formatAge(listing.pet.birthDate)}
        </p>

        <div className="mt-auto space-y-2 pt-3">
          {/* Health documentation is the reason to buy here rather than a
              classifieds site, so it is on the card, not buried on the page. */}
          <HealthMeter score={listing.pet.healthScore} />

          <div className="flex items-center justify-between gap-2 text-xs text-fg-muted">
            <span className="flex min-w-0 items-center gap-1">
              <MapPin className="size-3 shrink-0" aria-hidden />
              <span className="truncate">
                {listing.distanceKm != null
                  ? formatDistance(listing.distanceKm)
                  : ([listing.city, listing.country].filter(Boolean).join(", ") || "Location not set")}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
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
      ? "bg-[var(--success)]"
      : score >= 45
        ? "bg-[var(--warning)]"
        : score > 0
          ? "bg-[var(--danger)]"
          : "bg-[var(--border-strong)]";

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
      <div className="flex items-center justify-between text-[11px] text-fg-subtle">
        <span>Health record</span>
        <span className="tabular">{label}</span>
      </div>
      <div
        className="mt-1 h-1 overflow-hidden rounded-full bg-bg-inset"
        role="img"
        aria-label={`Health record score ${score} out of 100: ${label}`}
      >
        <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${Math.max(3, score)}%` }} />
      </div>
    </div>
  );
}

export function ListingCardSkeleton() {
  return (
    <div className="surface overflow-hidden">
      <div className="aspect-card skeleton" />
      <div className="space-y-3 p-4">
        <div className="skeleton h-4 w-2/3" />
        <div className="skeleton h-3 w-1/2" />
        <div className="skeleton h-1 w-full" />
        <div className="skeleton h-3 w-1/3" />
      </div>
    </div>
  );
}

export function ListingGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {children}
    </div>
  );
}
