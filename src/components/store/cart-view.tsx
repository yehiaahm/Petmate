"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Trash2, Minus, Plus, Lock, AlertTriangle } from "lucide-react";
import { Card, Alert } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { stableKey, clearStableKey } from "@/lib/api-idempotency";
import { formatMoney } from "@/lib/money";
import type { CartSummary } from "@/lib/services/commerce.service";

/**
 * Basket and checkout.
 *
 * The basket holds variant ids and quantities; every price on screen comes
 * from the server's own calculation, which is the same calculation the charge
 * uses. There is no total in any request body.
 *
 * The idempotency key is stable per attempt and survives a refresh, so
 * reloading mid-checkout returns the original order rather than opening a
 * second one.
 */
export function CartView({
  initialCart,
  defaultName,
  defaultCity,
  defaultCountry,
}: {
  initialCart: CartSummary;
  defaultName: string;
  defaultCity: string | null;
  defaultCountry: string | null;
}) {
  const router = useRouter();
  const toast = useToast();

  const [cart, setCart] = useState(initialCart);
  const [updating, setUpdating] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [shipping, setShipping] = useState({
    shippingName: defaultName,
    shippingPhone: "",
    shippingLine1: "",
    shippingLine2: "",
    shippingCity: defaultCity ?? "",
    shippingRegion: "",
    shippingCountry: defaultCountry ?? "",
    shippingPostal: "",
    shippingNote: "",
  });

  function set<K extends keyof typeof shipping>(key: K, value: string) {
    setShipping((s) => ({ ...s, [key]: value }));
  }

  async function changeQuantity(itemId: string, quantity: number) {
    setUpdating(itemId);
    try {
      const next = await api.post<CartSummary>("/api/cart", {
        action: quantity <= 0 ? "remove" : "update",
        itemId,
        ...(quantity > 0 ? { quantity } : {}),
      });
      setCart(next);
      router.refresh();
    } catch (err) {
      toast.error(
        "Could not update the basket",
        err instanceof ApiError ? err.message : "Please try again.",
      );
    } finally {
      setUpdating(null);
    }
  }

  async function checkout() {
    setCheckingOut(true);
    setError(null);
    setFieldErrors({});

    try {
      const result = await api.post<{
        order: { id: string; orderNumber: string };
        payment: { id: string; redirectUrl: string | null };
      }>("/api/cart", {
        action: "checkout",
        shipping: {
          shippingName: shipping.shippingName,
          shippingPhone: shipping.shippingPhone || undefined,
          shippingLine1: shipping.shippingLine1,
          shippingLine2: shipping.shippingLine2 || undefined,
          shippingCity: shipping.shippingCity,
          shippingRegion: shipping.shippingRegion || undefined,
          shippingCountry: shipping.shippingCountry,
          shippingPostal: shipping.shippingPostal || undefined,
          shippingNote: shipping.shippingNote || undefined,
        },
        idempotencyKey: stableKey("checkout"),
      });

      // The attempt is now a real order; a later checkout needs a new key.
      clearStableKey("checkout");

      if (result.payment.redirectUrl) {
        router.push(result.payment.redirectUrl);
      } else {
        router.push(`/checkout/${result.payment.id}`);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        const map: Record<string, string> = {};
        for (const field of err.fields) {
          map[field.field.replace("shipping.", "")] = field.message;
        }
        setFieldErrors(map);

        // Stock changed underneath us: reload the basket so the user sees why.
        if (/sold out|stock|no longer/i.test(err.message)) {
          const fresh = await api.get<CartSummary>("/api/cart").catch(() => null);
          if (fresh) setCart(fresh);
        }
      } else {
        setError("Something went wrong. Please try again.");
      }
      setCheckingOut(false);
    }
  }

  const canCheckout =
    cart.items.some((i) => i.available) &&
    shipping.shippingName.trim().length >= 2 &&
    shipping.shippingLine1.trim().length >= 3 &&
    shipping.shippingCity.trim().length >= 1 &&
    shipping.shippingCountry.trim().length >= 2;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0 space-y-6">
        {cart.hasUnavailable && (
          <Alert tone="warning" title="Some items are unavailable">
            They are excluded from the total and will not be ordered.
          </Alert>
        )}

        <ul className="space-y-3">
          {cart.items.map((item) => (
            <li key={item.id}>
              <Card className="flex gap-4 p-4">
                <Link
                  href={`/store/${item.product.slug}`}
                  className="relative size-20 shrink-0 overflow-hidden rounded-[var(--radius-field)] bg-bg-sunken"
                >
                  {item.product.image && (
                    <Image
                      src={item.product.image}
                      alt=""
                      fill
                      sizes="80px"
                      className="object-cover"
                    />
                  )}
                </Link>

                <div className="min-w-0 flex-1">
                  <Link href={`/store/${item.product.slug}`}>
                    <h2 className="line-clamp-2 text-sm font-semibold text-fg hover:underline">
                      {item.product.title}
                    </h2>
                  </Link>
                  <p className="mt-0.5 text-xs text-fg-muted">{item.product.shopName}</p>

                  {!item.available && item.availabilityNote && (
                    <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--danger)]">
                      <AlertTriangle className="size-3" aria-hidden />
                      {item.availabilityNote}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void changeQuantity(item.id, item.quantity - 1)}
                        disabled={updating === item.id}
                        className="inline-flex size-8 items-center justify-center rounded-[var(--radius-field)] border border-[var(--border-strong)] text-fg-muted transition-colors hover:text-fg disabled:opacity-50"
                        aria-label="Decrease quantity"
                      >
                        <Minus className="size-3.5" aria-hidden />
                      </button>
                      <span className="w-9 text-center text-sm font-medium tabular text-fg">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => void changeQuantity(item.id, item.quantity + 1)}
                        disabled={updating === item.id}
                        className="inline-flex size-8 items-center justify-center rounded-[var(--radius-field)] border border-[var(--border-strong)] text-fg-muted transition-colors hover:text-fg disabled:opacity-50"
                        aria-label="Increase quantity"
                      >
                        <Plus className="size-3.5" aria-hidden />
                      </button>

                      <button
                        type="button"
                        onClick={() => void changeQuantity(item.id, 0)}
                        disabled={updating === item.id}
                        className="ms-1 inline-flex size-8 items-center justify-center rounded-[var(--radius-field)] text-fg-subtle transition-colors hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:opacity-50"
                        aria-label={`Remove ${item.product.title}`}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </div>

                    <p className="font-semibold tabular text-fg">
                      {formatMoney(item.totalCents, cart.currency)}
                    </p>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>

        <Card className="p-5">
          <h2 className="font-display text-lg font-semibold text-fg">Delivery address</h2>

          {error && (
            <div className="mt-3">
              <Alert tone="danger">{error}</Alert>
            </div>
          )}

          <div className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" required error={fieldErrors.shippingName}>
                {({ id, invalid }) => (
                  <Input
                    id={id}
                    invalid={invalid}
                    autoComplete="name"
                    value={shipping.shippingName}
                    onChange={(e) => set("shippingName", e.target.value)}
                  />
                )}
              </Field>
              <Field label="Phone" hint="For the courier." error={fieldErrors.shippingPhone}>
                {({ id, invalid }) => (
                  <Input
                    id={id}
                    invalid={invalid}
                    type="tel"
                    autoComplete="tel"
                    value={shipping.shippingPhone}
                    onChange={(e) => set("shippingPhone", e.target.value)}
                  />
                )}
              </Field>
            </div>

            <Field label="Address" required error={fieldErrors.shippingLine1}>
              {({ id, invalid }) => (
                <Input
                  id={id}
                  invalid={invalid}
                  autoComplete="address-line1"
                  value={shipping.shippingLine1}
                  onChange={(e) => set("shippingLine1", e.target.value)}
                  placeholder="14 Brazil Street"
                />
              )}
            </Field>

            <Field label="Apartment, floor (optional)">
              {({ id }) => (
                <Input
                  id={id}
                  autoComplete="address-line2"
                  value={shipping.shippingLine2}
                  onChange={(e) => set("shippingLine2", e.target.value)}
                />
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="City" required error={fieldErrors.shippingCity}>
                {({ id, invalid }) => (
                  <Input
                    id={id}
                    invalid={invalid}
                    autoComplete="address-level2"
                    value={shipping.shippingCity}
                    onChange={(e) => set("shippingCity", e.target.value)}
                  />
                )}
              </Field>
              <Field label="Region">
                {({ id }) => (
                  <Input
                    id={id}
                    autoComplete="address-level1"
                    value={shipping.shippingRegion}
                    onChange={(e) => set("shippingRegion", e.target.value)}
                  />
                )}
              </Field>
              <Field label="Postcode">
                {({ id }) => (
                  <Input
                    id={id}
                    autoComplete="postal-code"
                    value={shipping.shippingPostal}
                    onChange={(e) => set("shippingPostal", e.target.value)}
                  />
                )}
              </Field>
            </div>

            <Field label="Country" required error={fieldErrors.shippingCountry}>
              {({ id, invalid }) => (
                <Input
                  id={id}
                  invalid={invalid}
                  autoComplete="country-name"
                  value={shipping.shippingCountry}
                  onChange={(e) => set("shippingCountry", e.target.value)}
                />
              )}
            </Field>

            <Field label="Delivery notes (optional)">
              {({ id }) => (
                <Textarea
                  id={id}
                  rows={2}
                  maxLength={300}
                  value={shipping.shippingNote}
                  onChange={(e) => set("shippingNote", e.target.value)}
                  placeholder="Gate code, safe place, best time to deliver."
                />
              )}
            </Field>
          </div>
        </Card>
      </div>

      <aside className="lg:sticky lg:top-24 lg:h-fit">
        <Card className="p-5">
          <h2 className="font-display text-lg font-semibold text-fg">Summary</h2>

          {cart.shops.length > 1 && (
            <p className="mt-1 text-xs text-fg-muted">
              {cart.shops.length} shops — each ships separately.
            </p>
          )}

          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-fg-muted">Subtotal</dt>
              <dd className="font-medium tabular text-fg">
                {formatMoney(cart.subtotalCents, cart.currency)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fg-muted">Shipping</dt>
              <dd className="font-medium tabular text-fg">
                {cart.shippingCents === 0 ? "Free" : formatMoney(cart.shippingCents, cart.currency)}
              </dd>
            </div>
            <div className="flex justify-between border-t border-[var(--border)] pt-2.5">
              <dt className="font-semibold text-fg">Total</dt>
              <dd className="font-display text-xl font-semibold tabular text-fg">
                {formatMoney(cart.totalCents, cart.currency)}
              </dd>
            </div>
          </dl>

          <Button
            fullWidth
            size="lg"
            className="mt-5"
            onClick={() => void checkout()}
            loading={checkingOut}
            loadingText="Creating your order…"
            disabled={!canCheckout}
          >
            <Lock className="size-4" aria-hidden />
            Checkout
          </Button>

          <p className="mt-3 text-xs leading-relaxed text-fg-muted">
            Stock is reserved when you place the order and released if payment is not completed.
          </p>
        </Card>
      </aside>
    </div>
  );
}
