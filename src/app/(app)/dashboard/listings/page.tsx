import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Plus, TrendingUp, Eye, Heart, MessageSquare, FileText } from "lucide-react";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/rbac";
import { getEntitlements } from "@/lib/billing/entitlements";
import { Card, Badge, EmptyState, PageHeader, StatusPill } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { LISTING_INTENT_LABEL, type ListingIntent } from "@/lib/constants";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
  title: t("My listings"),
  robots: { index: false, follow: false },
};
}

const STATUS_TONE: Record<string, "success" | "warning" | "neutral" | "danger" | "brand"> = {
  ACTIVE: "success",
  RESERVED: "brand",
  PENDING_REVIEW: "warning",
  DRAFT: "neutral",
  PAUSED: "neutral",
  EXPIRED: "neutral",
  COMPLETED: "success",
  REJECTED: "danger",
  REMOVED: "danger",
};

export default async function MyListingsPage() {
  const { t, fmt } = await getI18n();
  const auth = await requireAuth();

  const [listings, entitlements] = await Promise.all([
    db.listing.findMany({
      where: { sellerId: auth.user.id, deletedAt: null },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        slug: true,
        title: true,
        intent: true,
        status: true,
        priceCents: true,
        adoptionFeeCents: true,
        studFeeCents: true,
        currency: true,
        viewCount: true,
        favoriteCount: true,
        inquiryCount: true,
        publishedAt: true,
        expiresAt: true,
        featuredUntil: true,
        moderationNote: true,
        pet: {
          select: {
            id: true,
            name: true,
            photos: { where: { isPrimary: true }, take: 1, select: { url: true } },
          },
        },
        _count: { select: { applications: true } },
      },
    }),
    getEntitlements(auth.user.id),
  ]);

  const activeCount = listings.filter((l) =>
    ["ACTIVE", "PENDING_REVIEW", "RESERVED"].includes(l.status),
  ).length;

  return (
    <div className="container-page py-8">
      <PageHeader
        eyebrow={t("Marketplace")}
        title={t("My listings")}
        description={
          <>
            {t("{used} of {limit} active listings used on the {plan} plan.", {
              used: activeCount,
              limit: entitlements.activeListings >= 100_000 ? t("unlimited") : entitlements.activeListings,
              plan: entitlements.planName,
            })}
          </>
        }
        action={
          <ButtonLink href="/dashboard/listings/new">
            <Plus className="size-4" aria-hidden />
            {t("New listing")}
          </ButtonLink>
        }
      />

      {listings.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={<TrendingUp className="size-6" aria-hidden />}
            title={t("No listings yet")}
            description={t("List a pet for sale, adoption or breeding. Every listing is tied to a pet profile, so the health record comes with it.")}
            action={<ButtonLink href="/dashboard/listings/new">{t("Create your first listing")}</ButtonLink>}
          />
        </div>
      ) : (
        <ul className="mt-8 space-y-3">
          {listings.map((listing) => {
            const price =
              listing.intent === "SALE"
                ? fmt.money(listing.priceCents, listing.currency)
                : listing.intent === "ADOPTION"
                  ? listing.adoptionFeeCents > 0
                    ? fmt.money(listing.adoptionFeeCents, listing.currency)
                    : "Free"
                  : listing.studFeeCents > 0
                    ? fmt.money(listing.studFeeCents, listing.currency)
                    : "Negotiable";

            const featured = listing.featuredUntil && listing.featuredUntil > new Date();

            return (
              <li key={listing.id}>
                <Card as="article" className="p-4">
                  <div className="flex flex-col gap-4 sm:flex-row">
                    <Link
                      href={`/dashboard/listings/${listing.id}`}
                      className="relative aspect-card w-full shrink-0 overflow-hidden rounded-[var(--radius-field)] bg-bg-sunken sm:size-24"
                    >
                      {listing.pet.photos[0] && (
                        <Image
                          src={listing.pet.photos[0].url}
                          alt=""
                          fill
                          sizes="96px"
                          className="object-cover"
                        />
                      )}
                    </Link>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link href={`/dashboard/listings/${listing.id}`}>
                            <h2 className="truncate font-display text-base font-semibold text-fg hover:underline">
                              {listing.title}
                            </h2>
                          </Link>
                          <p className="mt-0.5 text-sm text-fg-muted">
                            {listing.pet.name} ·{" "}
                            {t(LISTING_INTENT_LABEL[listing.intent as ListingIntent])} · {price}
                          </p>
                        </div>

                        <div className="flex shrink-0 flex-wrap gap-1.5">
                          {featured && <Badge tone="accent" size="sm">{t("Featured")}</Badge>}
                          <StatusPill tone={STATUS_TONE[listing.status] ?? "neutral"}>
                            {listing.status.replace("_", " ").toLowerCase()}
                          </StatusPill>
                        </div>
                      </div>

                      {listing.status === "REJECTED" && listing.moderationNote && (
                        <p className="mt-2 rounded-[var(--radius-field)] bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
                          {listing.moderationNote}
                        </p>
                      )}

                      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-fg-muted">
                        <div className="flex items-center gap-1.5">
                          <Eye className="size-3.5" aria-hidden />
                          <dt className="sr-only">{t("Views")}</dt>
                          <dd className="tabular">{listing.viewCount}</dd>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Heart className="size-3.5" aria-hidden />
                          <dt className="sr-only">{t("Saves")}</dt>
                          <dd className="tabular">{listing.favoriteCount}</dd>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <MessageSquare className="size-3.5" aria-hidden />
                          <dt className="sr-only">{t("Enquiries")}</dt>
                          <dd className="tabular">{listing.inquiryCount}</dd>
                        </div>
                        {listing.intent === "ADOPTION" && (
                          <div className="flex items-center gap-1.5">
                            <FileText className="size-3.5" aria-hidden />
                            <dt className="sr-only">{t("Applications")}</dt>
                            <dd className="tabular">{listing._count.applications}</dd>
                          </div>
                        )}
                        {listing.publishedAt && (
                          <div className="flex items-center gap-1.5">
                            <dt className="sr-only">{t("Published")}</dt>
                            <dd>{t("Listed {when}", { when: fmt.relative(listing.publishedAt) })}</dd>
                          </div>
                        )}
                      </dl>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <ButtonLink
                          href={`/dashboard/listings/${listing.id}`}
                          variant="outline"
                          size="sm"
                        >
                          {t("Manage")}
                        </ButtonLink>
                        {["ACTIVE", "RESERVED"].includes(listing.status) && (
                          <ButtonLink href={`/pets/${listing.slug}`} variant="ghost" size="sm">
                            {t("View public page")}
                          </ButtonLink>
                        )}
                        {listing.intent === "ADOPTION" && listing._count.applications > 0 && (
                          <ButtonLink
                            href={`/dashboard/listings/${listing.id}/applications`}
                            variant="ghost"
                            size="sm"
                          >
                            {t.plural(listing._count.applications, { one: "{count} application", other: "{count} applications" })}
                          </ButtonLink>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
