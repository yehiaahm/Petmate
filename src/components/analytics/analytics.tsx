"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Cookie } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n/i18n-provider";
import {
  GA_ID,
  PIXEL_ID,
  CONSENT_EVENT,
  analyticsConfigured,
  readConsent,
  writeConsent,
  trackPageView,
  type Consent,
} from "@/lib/analytics";

let loaded = false;

// A tiny store over the consent cookie, so every reader re-renders when it changes.
const listeners = new Set<() => void>();
const subscribeConsent = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const notifyConsent = () => listeners.forEach((l) => l());
const readConsentSnapshot = (): Consent | null => readConsent();

function loadScripts() {
  if (loaded) return;
  loaded = true;

  if (GA_ID) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() {
      // gtag.js reads the arguments object itself, exactly as Google's snippet does.
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
    window.gtag("js", new Date());
    // Page views are sent by us on every route change, including the first.
    window.gtag("config", GA_ID, { send_page_view: false });
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
    document.head.appendChild(script);
  }

  if (PIXEL_ID && !window.fbq) {
    const fbq = function (...args: unknown[]) {
      if (fbq.callMethod) fbq.callMethod(...args);
      else fbq.queue!.push(args);
    } as NonNullable<Window["fbq"]> & { push?: unknown; loaded?: boolean; version?: string };
    fbq.queue = [];
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = "2.0";
    window.fbq = fbq;
    window._fbq = fbq;
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(script);
    window.fbq("init", PIXEL_ID);
  }
}

/**
 * The cookie choice, and the measurement scripts it allows. Renders nothing
 * when no analytics ID is configured: then there is nothing to consent to.
 */
export function Analytics() {
  const { t } = useI18n();
  const pathname = usePathname();
  // The cookie is only readable in the browser; on the server the answer is
  // "unknown", which renders nothing, so both renders agree.
  const consent = useSyncExternalStore(subscribeConsent, readConsentSnapshot, () => "unknown" as const);
  const [reopened, setReopened] = useState(false);
  const asking = analyticsConfigured() && (consent === null || reopened);

  useEffect(() => {
    const reopen = () => setReopened(true);
    window.addEventListener(CONSENT_EVENT, reopen);
    return () => window.removeEventListener(CONSENT_EVENT, reopen);
  }, []);

  useEffect(() => {
    if (consent !== "granted") return;
    loadScripts();
    trackPageView(pathname);
  }, [consent, pathname]);

  function choose(value: Consent) {
    writeConsent(value);
    notifyConsent();
    setReopened(false);
    // Taking consent back means the scripts must not run on the next page.
    if (value === "denied" && loaded) window.location.reload();
  }

  if (!asking) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={t("Cookie choice")}
      className="fixed inset-x-3 bottom-20 z-50 mx-auto max-w-xl rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-pop)] lg:bottom-4"
    >
      <div className="flex gap-3">
        <Cookie className="mt-0.5 size-5 shrink-0 text-fg-subtle" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm text-fg">
            {t("We would like to use analytics cookies from Google and Meta to see which of our ads bring people to PetMate. They are off unless you allow them, and PetMate works the same either way.")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => choose("granted")}>
              {t("Allow analytics")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => choose("denied")}>
              {t("Only necessary cookies")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
