import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Eye, Heart, MessageSquare, FileText, Sparkles, ExternalLink } from "lucide-react";
import { db } from "@/lib/db";
import { requireAuth, assertOwnsListing } from "@/lib/auth/rbac";
import { getSettings } from "@/lib/settings";
import { Breadcrumbs, Card, PageHeader, Alert, DataRow } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { ListingControls } from "@/components/listings/listing-controls";
import { LISTING_INTENT_LABEL, type ListingIntent } from "@/lib/constants";
import { getI18n } from "@/lib/i18n/server";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const listing = await db.listing.findUnique({ where: { id }, select: { title: true } });
  return {
    title: listing ? `Manage: ${listing.title}` : "Listing",
    robots: { index: false, follow: false },
  };
}

export default async function ManageListingPage({ params }: { params: Params }) {
  const { t, fmt } = await getI18n();
  // The clock is read once, here, rather than inside the JSX: a render must be
  // a pure function of its inputs, and two reads can straddle a boundary.
  // A server component renders once per request, so this is the request's
  // timestamp rather than a value that can change between renders.
  // eslint-disable-next-line react-hooks/purity -- server render, once per request
  const expiringSoon = new Date(Date.now() + 7 * 86_400_000);

  const { id } = await params;
  const auth = await requireAuth();

  await assertOwnsListing(id, auth);

  const [listing, settings, applications, conversations] = await Promise.all([
    db.listing.findUnique({
      where: { id },
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
        country: true,
        viewCount: true,
        favoriteCount: true,
        inquiryCount: true,
        publishedAt: true,
        expiresAt: true,
        featuredUntil: true,
        moderationStatus: true,
        moderationNote: true,
        createdAt: true,
        pet: {
          select: {
            id: true,
            name: true,
            healthScore: true,
            photos: { where: { isPrimary: true }, take: 1, select: { url: true } },
          },
        },
      },
    }),
    getSettings(),
    db.adoptionApplication.count({
      where: { listingId: id, status: { in: ["SUBMITTED", "IN_REVIEW"] } },
    }),
    db.conversation.count({ where: { listingId: id } }),
  ]);

  if (!listing) notFound();

  const featured = listing.featuredUntil && listing.featuredUntil > new Date();
  const live = listing.status === "ACTIVE" || listing.status === "RESERVED";

  const price =
    listing.intent === "SALE"
      ? fmt.money(listing.priceCents, listing.currency)
      : listing.intent === "ADOPTION"
        ? listing.adoptionFeeCents > 0
          ? fmt.money(listing.adoptionFeeCents, listing.currency)
          : "Free to a good home"
        : listing.studFeeCents > 0
          ? fmt.money(listing.studFeeCents, listing.currency)
          : "Negotiable";

  // Conversion is the number a seller actually needs: how many of the people
  // who looked went on to get in touch.
  const conversion = listing.viewCount
    ? Math.round((listing.inquiryCount / listing.viewCount) * 1000) / 10
    : 0;

  return (
    <div className="container-page py-8">
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "My listings", href: "/dashboard/listings" },
          { label: listing.title },
        ]}
      />

      <PageHeader
        eyebrow={t(LISTING_INTENT_LABEL[listing.intent as ListingIntent])}
        title={listing.title}
        description={`${listing.pet.name} · ${price}${listing.negotiable ? ` · ${t("open to offers")}` : ""}`}
        action={
          live && (
            <ButtonLink href={`/pets/${listing.slug}`} variant="outline">
              <ExternalLink className="size-4" aria-hidden />
              {t("View public page")}
            </ButtonLink>
          )
        }
      />

      {listing.status === "PENDING_REVIEW" && (
        <div className="mt-6">
          <Alert tone="warning" title={t("Waiting for review")}>
            {t("We check listings before they go live. This usually takes a few hours, and you will get a notification either way.")}
          </Alert>
        </div>
      )}

      {listing.status === "REJECTED" && (
        <div className="mt-6">
          <Alert tone="danger" title={t("Not approved")}>
            {listing.moderationNote ?? t("This listing did not meet our rules.")}
          </Alert>
        </div>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
          <section>
            <h2 className="mb-3 font-display text-lg font-semibold text-fg">{t("Performance")}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Views", value: listing.viewCount, icon: Eye },
                { label: "Saves", value: listing.favoriteCount, icon: Heart },
                { label: "Enquiries", value: conversations, icon: MessageSquare },
                ...(listing.intent === "ADOPTION"
                  ? [{ label: "Applications", value: applications, icon: FileText }]
                  : [{ label: "View → enquiry", value: `${conversion}%`, icon: Sparkles }]),
              ].map((stat) => (
                <Card key={stat.label} className="p-4">
                  <stat.icon className="size-4 text-fg-subtle" aria-hidden />
                  <p className="mt-2 font-display text-xl font-semibold tabular text-fg">
                    {stat.value}
                  </p>
                  <p className="text-xs text-fg-muted">{t(stat.label)}</p>
                </Card>
              ))}
            </div>

            {live && listing.viewCount > 30 && conversion < 2 && (
              <div className="mt-3">
                <Alert tone="info">
                  {t("Plenty of views but few enquiries. That usually means the price, the photos or the description is putting people off rather than the animal.")}
                </Alert>
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 font-display text-lg font-semibold text-fg">{t("Listing")}</h2>
            <Card className="p-5">
              <div className="flex gap-4">
                <div className="relative size-20 shrink-0 overflow-hidden rounded-[var(--radius-field)] bg-bg-sunken">
                  {listing.pet.photos[0] && (
                    <Image
                      src={listing.pet.photos[0].url}
                      alt=""
                      fill
                      sizes="80px"
                      className="object-cover"
                    />
                  )}
                </div>
                <div className="min-w-0">
                  <Link
                    href={`/dashboard/pets/${listing.pet.id}`}
                    className="font-semibold text-fg hover:underline"
                  >
                    {listing.pet.name}
                  </Link>
                  <p className="mt-0.5 text-sm text-fg-muted">
                    {t("Health documentation {score}/100", { score: listing.pet.healthScore })}
                  </p>
                  <Link
                    href={`/dashboard/pets/${listing.pet.id}/health`}
                    className="mt-1 inline-block text-xs font-semibold text-brand hover:underline"
                  >
                    {t("Improve the record")}
                  </Link>
                </div>
              </div>

              <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">
                {listing.description}
              </p>

              <dl className="mt-4 divide-y divide-[var(--border)] border-t border-[var(--border)]">
                <DataRow label={t("Location")} value={[listing.city, listing.country].filter(Boolean).join(", ") || "Not set"} />
                <DataRow label={t("Created")} value={fmt.date(listing.createdAt, "long")} />
                {listing.publishedAt && (
                  <DataRow label={t("Published")} value={fmt.date(listing.publishedAt, "long")} />
                )}
                {listing.expiresAt && (
                  <DataRow
                    label={t("Expires")}
                    value={
                      <span
                        className={
                          listing.expiresAt < expiringSoon
                            ? "text-[var(--warning)]"
                            : undefined
                        }
                      >
                        {fmt.date(listing.expiresAt, "long")}
                      </span>
                    }
                  />
                )}
              </dl>
            </Card>
          </section>

          {listing.intent === "ADOPTION" && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-display text-lg font-semibold text-fg">{t("Applications")}</h2>
                {applications > 0 && (
                  <ButtonLink href={`/dashboard/listings/${id}/applications`} size="sm">
                    {t("Review {count}", { count: applications })}
                  </ButtonLink>
                )}
              </div>
              {applications === 0 ? (
                <Card className="p-5 text-sm text-fg-muted">
                  {t("No applications waiting. Applicants answer structured questions about their home, hours alone and experience, so you can compare them side by side.")}
                </Card>
              ) : (
                <Card className="p-5">
                  <p className="text-sm text-fg-muted">
                    {t.plural(applications, {
                      one: "{count} application is waiting for a decision.",
                      other: "{count} applications are waiting for a decision.",
                    })}
                  </p>
                </Card>
              )}
            </section>
          )}
        </div>

        <aside>
          <ListingControls
            listingId={id}
            status={listing.status}
            slug={listing.slug}
            featured={Boolean(featured)}
            featuredUntil={listing.featuredUntil}
            featured7dCents={settings.featuredListing7dCents}
            featured30dCents={settings.featuredListing30dCents}
            currency={listing.currency}
          />
        </aside>
      </div>
    </div>
  );
}
