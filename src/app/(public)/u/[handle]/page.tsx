import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BadgeCheck,
  MapPin,
  CalendarDays,
  ShieldCheck,
  PawPrint,
  Flag,
  MessageSquare,
} from "lucide-react";
import { db } from "@/lib/db";
import { getAuth } from "@/lib/auth/session";
import { searchListings } from "@/lib/services/search.service";
import { listReviews } from "@/lib/services/review.service";
import { getTrustBreakdown } from "@/lib/services/trust.service";
import { ListingCard, ListingGrid } from "@/components/listings/listing-card";
import { ReviewList, RatingSummary } from "@/components/reviews/review-list";
import { ReportButton } from "@/components/listings/report-button";
import { Card, Badge, Avatar, EmptyState, Stat } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { TRUST_TIER_LABEL, type TrustTier } from "@/lib/constants";
import { clientEnv } from "@/lib/env";

export const revalidate = 300;

async function loadUser(handle: string) {
  return db.user.findFirst({
    where: { handle: handle.toLowerCase(), deletedAt: null },
    select: {
      id: true,
      name: true,
      handle: true,
      avatarUrl: true,
      bannerUrl: true,
      bio: true,
      city: true,
      region: true,
      country: true,
      trustScore: true,
      ratingAvgBps: true,
      ratingCount: true,
      completedSales: true,
      status: true,
      createdAt: true,
      roles: { select: { role: true } },
      verifications: {
        where: { status: "APPROVED", subjectType: "USER" },
        select: { type: true },
      },
    },
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const user = await loadUser(handle);
  if (!user) return { title: "Member not found", robots: { index: false, follow: false } };

  return {
    title: `${user.name} (@${user.handle})`,
    description:
      user.bio?.slice(0, 160) ??
      `${user.name} on PetMate — trust score ${user.trustScore}, ${user.completedSales} completed sales.`,
    alternates: { canonical: `/u/${user.handle}` },
    // A suspended account stays reachable so existing links do not 404, but it
    // does not belong in search results while it is under sanction.
    ...(user.status === "ACTIVE" ? {} : { robots: { index: false, follow: true } }),
  };
}

const VERIFICATION_BADGE: Record<string, string> = {
  IDENTITY: "ID verified",
  ADDRESS: "Address verified",
  BREEDER: "Licensed breeder",
  BUSINESS: "Registered business",
};

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const [{ handle }, auth] = await Promise.all([params, getAuth()]);

  const user = await loadUser(handle);
  if (!user) notFound();

  const isSelf = auth?.user.id === user.id;

  const [listings, reviews, trust, petCount] = await Promise.all([
    searchListings({ sellerId: user.id, limit: 8, viewerId: auth?.user.id }),
    listReviews("USER", user.id, { limit: 10 }),
    getTrustBreakdown(user.id),
    db.pet.count({ where: { ownerId: user.id, deletedAt: null, visibility: "PUBLIC" } }),
  ]);

  const rating = user.ratingCount > 0 ? user.ratingAvgBps / 100 : 0;
  const location = [user.city, user.region, user.country].filter(Boolean).join(", ");

  return (
    <div className="container-page max-w-5xl py-8 lg:py-12">
      {user.status === "SUSPENDED" && (
        <div className="mb-6 rounded-[var(--radius-card)] border border-[var(--danger)]/30 bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger)]">
          <p className="font-semibold">This account is suspended.</p>
          <p className="mt-1">
            It cannot list, message or transact. Do not arrange anything with this member.
          </p>
        </div>
      )}

      <Card className="overflow-hidden">
        {user.bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.bannerUrl} alt="" className="h-32 w-full object-cover sm:h-44" />
        ) : (
          <div className="h-24 w-full bg-brand-soft sm:h-32" aria-hidden />
        )}

        <div className="p-5 sm:p-6">
          <div className="-mt-14 flex flex-col gap-4 sm:-mt-16 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-end gap-4">
              <Avatar src={user.avatarUrl} name={user.name} size="xl" ring />
              <div className="min-w-0 pb-1">
                <h1 className="font-display text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
                  {user.name}
                </h1>
                <p className="text-sm text-fg-subtle">@{user.handle}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pb-1">
              {isSelf ? (
                <ButtonLink href="/settings" variant="outline" size="sm">
                  Edit profile
                </ButtonLink>
              ) : (
                <>
                  {auth && (
                    <ButtonLink href={`/messages?to=${user.handle}`} size="sm">
                      <MessageSquare className="size-4" aria-hidden />
                      Message
                    </ButtonLink>
                  )}
                  <ReportButton entityType="USER" entityId={user.id} label="Report" />
                </>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Badge tone={trust.score >= 60 ? "success" : trust.score >= 30 ? "brand" : "neutral"}>
              <ShieldCheck className="mr-1 size-3.5" aria-hidden />
              Trust {trust.score} · {TRUST_TIER_LABEL[trust.tier as TrustTier] ?? trust.tier}
            </Badge>
            {user.verifications.map((v) =>
              VERIFICATION_BADGE[v.type] ? (
                <Badge key={v.type} tone="success">
                  <BadgeCheck className="mr-1 size-3.5" aria-hidden />
                  {VERIFICATION_BADGE[v.type]}
                </Badge>
              ) : null,
            )}
          </div>

          {user.bio && (
            <p className="mt-4 max-w-2xl whitespace-pre-wrap text-[15px] leading-relaxed text-fg-muted">
              {user.bio}
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-fg-subtle">
            {location && (
              <span className="flex items-center gap-1.5">
                <MapPin className="size-3.5" aria-hidden />
                {location}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <CalendarDays className="size-3.5" aria-hidden />
              Member since {formatDate(user.createdAt, "long")}
            </span>
          </div>
        </div>
      </Card>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Trust score" value={String(trust.score)} />
        <Stat label="Completed sales" value={String(user.completedSales)} />
        <Stat
          label="Rating"
          value={user.ratingCount > 0 ? `${rating.toFixed(1)} / 5` : "—"}
          hint={user.ratingCount > 0 ? `${user.ratingCount} reviews` : "No reviews yet"}
        />
        <Stat label="Public pets" value={String(petCount)} />
      </div>

      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold tracking-tight text-fg">
          Active listings
        </h2>
        {listings.items.length === 0 ? (
          <EmptyState
            className="mt-4"
            icon={<PawPrint className="size-5" aria-hidden />}
            title="Nothing listed right now"
            description={`${user.name} has no active listings. Reviews and trust history below still apply.`}
          />
        ) : (
          <>
            <ListingGrid>
              {listings.items.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </ListingGrid>
            {listings.total > listings.items.length && (
              <p className="mt-4 text-sm text-fg-muted">
                Showing {listings.items.length} of {listings.total}.{" "}
                <Link
                  href={`/pets?seller=${user.handle}`}
                  className="font-medium text-brand hover:underline"
                >
                  See all
                </Link>
              </p>
            )}
          </>
        )}
      </section>

      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold tracking-tight text-fg">Reviews</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Every review here is tied to a transaction that actually completed on PetMate. There is
          no way to leave one otherwise.
        </p>

        {reviews.total > 0 && (
          <Card className="mt-4 p-5">
            <RatingSummary
              average={rating}
              count={reviews.total}
              distribution={reviews.distribution}
            />
          </Card>
        )}

        <div className="mt-4">
          <ReviewList reviews={reviews.items} />
        </div>
      </section>

      <p className="mt-10 flex items-center gap-2 text-xs text-fg-subtle">
        <Flag className="size-3.5" aria-hidden />
        Something wrong with this profile? Report it — we read every one.
      </p>

      {user.status === "ACTIVE" && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Person",
              name: user.name,
              alternateName: `@${user.handle}`,
              description: user.bio ?? undefined,
              url: `${clientEnv.NEXT_PUBLIC_APP_URL}/u/${user.handle}`,
              image: user.avatarUrl ?? undefined,
              address: location
                ? { "@type": "PostalAddress", addressLocality: user.city ?? undefined, addressCountry: user.country ?? undefined }
                : undefined,
              ...(user.ratingCount > 0
                ? {
                    aggregateRating: {
                      "@type": "AggregateRating",
                      ratingValue: rating.toFixed(1),
                      reviewCount: user.ratingCount,
                      bestRating: 5,
                    },
                  }
                : {}),
            }),
          }}
        />
      )}
    </div>
  );
}
