"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Package, Truck, CheckCircle2, XCircle, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, Badge, EmptyState } from "@/components/ui/primitives";
import { Field, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";
import { formatDate, cn } from "@/lib/utils";

export interface FulfilmentItem {
  id: string;
  title: string;
  variant: string | null;
  imageUrl: string | null;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  sellerEarningsCents: number;
  commissionCents: number;
  fulfillmentStatus: string;
  orderNumber: string;
  orderStatus: string;
  /** COD: the courier collects the order total in cash at the door. */
  paymentMethod: string;
  currency: string;
  placedAt: string | null;
  buyerName: string;
  shippingName: string | null;
  shippingCity: string | null;
  shippingCountry: string | null;
}

const TONE: Record<string, "warning" | "info" | "success" | "neutral"> = {
  PENDING: "warning",
  PACKED: "info",
  SHIPPED: "info",
  DELIVERED: "success",
  CANCELLED: "neutral",
};

/** What each state can move to. Nothing here can go backwards. */
const NEXT: Record<string, { value: "PACKED" | "SHIPPED" | "DELIVERED"; label: string }[]> = {
  PENDING: [{ value: "PACKED", label: "Mark packed" }],
  PACKED: [{ value: "SHIPPED", label: "Mark shipped" }],
  SHIPPED: [{ value: "DELIVERED", label: "Mark delivered" }],
};

export function FulfilmentQueue({
  items,
  shops,
  activeShopId,
  activeStatus,
}: {
  items: FulfilmentItem[];
  shops: { id: string; name: string }[];
  activeShopId: string;
  activeStatus: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  function navigate(shopId: string, status: string) {
    const params = new URLSearchParams();
    if (shopId) params.set("shopId", shopId);
    if (status !== "ALL") params.set("status", status);
    router.push(`/sell/orders${params.toString() ? `?${params}` : ""}`);
  }

  async function fulfil(itemId: string, status: string) {
    setBusy(`${itemId}:${status}`);
    try {
      await api.post("/api/store", { action: "fulfil", orderItemId: itemId, status });
      toast.success(`Marked ${status.toLowerCase()}`);
      router.refresh();
    } catch (err) {
      toast.error(
        "That did not go through",
        err instanceof ApiError ? err.message : "Please try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        {shops.length > 1 && (
          <div className="w-56">
            <Field label="Shop">
              {({ id }) => (
                <Select
                  id={id}
                  value={activeShopId}
                  onChange={(e) => navigate(e.target.value, activeStatus)}
                >
                  {shops.map((shop) => (
                    <option key={shop.id} value={shop.id}>
                      {shop.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        )}

        <div className="w-48">
          <Field label="Status">
            {({ id }) => (
              <Select
                id={id}
                value={activeStatus}
                onChange={(e) => navigate(activeShopId, e.target.value)}
              >
                <option value="ALL">All</option>
                <option value="PENDING">To pack</option>
                <option value="PACKED">To ship</option>
                <option value="SHIPPED">In transit</option>
                <option value="DELIVERED">Delivered</option>
              </Select>
            )}
          </Field>
        </div>
      </div>

      <div className="mt-5">
        {items.length === 0 ? (
          <EmptyState
            icon={<Package className="size-5" aria-hidden />}
            title="Nothing to fulfil"
            description="Paid orders appear here. Nothing arrives before payment clears, so you never pack for an order that fell through."
          />
        ) : (
          <ul className="space-y-2">
            {items.map((item) => {
              const next = NEXT[item.fulfillmentStatus] ?? [];

              return (
                <li key={item.id}>
                  <Card
                    className={cn(
                      "p-4",
                      item.fulfillmentStatus === "PENDING" &&
                        "border-[var(--warning)]/40 bg-[var(--warning-soft)]/25",
                    )}
                  >
                    <div className="flex gap-4">
                      {item.imageUrl ? (
                        <Image
                          src={item.imageUrl}
                          alt=""
                          width={56}
                          height={56}
                          className="size-14 shrink-0 rounded-xl object-cover"
                        />
                      ) : (
                        <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-bg-sunken text-fg-subtle">
                          <Package className="size-5" aria-hidden />
                        </span>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[15px] font-medium text-fg">{item.title}</span>
                          {item.variant && (
                            <span className="text-xs text-fg-subtle">{item.variant}</span>
                          )}
                          <Badge tone={TONE[item.fulfillmentStatus] ?? "neutral"} size="sm">
                            {item.fulfillmentStatus.toLowerCase()}
                          </Badge>
                          {item.paymentMethod === "COD" && (
                            <Badge tone="accent" size="sm">
                              Cash on delivery
                            </Badge>
                          )}
                        </div>

                        <p className="mt-0.5 text-xs text-fg-subtle">
                          <span className="font-mono">{item.orderNumber}</span> ·{" "}
                          {item.quantity} ×{" "}
                          {formatMoney(item.unitPriceCents, item.currency)}
                          {item.placedAt ? ` · ${formatDate(item.placedAt)}` : ""}
                        </p>

                        <p className="mt-1 flex items-center gap-1.5 text-xs text-fg-muted">
                          <MapPin className="size-3" aria-hidden />
                          {item.shippingName ?? item.buyerName}
                          {item.shippingCity ? `, ${item.shippingCity}` : ""}
                          {item.shippingCountry ? `, ${item.shippingCountry}` : ""}
                        </p>

                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          <span className="text-sm font-semibold tabular text-fg">
                            {formatMoney(item.sellerEarningsCents, item.currency)}
                          </span>
                          <span className="text-xs text-fg-subtle tabular">
                            of {formatMoney(item.totalCents, item.currency)} ·{" "}
                            {formatMoney(item.commissionCents, item.currency)} commission
                          </span>
                        </div>

                        {next.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {next.map((step) => (
                              <Button
                                key={step.value}
                                size="sm"
                                loading={busy === `${item.id}:${step.value}`}
                                onClick={() => fulfil(item.id, step.value)}
                              >
                                {step.value === "PACKED" && (
                                  <Package className="size-4" aria-hidden />
                                )}
                                {step.value === "SHIPPED" && (
                                  <Truck className="size-4" aria-hidden />
                                )}
                                {step.value === "DELIVERED" && (
                                  <CheckCircle2 className="size-4" aria-hidden />
                                )}
                                {step.label}
                              </Button>
                            ))}
                            <Button
                              size="sm"
                              variant="ghost"
                              loading={busy === `${item.id}:CANCELLED`}
                              onClick={() => fulfil(item.id, "CANCELLED")}
                            >
                              <XCircle className="size-4" aria-hidden />
                              Cannot fulfil
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
