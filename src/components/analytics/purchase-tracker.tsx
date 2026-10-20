"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics";

/**
 * Reports a paid checkout once. The payment page can be reloaded or revisited,
 * so the payment id is remembered for the session and the ad platforms are
 * also given it as the event id to drop duplicates on their side.
 */
export function PurchaseTracker({ paymentId, valueCents, currency }: { paymentId: string; valueCents: number; currency: string }) {
  useEffect(() => {
    const key = `pm_purchase_${paymentId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // Private mode: the platforms' own de-duplication by event id still applies.
    }
    track({ name: "purchase", transactionId: paymentId, value: valueCents, currency });
  }, [paymentId, valueCents, currency]);
  return null;
}
