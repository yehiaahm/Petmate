import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ShoppingBag, PawPrint, Package } from "lucide-react";
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { listPurchases, listSales } from "@/lib/services/petorder.service";
import { PageHeader, Card, Badge, EmptyState, StatusPill } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { formatDate, relativeTime } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Orders",
  robots: { index: false, follow: false },
};

const PET_ORDER_TONE: Record<string, "info" | "warning" | "success" | "danger" | "neutral"> = {
  PENDING_PAYMENT: "warning",
  IN_ESCROW: "info",
  HANDOVER_PENDING: "warning",
  COMPLETED: "success",
  CANCELLED: "neutral",
  REFUNDED: "neutral",
  DISPUTED: "danger",
};

const ORDER_TONE: Record<string, "info" | "warning" | "success" | "danger" | "neutral"> = {
  PENDING: "warning",
  PAID: "info",
  PROCESSING: "info",
  SHIPPED: "info",
  DELIVERED: "success",
  COMPLETED: "success",
  CANCELLED: "neutral",
  REFUNDED: "neutral",
};

const PET_ORDER_LABEL: Record<string, string> = {
  PENDING_PAYMENT: "Awaiting payment",
  IN_ESCROW: "Held in escrow",
  HANDOVER_PENDING: "Confirm handover",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
  DISPUTED: "In dispute",
};

export default async function OrdersPage() {
  const auth = await requireAuth();

  const [purchases, sales, productOrders] = await Promise.all([
    listPurchases(auth),
    listSales(auth),
    db.order.findMany({
      where: { buyerId: auth.user.id },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalCents: true,
        currency: true,
        createdAt: true,
        _count: { select: { items: true } },
      },
    }),
  ]);

  const nothing =
    purchases.length === 0 && sales.length === 0 && productOrders.length === 0;

  if (nothing) {
    return (
      <div className="container-page max-w-4xl py-8 lg:py-10">
        <PageHeader title="Orders" />
        <EmptyState
          className="mt-6"
          icon={<ShoppingBag className="size-5" aria-hidden />}
          title="Nothing here yet"
          description="Pet purchases, sales and store orders all appear here, with their escrow state and every confirmation that has happened."
          action={<ButtonLink href="/pets">Browse pets</ButtonLink>}
        />
      </div>
    );
  }

  return (
    <div className="container-page max-w-4xl py-8 lg:py-10">
      <PageHeader
        title="Orders"
        description="Everything you have bought or sold, and exactly where the money is."
      />

      <div className="mt-8 space-y-10">
        {purchases.length > 0 && (
          <section>
            <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-fg">
              <PawPrint className="size-4.5 text-brand" aria-hidden />
              Pets you bought
            </h2>
            <ul className="mt-4 space-y-2">
              {purchases.map((order) => (
                <li key={order.id}>
                  <Link href={`/dashboard/purchases/${order.id}`} className="block">
                    <Card interactive className="flex items-center gap-4 p-4">
                      <OrderThumb
                        url={order.listing.pet.photos[0]?.url}
                        alt={order.listing.pet.name}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-medium text-fg">
                          {order.listing.title}
                        </p>
                        <p className="mt-0.5 text-xs text-fg-subtle">
                          <span className="font-mono">{order.orderNumber}</span> ·{" "}
                          {formatDate(order.createdAt)}
                          {order.status === "IN_ESCROW" && order.autoReleaseAt
                            ? ` · auto-releases ${relativeTime(order.autoReleaseAt)}`
                            : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-end">
                        <p className="text-sm font-semibold tabular text-fg">
                          {formatMoney(order.amountCents, order.currency)}
                        </p>
                        <Badge tone={PET_ORDER_TONE[order.status] ?? "neutral"} size="sm">
                          {PET_ORDER_LABEL[order.status] ?? order.status}
                        </Badge>
                      </div>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {sales.length > 0 && (
          <section>
            <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-fg">
              <PawPrint className="size-4.5 text-accent" aria-hidden />
              Pets you sold
            </h2>
            <ul className="mt-4 space-y-2">
              {sales.map((order) => (
                <li key={order.id}>
                  <Link href={`/dashboard/sales/${order.id}`} className="block">
                    <Card interactive className="flex items-center gap-4 p-4">
                      <OrderThumb
                        url={order.listing.pet.photos[0]?.url}
                        alt={order.listing.pet.name}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-medium text-fg">
                          {order.listing.title}
                        </p>
                        <p className="mt-0.5 text-xs text-fg-subtle">
                          <span className="font-mono">{order.orderNumber}</span> ·{" "}
                          {formatDate(order.createdAt)}
                        </p>
                      </div>
                      <div className="shrink-0 text-end">
                        <p className="text-sm font-semibold tabular text-fg">
                          {formatMoney(order.sellerPayoutCents, order.currency)}
                        </p>
                        <p className="text-xs text-fg-subtle tabular">
                          of {formatMoney(order.amountCents, order.currency)}
                        </p>
                        <Badge tone={PET_ORDER_TONE[order.status] ?? "neutral"} size="sm">
                          {PET_ORDER_LABEL[order.status] ?? order.status}
                        </Badge>
                      </div>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {productOrders.length > 0 && (
          <section>
            <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-fg">
              <Package className="size-4.5 text-brand" aria-hidden />
              Store orders
            </h2>
            <ul className="mt-4 space-y-2">
              {productOrders.map((order) => (
                <li key={order.id}>
                  <Card className="flex items-center gap-4 p-4">
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-bg-sunken text-fg-subtle">
                      <Package className="size-5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-sm text-fg">{order.orderNumber}</p>
                      <p className="mt-0.5 text-xs text-fg-subtle">
                        {order._count.items} {order._count.items === 1 ? "item" : "items"} ·{" "}
                        {formatDate(order.createdAt)}
                      </p>
                    </div>
                    <div className="shrink-0 text-end">
                      <p className="text-sm font-semibold tabular text-fg">
                        {formatMoney(order.totalCents, order.currency)}
                      </p>
                      <StatusPill tone={ORDER_TONE[order.status] ?? "neutral"}>
                        {order.status.toLowerCase()}
                      </StatusPill>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function OrderThumb({ url, alt }: { url?: string; alt: string }) {
  if (!url) {
    return (
      <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-bg-sunken text-fg-subtle">
        <PawPrint className="size-5" aria-hidden />
      </span>
    );
  }
  return (
    <Image
      src={url}
      alt={alt}
      width={48}
      height={48}
      className="size-12 shrink-0 rounded-xl object-cover"
    />
  );
}
