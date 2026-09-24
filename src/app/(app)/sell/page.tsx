import type { Metadata } from "next";
import Link from "next/link";
import {
  Tag,
  Eye,
  Heart,
  MessageSquare,
  Wallet,
  Plus,
  TrendingUp,
} from "lucide-react";
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getSellerAnalytics } from "@/lib/services/analytics.service";
import { getEarnings } from "@/lib/payments/ledger-core";
import { getSettings } from "@/lib/settings";
import { bpsToPercent, formatMoney } from "@/lib/money";
import { PageHeader, Card, CardHeader, Stat, Badge, EmptyState } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { formatDate, compactNumber } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Seller console",
  robots: { index: false, follow: false },
};

const LISTING_TONE: Record<string, "success" | "warning" | "info" | "neutral" | "danger"> = {
  ACTIVE: "success",
  PENDING_REVIEW: "warning",
  DRAFT: "neutral",
  PAUSED: "neutral",
  RESERVED: "info",
  COMPLETED: "success",
  REJECTED: "danger",
  EXPIRED: "neutral",
  REMOVED: "danger",
};

export default async function SellerConsolePage() {
  const auth = await requireAuth();

  const now = new Date();
  const from = new Date(now.getTime() - 30 * 86_400_000);

  const [analytics, earnings, settings, shops, openApplications, pendingSales] = await Promise.all([
    getSellerAnalytics(auth.user.id, { from, to: now }),
    getEarnings("USER", auth.user.id, auth.user.currency),
    getSettings(),
    db.shop.findMany({
      where: { ownerUserId: auth.user.id, deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        _count: { select: { products: true } },
      },
    }),
    db.adoptionApplication.count({
      where: {
        listing: { sellerId: auth.user.id },
        status: { in: ["SUBMITTED", "IN_REVIEW"] },
      },
    }),
    db.petOrder.count({
      where: { sellerId: auth.user.id, status: { in: ["IN_ESCROW", "HANDOVER_PENDING"] } },
    }),
  ]);

  const shopIds = shops.map((s) => s.id);
  const unfulfilled = shopIds.length
    ? await db.orderItem.count({
        where: {
          shopId: { in: shopIds },
          fulfillmentStatus: { in: ["PENDING", "PACKED"] },
          order: { status: { notIn: ["PENDING_PAYMENT", "CANCELLED"] } },
        },
      })
    : 0;

  return (
    <div className="container-page max-w-5xl py-8 lg:py-10">
      <PageHeader
        eyebrow="Seller console"
        title="Your selling"
        description={`Listings, orders and what you are owed. PetMate takes ${bpsToPercent(settings.commissionPetSaleBps)} of a completed pet sale and ${bpsToPercent(settings.commissionProductBps)} of a product order — and nothing at all on a listing that does not sell.`}
        action={
          <ButtonLink href="/dashboard/listings/new">
            <Plus className="size-4" aria-hidden />
            New listing
          </ButtonLink>
        }
      />

      {(pendingSales > 0 || openApplications > 0 || unfulfilled > 0) && (
        <ul className="mt-6 grid gap-3 sm:grid-cols-3">
          {pendingSales > 0 && (
            <li>
              <Link href="/dashboard/orders" className="block">
                <Card interactive className="p-4">
                  <p className="text-sm text-fg-muted">Sales awaiting handover</p>
                  <p className="mt-1 font-display text-2xl font-semibold tabular text-accent">
                    {pendingSales}
                  </p>
                </Card>
              </Link>
            </li>
          )}
          {openApplications > 0 && (
            <li>
              <Link href="/dashboard/listings" className="block">
                <Card interactive className="p-4">
                  <p className="text-sm text-fg-muted">Applications to read</p>
                  <p className="mt-1 font-display text-2xl font-semibold tabular text-accent">
                    {openApplications}
                  </p>
                </Card>
              </Link>
            </li>
          )}
          {unfulfilled > 0 && (
            <li>
              <Link href="/sell/orders" className="block">
                <Card interactive className="p-4">
                  <p className="text-sm text-fg-muted">Orders to ship</p>
                  <p className="mt-1 font-display text-2xl font-semibold tabular text-accent">
                    {unfulfilled}
                  </p>
                </Card>
              </Link>
            </li>
          )}
        </ul>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Views (30d)"
          value={compactNumber(analytics.totals.views)}
          icon={<Eye className="size-4" aria-hidden />}
        />
        <Stat
          label="Saved"
          value={compactNumber(analytics.totals.favorites)}
          icon={<Heart className="size-4" aria-hidden />}
        />
        <Stat
          label="Enquiries"
          value={compactNumber(analytics.totals.conversations)}
          hint={`${analytics.viewToInquiry}% of views`}
          icon={<MessageSquare className="size-4" aria-hidden />}
        />
        <Stat
          label="Earned (30d)"
          value={formatMoney(analytics.totals.earningsCents, auth.user.currency)}
          hint={`${analytics.totals.sales} pet sales · ${analytics.totals.productsSold} products`}
          icon={<TrendingUp className="size-4" aria-hidden />}
        />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_300px] lg:items-start">
        <Card>
          <CardHeader
            title="Your listings"
            description="Ranked by views. Enquiry rate is enquiries per hundred views — a low rate on high views is usually the price or the photos, not the demand."
            action={
              <ButtonLink href="/dashboard/listings" variant="outline" size="sm">
                Manage
              </ButtonLink>
            }
          />
          <div className="p-5">
            {analytics.listings.length === 0 ? (
              <EmptyState
                className="border-0 py-8"
                icon={<Tag className="size-5" aria-hidden />}
                title="Nothing listed yet"
                description="A listing is created from a pet record, so the health history and lineage come with it rather than being retyped."
                action={<ButtonLink href="/dashboard/listings/new">Create a listing</ButtonLink>}
              />
            ) : (
              <div className="-mx-5 overflow-x-auto px-5">
                <table className="w-full text-start text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-xs text-fg-subtle">
                      <th scope="col" className="py-2 pe-3 font-medium">
                        Listing
                      </th>
                      <th scope="col" className="py-2 pe-3 text-end font-medium">
                        Views
                      </th>
                      <th scope="col" className="py-2 pe-3 text-end font-medium">
                        Saved
                      </th>
                      <th scope="col" className="py-2 text-end font-medium">
                        Enquiry rate
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.listings.map((listing) => (
                      <tr
                        key={listing.id}
                        className="border-b border-[var(--border)] last:border-0"
                      >
                        <td className="py-2.5 pe-3">
                          <Link
                            href={`/dashboard/listings/${listing.id}`}
                            className="font-medium text-fg hover:underline"
                          >
                            {listing.title}
                          </Link>
                          <span className="ms-2 inline-block align-middle">
                            <Badge tone={LISTING_TONE[listing.status] ?? "neutral"} size="sm">
                              {listing.status.replaceAll("_", " ").toLowerCase()}
                            </Badge>
                          </span>
                          <span className="block text-xs text-fg-subtle">
                            {formatMoney(listing.priceCents, listing.currency)}
                            {listing.publishedAt
                              ? ` · published ${formatDate(listing.publishedAt)}`
                              : " · not published"}
                          </span>
                        </td>
                        <td className="py-2.5 pe-3 text-end tabular text-fg-muted">
                          {listing.viewCount}
                        </td>
                        <td className="py-2.5 pe-3 text-end tabular text-fg-muted">
                          {listing.favoriteCount}
                        </td>
                        <td className="py-2.5 text-end tabular text-fg-muted">
                          {listing.conversionRate}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>

        <aside className="space-y-5">
          <Card>
            <CardHeader title="Balance" />
            <div className="p-5">
              <p className="font-display text-2xl font-semibold tabular text-fg">
                {formatMoney(earnings.availableCents, earnings.currency)}
              </p>
              <p className="mt-0.5 text-xs text-fg-subtle">
                available · {formatMoney(earnings.pendingCents, earnings.currency)} pending
              </p>
              <p className="mt-3 text-xs leading-relaxed text-fg-subtle">
                Money from a sale sits in pending until the dispute window closes, because a refund
                has to come from somewhere.
              </p>
              <div className="mt-4">
                <ButtonLink href="/dashboard/wallet" variant="outline" size="sm" fullWidth>
                  <Wallet className="size-4" aria-hidden />
                  Wallet
                </ButtonLink>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Shops"
              action={
                shops.length > 0 ? (
                  <ButtonLink href="/sell/orders" variant="outline" size="sm">
                    Orders
                  </ButtonLink>
                ) : undefined
              }
            />
            <div className="p-5">
              {shops.length === 0 ? (
                <p className="text-sm leading-relaxed text-fg-muted">
                  You do not have a shop. A shop is for products — food, medication, beds — and is
                  separate from listing an animal.
                </p>
              ) : (
                <ul className="space-y-2">
                  {shops.map((shop) => (
                    <li key={shop.id} className="flex items-center justify-between gap-3">
                      <Link
                        href={`/store?shopId=${shop.id}`}
                        className="min-w-0 truncate text-sm font-medium text-fg hover:underline"
                      >
                        {shop.name}
                      </Link>
                      <span className="shrink-0 text-xs text-fg-subtle tabular">
                        {shop._count.products} products
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="What you are charged" />
            <div className="p-5">
              <ul className="space-y-1.5 text-sm text-fg-muted">
                <li className="flex justify-between gap-3">
                  <span>Pet sales</span>
                  <span className="font-medium tabular text-fg">
                    {bpsToPercent(settings.commissionPetSaleBps)}
                  </span>
                </li>
                <li className="flex justify-between gap-3">
                  <span>Products</span>
                  <span className="font-medium tabular text-fg">
                    {bpsToPercent(settings.commissionProductBps)}
                  </span>
                </li>
                <li className="flex justify-between gap-3">
                  <span>Adoption fees</span>
                  <span className="font-medium text-[var(--success)]">free</span>
                </li>
              </ul>
              <p className="mt-3 text-xs leading-relaxed text-fg-subtle">
                Charged only on completion. A cancelled or refunded transaction reverses its
                commission with it.
              </p>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
