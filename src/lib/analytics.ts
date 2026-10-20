/**
 * Marketing measurement (Google Analytics 4 and the Meta Pixel), in the
 * browser only, and only after the visitor has said yes.
 *
 * `track` is safe to call anywhere: without consent, or without an ID
 * configured, it does nothing. Events carry what an ad platform needs to
 * count a conversion (value, currency, an order reference) and never who the
 * person is.
 *
 * Client-safe.
 */

import { clientEnv } from "@/lib/env";

export const CONSENT_COOKIE = "pm_consent";
export type Consent = "granted" | "denied";
export const CONSENT_EVENT = "pm:consent-open";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: ((...args: unknown[]) => void) & { callMethod?: (...args: unknown[]) => void; queue?: unknown[] };
    _fbq?: unknown;
  }
}

export const GA_ID = clientEnv.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "";
export const PIXEL_ID = clientEnv.NEXT_PUBLIC_META_PIXEL_ID ?? "";
export const analyticsConfigured = () => Boolean(GA_ID || PIXEL_ID);

export function readConsent(): Consent | null {
  if (typeof document === "undefined") return null;
  const value = /(?:^|;\s*)pm_consent=(granted|denied)/.exec(document.cookie)?.[1];
  return (value as Consent | undefined) ?? null;
}

export function writeConsent(value: Consent) {
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${value}; path=/; max-age=${365 * 86_400}; samesite=lax${secure}`;
}

/** Opens the cookie choice again, from the footer link. */
export function openConsent() {
  window.dispatchEvent(new Event(CONSENT_EVENT));
}

type Money = { value: number; currency: string };

export type TrackEvent =
  | { name: "sign_up"; method?: string }
  | ({ name: "add_to_cart" } & Money)
  | ({ name: "begin_checkout" } & Money)
  | ({ name: "purchase"; transactionId: string } & Money);

/** Values are sent in pounds, as both platforms expect, not piastres. */
export function track(event: TrackEvent) {
  if (typeof window === "undefined" || readConsent() !== "granted") return;
  const money = "value" in event ? { value: Math.round(event.value) / 100, currency: event.currency } : {};

  if (window.gtag) {
    const params =
      event.name === "purchase"
        ? { ...money, transaction_id: event.transactionId }
        : event.name === "sign_up"
          ? { method: event.method ?? "email" }
          : money;
    window.gtag("event", event.name, params);
  }
  if (window.fbq) {
    const pixelName = {
      sign_up: "CompleteRegistration",
      add_to_cart: "AddToCart",
      begin_checkout: "InitiateCheckout",
      purchase: "Purchase",
    }[event.name];
    window.fbq("track", pixelName, money, event.name === "purchase" ? { eventID: event.transactionId } : undefined);
  }
}

export function trackPageView(path: string) {
  if (typeof window === "undefined" || readConsent() !== "granted") return;
  window.gtag?.("event", "page_view", { page_path: path, page_location: window.location.origin + path });
  window.fbq?.("track", "PageView");
}
