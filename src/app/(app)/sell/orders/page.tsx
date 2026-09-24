import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Package } from "lucide-react";
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { listShopOrders } from "@/lib/services/commerce.service";
import { isAppError } from "@/lib/errors";
import { FulfilmentQueue } from "@/components/sell/fulfilment-queue";
import { PageHeader, Breadcrumbs, EmptyState } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Shop orders",
  robots: { index: false, follow: false },
};

export default async function ShopOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ shopId?: string; status?: string }>;
}) {
  const [params, auth] = await Promise.all([searchParams, requireAuth()]);

  const shops = await db.shop.findMany({
    where: { ownerUserId: auth.user.id, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });

  if (shops.length === 0) {
    return (
      <div className="container-page max-w-3xl py-8 lg:py-10">
        <PageHeader title="Shop orders" />
        <EmptyState
          className="mt-6"
          icon={<Package className="size-5" aria-hidden />}
          title="You do not have a shop"
          description="Shops sell products — food, medication, beds. Listing an animal is a separate thing and does not need one."
          action={<ButtonLink href="/sell">Back to the console</ButtonLink>}
        />
      </div>
    );
  }

  // Default to the first shop rather than asking a question with one answer.
  const shopId = params.shopId ?? shops[0]!.id;
  const shop = shops.find((s) => s.id === shopId);
  if (!shop) notFound();

  let items;
  try {
    items = await listShopOrders(auth, shop.id, params.status);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <div className="container-page max-w-4xl py-8 lg:py-10">
      <Breadcrumbs
        items={[
          { label: "Seller console", href: "/sell" },
          { label: "Orders" },
        ]}
      />

      <PageHeader
        title="Orders to fulfil"
        description="Marking an item shipped moves the whole order forward only once every seller on it has shipped, so a multi-shop order never claims to be further along than it is."
      />

      <div className="mt-6">
        <FulfilmentQueue
          shops={shops}
          activeShopId={shop.id}
          activeStatus={params.status ?? "ALL"}
          items={items.map((item) => ({
            id: item.id,
            title: item.titleSnapshot,
            variant: item.variantSnapshot,
            imageUrl: item.imageSnapshot,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
            totalCents: item.totalCents,
            sellerEarningsCents: item.sellerEarningsCents,
            commissionCents: item.commissionCents,
            fulfillmentStatus: item.fulfillmentStatus,
            orderNumber: item.order.orderNumber,
            orderStatus: item.order.status,
            paymentMethod: item.order.paymentMethod,
            currency: item.order.currency,
            placedAt: item.order.placedAt?.toISOString() ?? null,
            buyerName: item.order.buyer.name,
            shippingName: item.order.shippingName,
            shippingCity: item.order.shippingCity,
            shippingCountry: item.order.shippingCountry,
          }))}
        />
      </div>
    </div>
  );
}
