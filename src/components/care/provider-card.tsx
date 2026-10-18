import Link from "next/link";
import Image from "next/image";
import { BadgeCheck, BedDouble, GraduationCap, MapPin, Star, Truck, Sparkles } from "lucide-react";
import { Badge, Card } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { formatMoney, formatRating } from "@/lib/money";
import { formatDistance, splitTags } from "@/lib/utils";

export interface ProviderCardData {
  name: string;
  slug: string;
  tagline: string | null;
  city: string | null;
  country: string | null;
  bannerUrl: string | null;
  logoUrl: string | null;
  ratingAvgBps: number;
  ratingCount: number;
  verifiedAt: Date | null;
  isOfficial: boolean;
  offersTransport: boolean;
  amenities: string | null;
  currency: string;
  fromCents: number | null;
  distanceKm: number | null;
  highlights: { id: string; label: string; priceCents: number }[];
}

export function ProviderCard({ provider, kind }: { provider: ProviderCardData; kind: "BOARDING" | "TRAINING" }) {
  const Icon = kind === "BOARDING" ? BedDouble : GraduationCap;
  const href = `/care/${provider.slug}${kind === "TRAINING" ? "?tab=training" : ""}`;
  const amenities = splitTags(provider.amenities).slice(0, 4);

  return (
    <Card as="article" interactive className="overflow-hidden">
      <div className="flex flex-col sm:flex-row">
        <Link href={href} className="relative aspect-card w-full shrink-0 bg-bg-sunken sm:aspect-square sm:w-44">
          {provider.bannerUrl || provider.logoUrl ? (
            <Image src={provider.bannerUrl ?? provider.logoUrl!} alt="" fill sizes="176px" className="object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center text-fg-subtle">
              <Icon className="size-9" aria-hidden />
            </span>
          )}
        </Link>

        <div className="min-w-0 flex-1 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <Link href={href}>
                <h2 className="font-display text-lg font-semibold text-fg hover:underline">{provider.name}</h2>
              </Link>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
                <span className="flex items-center gap-1">
                  <MapPin className="size-3.5" aria-hidden />
                  {provider.distanceKm != null
                    ? formatDistance(provider.distanceKm)
                    : [provider.city, provider.country].filter(Boolean).join(", ")}
                </span>
                {provider.ratingCount > 0 && (
                  <span className="flex items-center gap-1">
                    <Star className="size-3.5 fill-[var(--warning)] text-[var(--warning)]" aria-hidden />
                    <span className="tabular">{formatRating(provider.ratingAvgBps)}</span>
                    <span className="text-fg-subtle">({provider.ratingCount})</span>
                  </span>
                )}
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap gap-1.5">
              {provider.isOfficial && (
                <Badge tone="brand" size="sm" icon={<Sparkles className="size-3" aria-hidden />}>
                  PetMate Official
                </Badge>
              )}
              {!provider.isOfficial && provider.verifiedAt && (
                <Badge tone="success" size="sm" icon={<BadgeCheck className="size-3" aria-hidden />}>
                  Verified
                </Badge>
              )}
              {provider.offersTransport && (
                <Badge tone="neutral" size="sm" icon={<Truck className="size-3" aria-hidden />}>
                  Pickup & drop-off
                </Badge>
              )}
            </div>
          </div>

          {provider.tagline && <p className="mt-2 line-clamp-2 text-sm text-fg-muted">{provider.tagline}</p>}

          {provider.highlights.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {provider.highlights.slice(0, 3).map((h) => (
                <li key={h.id}>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-fg-muted">
                    {h.label}
                    <span className="font-semibold tabular text-fg">{formatMoney(h.priceCents, provider.currency)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {amenities.length > 0 && (
            <p className="mt-2 text-xs text-fg-subtle">{amenities.join(" · ")}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            {provider.fromCents != null && (
              <p className="text-sm text-fg-muted">
                From{" "}
                <span className="font-display text-lg font-bold tabular text-fg">
                  {formatMoney(provider.fromCents, provider.currency)}
                </span>
                {kind === "BOARDING" ? " / night" : " / programme"}
              </p>
            )}
            <ButtonLink href={href} size="sm">
              {kind === "BOARDING" ? "Check availability" : "See programmes"}
            </ButtonLink>
          </div>
        </div>
      </div>
    </Card>
  );
}
