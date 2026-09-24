"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Trash2, Minus, Plus, Lock, AlertTriangle, CreditCard, Banknote } from "lucide-react";
import { Card, Alert } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/components/i18n/i18n-provider";
import { goToPayment } from "@/lib/payment-redirect";
import { api, ApiError } from "@/lib/api-client";
import { stableKey, clearStableKey } from "@/lib/api-idempotency";
import { cn } from "@/lib/utils";
import type { CartSummary } from "@/lib/services/commerce.service";
import { track } from "@/lib/analytics";

type PaymentMethod = "ONLINE" | "COD";

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
  defaultPhone = "",
  myCoupons = [],
}: {
  initialCart: CartSummary;
  defaultName: string;
  defaultCity: string | null;
  defaultCountry: string | null;
  /** A verified mobile number, so COD buyers do not type it again. */
  defaultPhone?: string;
  /** Personal codes (a referral welcome) the buyer can still use. */
  myCoupons?: string[];
}) {
  const { t, tm, fmt } = useI18n();
  const router = useRouter();
  const toast = useToast();

  const [cart, setCart] = useState(initialCart);
  const [updating, setUpdating] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [method, setMethod] = useState<PaymentMethod>("ONLINE");
  const [coupon, setCoupon] = useState<{ code: string; discountCents: number } | null>(null);
  const [couponInput, setCouponInput] = useState("");
  const [couponError, setCouponError] = useState<string | null>(null);
  const [applyingCoupon, setApplyingCoupon] = useState(false);

  async function applyCoupon(code: string) {
    setApplyingCoupon(true);
    setCouponError(null);
    try {
      const quote = await api.post<{ code: string; discountCents: number }>("/api/cart", { action: "preview-coupon", code });
      setCoupon(quote);
      setCouponInput("");
    } catch (err) {
      setCoupon(null);
      setCouponError(err instanceof ApiError ? err.message : t("Please try again."));
    } finally {
      setApplyingCoupon(false);
    }
  }

  const [shipping, setShipping] = useState({
    shippingName: defaultName,
    shippingPhone: defaultPhone,
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

  // A basket that stops qualifying (an item removed, the total over the cap)
  // falls back to paying online rather than submitting a choice that fails.
  const cod = method === "COD" && cart.cashOnDelivery.available;

  async function changeQuantity(itemId: string, quantity: number) {
    setUpdating(itemId);
    try {
      const next = await api.post<CartSummary>("/api/cart", {
        action: quantity <= 0 ? "remove" : "update",
        itemId,
        ...(quantity > 0 ? { quantity } : {}),
      });
      setCart(next);
      // The discount depends on the basket, so check the code again.
      if (coupon) void applyCoupon(coupon.code);
      router.refresh();
    } catch (err) {
      toast.error(t("Could not update the basket"), err instanceof ApiError ? err.message : t("Please try again."));
    } finally {
      setUpdating(null);
    }
  }

  async function checkout() {
    track({ name: "begin_checkout", value: cart.totalCents - (coupon?.discountCents ?? 0), currency: cart.currency });
    setCheckingOut(true);
    setError(null);
    setFieldErrors({});

    try {
      const result = await api.post<{
        order: { id: string; orderNumber: string; totalCents: number; currency: string };
        payment: { id: string; redirectUrl: string | null } | null;
        redirectUrl?: string;
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
          paymentMethod: cod ? "COD" : "ONLINE",
          couponCode: coupon?.code,
        },
        idempotencyKey: stableKey("checkout"),
      });

      // The attempt is now a real order; a later checkout needs a new key.
      clearStableKey("checkout");

      if (!result.payment) {
        // Cash on delivery: the order is placed now, so this is the conversion.
        track({ name: "purchase", transactionId: result.order.orderNumber, value: result.order.totalCents, currency: result.order.currency });
        router.push(result.redirectUrl ?? `/dashboard/orders/${result.order.id}`);
        router.refresh();
      } else if (result.payment.redirectUrl) {
        goToPayment(result.payment.redirectUrl, router.push);
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

        // Stock or eligibility changed underneath us: reload the basket so the
        // buyer sees why.
        const fresh = await api.get<CartSummary>("/api/cart").catch(() => null);
        if (fresh) setCart(fresh);
      } else {
        setError(t("Something went wrong. Please try again."));
      }
      setCheckingOut(false);
    }
  }

  const canCheckout =
    cart.items.some((i) => i.available) &&
    shipping.shippingName.trim().length >= 2 &&
    shipping.shippingLine1.trim().length >= 3 &&
    shipping.shippingCity.trim().length >= 1 &&
    shipping.shippingCountry.trim().length >= 2 &&
    (!cod || shipping.shippingPhone.trim().length >= 7);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0 space-y-6">
        {cart.hasUnavailable && (
          <Alert tone="warning" title={t("Some items are unavailable")}>
            {t("They are excluded from the total and will not be ordered.")}
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
                    <Image src={item.product.image} alt="" fill sizes="80px" className="object-cover" />
                  )}
                </Link>

                <div className="min-w-0 flex-1">
                  <Link href={`/store/${item.product.slug}`}>
                    <h2 className="line-clamp-2 text-sm font-semibold text-fg hover:underline">{item.product.title}</h2>
                  </Link>
                  <p className="mt-0.5 text-xs text-fg-muted">{item.product.shopName}</p>

                  {!item.available && item.availabilityNote && (
                    <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--danger)]">
                      <AlertTriangle className="size-3" aria-hidden />
                      {tm(item.availabilityNote)}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void changeQuantity(item.id, item.quantity - 1)}
                        disabled={updating === item.id}
                        className="inline-flex size-8 items-center justify-center rounded-[var(--radius-field)] border border-[var(--border-strong)] text-fg-muted transition-colors hover:text-fg disabled:opacity-50"
                        aria-label={t("Decrease quantity")}
                      >
                        <Minus className="size-3.5" aria-hidden />
                      </button>
                      <span className="w-9 text-center text-sm font-medium tabular text-fg">{fmt.number(item.quantity)}</span>
                      <button
                        type="button"
                        onClick={() => void changeQuantity(item.id, item.quantity + 1)}
                        disabled={updating === item.id}
                        className="inline-flex size-8 items-center justify-center rounded-[var(--radius-field)] border border-[var(--border-strong)] text-fg-muted transition-colors hover:text-fg disabled:opacity-50"
                        aria-label={t("Increase quantity")}
                      >
                        <Plus className="size-3.5" aria-hidden />
                      </button>

                      <button
                        type="button"
                        onClick={() => void changeQuantity(item.id, 0)}
                        disabled={updating === item.id}
                        className="ms-1 inline-flex size-8 items-center justify-center rounded-[var(--radius-field)] text-fg-subtle transition-colors hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:opacity-50"
                        aria-label={t("Remove {title}", { title: item.product.title })}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </div>

                    <p className="font-semibold tabular text-fg">{fmt.money(item.totalCents, cart.currency)}</p>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>

        <Card className="p-5">
          <h2 className="font-display text-lg font-semibold text-fg">{t("Delivery address")}</h2>

          {error && (
            <div className="mt-3">
              <Alert tone="danger">{error}</Alert>
            </div>
          )}

          <div className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("Full name")} required error={fieldErrors.shippingName}>
                {({ id, invalid }) => (
                  <Input id={id} invalid={invalid} autoComplete="name" value={shipping.shippingName} onChange={(e) => set("shippingName", e.target.value)} />
                )}
              </Field>
              <Field
                label={t("Phone")}
                required={cod}
                hint={cod ? t("The courier calls before arriving with a cash-on-delivery parcel.") : t("For the courier.")}
                error={fieldErrors.shippingPhone}
              >
                {({ id, invalid }) => (
                  <Input
                    id={id}
                    invalid={invalid}
                    type="tel"
                    dir="ltr"
                    className="rtl:text-end"
                    autoComplete="tel"
                    value={shipping.shippingPhone}
                    onChange={(e) => set("shippingPhone", e.target.value)}
                  />
                )}
              </Field>
            </div>

            <Field label={t("Address")} required error={fieldErrors.shippingLine1}>
              {({ id, invalid }) => (
                <Input
                  id={id}
                  invalid={invalid}
                  autoComplete="address-line1"
                  value={shipping.shippingLine1}
                  onChange={(e) => set("shippingLine1", e.target.value)}
                  placeholder={t("14 Brazil Street")}
                />
              )}
            </Field>

            <Field label={t("Apartment, floor (optional)")}>
              {({ id }) => (
                <Input id={id} autoComplete="address-line2" value={shipping.shippingLine2} onChange={(e) => set("shippingLine2", e.target.value)} />
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("City")} required error={fieldErrors.shippingCity}>
                {({ id, invalid }) => (
                  <Input id={id} invalid={invalid} autoComplete="address-level2" value={shipping.shippingCity} onChange={(e) => set("shippingCity", e.target.value)} />
                )}
              </Field>
              <Field label={t("Region")}>
                {({ id }) => (
                  <Input id={id} autoComplete="address-level1" value={shipping.shippingRegion} onChange={(e) => set("shippingRegion", e.target.value)} />
                )}
              </Field>
              <Field label={t("Postcode")}>
                {({ id }) => (
                  <Input id={id} autoComplete="postal-code" value={shipping.shippingPostal} onChange={(e) => set("shippingPostal", e.target.value)} />
                )}
              </Field>
            </div>

            <Field label={t("Country")} required error={fieldErrors.shippingCountry}>
              {({ id, invalid }) => (
                <Input id={id} invalid={invalid} autoComplete="country-name" value={shipping.shippingCountry} onChange={(e) => set("shippingCountry", e.target.value)} />
              )}
            </Field>

            <Field label={t("Delivery notes (optional)")}>
              {({ id }) => (
                <Textarea
                  id={id}
                  rows={2}
                  maxLength={300}
                  value={shipping.shippingNote}
                  onChange={(e) => set("shippingNote", e.target.value)}
                  placeholder={t("Gate code, safe place, best time to deliver.")}
                />
              )}
            </Field>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-display text-lg font-semibold text-fg">{t("Payment")}</h2>
          <div role="radiogroup" aria-label={t("Payment method")} className="mt-4 grid gap-3 sm:grid-cols-2">
            <PaymentOption
              selected={!cod}
              onSelect={() => setMethod("ONLINE")}
              icon={<CreditCard className="size-5" aria-hidden />}
              title={t("Pay online")}
              body={t("Card, mobile wallet or kiosk, on the payment provider's secure page.")}
            />
            <PaymentOption
              selected={cod}
              disabled={!cart.cashOnDelivery.available}
              onSelect={() => setMethod("COD")}
              icon={<Banknote className="size-5" aria-hidden />}
              title={t("Cash on delivery")}
              body={
                cart.cashOnDelivery.available
                  ? t("Pay the courier in cash when your order arrives.")
                  : cart.cashOnDelivery.reason
                    ? tm(cart.cashOnDelivery.reason)
                    : t("Not available for this basket.")
              }
            />
          </div>
        </Card>
      </div>

      <aside className="lg:sticky lg:top-24 lg:h-fit">
        <Card className="p-5">
          <h2 className="font-display text-lg font-semibold text-fg">{t("Summary")}</h2>

          {cart.shops.length > 1 && (
            <p className="mt-1 text-xs text-fg-muted">
              {t.plural(cart.shops.length, {
                one: "{count} shop — each ships separately.",
                other: "{count} shops — each ships separately.",
              })}
            </p>
          )}

          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-fg-muted">{t("Subtotal")}</dt>
              <dd className="font-medium tabular text-fg">{fmt.money(cart.subtotalCents, cart.currency)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fg-muted">{t("Shipping")}</dt>
              <dd className="font-medium tabular text-fg">{fmt.money(cart.shippingCents, cart.currency, { showFree: true })}</dd>
            </div>
            {coupon && (
              <div className="flex justify-between">
                <dt className="text-fg-muted">
                  {t("Discount")} <span className="font-mono text-xs" dir="ltr">{coupon.code}</span>
                </dt>
                <dd className="font-medium tabular text-[var(--success)]">−{fmt.money(coupon.discountCents, cart.currency)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-[var(--border)] pt-2.5">
              <dt className="font-semibold text-fg">{cod ? t("To pay on delivery") : t("Total")}</dt>
              <dd className="font-display text-xl font-semibold tabular text-fg">
                {fmt.money(cart.totalCents - (coupon?.discountCents ?? 0), cart.currency)}
              </dd>
            </div>
          </dl>

          <div className="mt-4">
            {coupon ? (
              <button type="button" className="text-xs text-fg-muted hover:underline" onClick={() => setCoupon(null)}>
                {t("Remove code")}
              </button>
            ) : (
              <div className="flex gap-2">
                <Input
                  aria-label={t("Discount code")}
                  placeholder={t("Discount code")}
                  dir="ltr"
                  value={couponInput}
                  onChange={(e) => {
                    setCouponInput(e.target.value);
                    setCouponError(null);
                  }}
                  className="uppercase"
                />
                <Button variant="outline" loading={applyingCoupon} disabled={couponInput.trim().length < 2} onClick={() => void applyCoupon(couponInput)}>
                  {t("Apply")}
                </Button>
              </div>
            )}
            {couponError && <p className="mt-1.5 text-xs text-[var(--danger)]">{couponError}</p>}
            {!coupon && myCoupons.length > 0 && (
              <p className="mt-2 text-xs text-fg-muted">
                {t("You have a welcome code:")}{" "}
                <button type="button" className="font-mono font-semibold text-brand hover:underline" dir="ltr" onClick={() => void applyCoupon(myCoupons[0]!)}>
                  {myCoupons[0]}
                </button>
              </p>
            )}
          </div>

          <Button
            fullWidth
            size="lg"
            className="mt-5"
            onClick={() => void checkout()}
            loading={checkingOut}
            loadingText={t("Creating your order…")}
            disabled={!canCheckout}
          >
            {cod ? <Banknote className="size-4" aria-hidden /> : <Lock className="size-4" aria-hidden />}
            {cod ? t("Place order") : t("Checkout")}
          </Button>

          <p className="mt-3 text-xs leading-relaxed text-fg-muted">
            {cod
              ? t("Your order goes to the shop straight away. Have the exact amount ready if you can.")
              : t("Stock is reserved when you place the order and released if payment is not completed.")}
          </p>
        </Card>
      </aside>
    </div>
  );
}

function PaymentOption({
  selected,
  disabled,
  onSelect,
  icon,
  title,
  body,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex items-start gap-3 rounded-[var(--radius-field)] border p-4 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        selected ? "border-brand bg-brand-soft/40 ring-1 ring-brand" : "border-[var(--border-strong)] hover:bg-bg-sunken",
      )}
    >
      <span className={cn("mt-0.5 shrink-0", selected ? "text-brand" : "text-fg-muted")}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-fg">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">{body}</span>
      </span>
    </button>
  );
}
