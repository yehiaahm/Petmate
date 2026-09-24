import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Banknote, CreditCard, Package, Truck } from "lucide-react";
import { requireAuth } from "@/lib/auth/rbac";
import { getOrderForBuyer } from "@/lib/services/commerce.service";
import { isAppError } from "@/lib/errors";
import { getI18n } from "@/lib/i18n/server";
import { PageHeader, Breadcrumbs, Card, CardHeader, Alert, StatusPill } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { CancelOrder } from "@/components/orders/cancel-order";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("Order"), robots: { index: false, follow: false } };
}

const ORDER_TONE: Record<string, "info" | "warning" | "success" | "danger" | "neutral"> = {
  PENDING_PAYMENT: "warning",
  CONFIRMED: "info",
  PAID: "info",
  PROCESSING: "info",
  SHIPPED: "info",
  DELIVERED: "success",
  CANCELLED: "neutral",
  REFUNDED: "neutral",
  PARTIALLY_REFUNDED: "neutral",
};

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [auth, { t, fmt }] = await Promise.all([requireAuth(), getI18n()]);

  const order = await getOrderForBuyer(auth, id).catch((error) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });

  const orderStatus: Record<string, string> = {
    PENDING_PAYMENT: t("Awaiting payment"),
    CONFIRMED: t("Confirmed · pay on delivery"),
    PAID: t("Paid"),
    PROCESSING: t("Being prepared"),
    SHIPPED: t("On its way"),
    DELIVERED: t("Delivered"),
    CANCELLED: t("Cancelled"),
    REFUNDED: t("Refunded"),
    PARTIALLY_REFUNDED: t("Partly refunded"),
  };
  const itemStatus: Record<string, string> = {
    PENDING: t("Awaiting the shop"),
    PACKED: t("Packed"),
    SHIPPED: t("Shipped"),
    DELIVERED: t("Delivered"),
    CANCELLED: t("Cancelled"),
    RETURNED: t("Returned"),
  };
  const deliveryStatus: Record<string, string> = {
    PENDING: t("Being prepared"),
    ASSIGNED: t("Courier assigned"),
    PICKED_UP: t("Collected by the courier"),
    IN_TRANSIT: t("In transit"),
    OUT_FOR_DELIVERY: t("Out for delivery"),
    DELIVERED: t("Delivered"),
    FAILED: t("Delivery attempt failed"),
    RETURNED: t("Returned to the shop"),
    CANCELLED: t("Cancelled"),
  };

  const cod = order.paymentMethod === "COD";
  const byShop = [...new Set(order.items.map((i) => i.shopId))].map((shopId) => ({
    shopId,
    shop: order.items.find((i) => i.shopId === shopId)!.shop,
    items: order.items.filter((i) => i.shopId === shopId),
    delivery: order.deliveries.find((d) => d.shopId === shopId) ?? null,
  }));

  return (
    <div className="container-page max-w-3xl py-8 lg:py-10">
      <Breadcrumbs items={[{ label: t("Orders"), href: "/dashboard/orders" }, { label: order.orderNumber }]} />

      <PageHeader
        title={t("Order {number}", { number: order.orderNumber })}
        description={t("Placed {date}", { date: fmt.dateTime(order.placedAt ?? order.createdAt) })}
        action={
          <StatusPill tone={ORDER_TONE[order.status] ?? "neutral"}>{orderStatus[order.status] ?? order.status}</StatusPill>
        }
      />

      {cod && !["DELIVERED", "CANCELLED"].includes(order.status) && (
        <Alert tone="info" className="mt-6" icon={<Banknote className="size-4" aria-hidden />} title={t("Cash on delivery")}>
          {t("Pay {amount} in cash when your order arrives. The courier will call {phone} before delivering.", {
            amount: fmt.money(order.totalCents, order.currency),
            phone: order.shippingPhone ?? "",
          })}
        </Alert>
      )}

      {order.pendingPayment && (
        <Alert tone="warning" className="mt-6" icon={<CreditCard className="size-4" aria-hidden />} title={t("Payment not finished")}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{t("Your items are reserved for a short while. Finish paying to send the order to the shop.")}</span>
            <ButtonLink href={`/checkout/${order.pendingPayment.id}`} size="sm">
              {t("Finish paying")}
            </ButtonLink>
          </div>
        </Alert>
      )}

      {order.status === "CANCELLED" && order.cancelReason && (
        <Alert tone="info" className="mt-6" title={t("Cancelled")}>
          {order.cancelReason}
        </Alert>
      )}

      <div className="mt-6 space-y-4">
        {byShop.map((group) => (
          <Card key={group.shopId}>
            <CardHeader
              title={
                <Link href={`/store?shopId=${group.shopId}`} className="hover:underline">
                  {group.shop.name}
                </Link>
              }
              description={
                group.delivery ? (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <Truck className="size-4" aria-hidden />
                    {deliveryStatus[group.delivery.status] ?? group.delivery.status}
                    <span className="font-mono text-xs" dir="ltr">
                      {group.delivery.trackingNumber}
                    </span>
                  </span>
                ) : undefined
              }
            />
            <ul className="divide-y divide-[var(--border)]">
              {group.items.map((item) => (
                <li key={item.id} className="flex items-center gap-4 p-4">
                  <div className="relative size-14 shrink-0 overflow-hidden rounded-[var(--radius-field)] bg-bg-sunken">
                    {item.imageSnapshot ? (
                      <Image src={item.imageSnapshot} alt="" fill sizes="56px" className="object-cover" />
                    ) : (
                      <Package className="m-auto mt-4 size-5 text-fg-subtle" aria-hidden />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{item.titleSnapshot}</p>
                    <p className="text-xs text-fg-subtle">
                      {t("Qty {n}", { n: item.quantity })} · {itemStatus[item.fulfillmentStatus] ?? item.fulfillmentStatus}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular text-fg">{fmt.money(item.totalCents, order.currency)}</p>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-fg">{t("Delivery address")}</h2>
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">
            {order.shippingName}
            <br />
            {order.shippingLine1}
            {order.shippingLine2 ? `, ${order.shippingLine2}` : ""}
            <br />
            {order.shippingCity}, {order.shippingCountry}
            {order.shippingPhone && (
              <>
                <br />
                <span dir="ltr">{order.shippingPhone}</span>
              </>
            )}
          </p>
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-fg">{cod ? t("Cash on delivery") : t("Payment")}</h2>
          <dl className="mt-2 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-fg-muted">{t("Subtotal")}</dt>
              <dd className="tabular text-fg">{fmt.money(order.subtotalCents, order.currency)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fg-muted">{t("Shipping")}</dt>
              <dd className="tabular text-fg">{fmt.money(order.shippingCents, order.currency, { showFree: true })}</dd>
            </div>
            {order.discountCents > 0 && (
              <div className="flex justify-between">
                <dt className="text-fg-muted">{t("Discount")}</dt>
                <dd className="tabular text-[var(--success)]">−{fmt.money(order.discountCents, order.currency)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-[var(--border)] pt-2 font-semibold">
              <dt className="text-fg">{t("Total")}</dt>
              <dd className="tabular text-fg">{fmt.money(order.totalCents, order.currency)}</dd>
            </div>
          </dl>
        </Card>
      </div>

      {order.cancellable && (
        <div className="mt-6 flex justify-end">
          <CancelOrder orderId={order.id} paid={order.status === "PAID" || order.status === "PROCESSING"} />
        </div>
      )}
    </div>
  );
}
