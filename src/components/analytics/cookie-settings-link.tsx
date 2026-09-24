"use client";

import { analyticsConfigured, openConsent } from "@/lib/analytics";

/** Lets a visitor change their cookie choice later. Hidden when there is nothing to choose. */
export function CookieSettingsLink({ label }: { label: string }) {
  if (!analyticsConfigured()) return null;
  return (
    <button type="button" onClick={openConsent} className="underline underline-offset-2 hover:text-fg-muted">
      {label}
    </button>
  );
}
