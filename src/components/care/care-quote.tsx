"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { api, ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";
import { CANCELLATION_POLICY_SUMMARY, type CancellationPolicy } from "@/lib/constants";

export interface CareQuoteResult {
  currency: string;
  startAt: string;
  endAt: string;
  nights: number;
  distanceKm: number | null;
  cancellationPolicy: CancellationPolicy;
  serviceCents: number;
  transportCents: number;
  totalCents: number;
  lines: { label: string; amountCents: number }[];
}

/**
 * Asks the server what this booking would cost, running every check a real
 * booking runs. The panel never adds prices up itself: the number shown is
 * the number charged, and an impossible booking says why before "Pay".
 */
export function useCareQuote(booking: Record<string, unknown> | null, enabled: boolean) {
  const key = booking ? JSON.stringify(booking) : null;
  const [state, setState] = useState<{ key: string | null; quote: CareQuoteResult | null; error: string | null }>({
    key: null,
    quote: null,
    error: null,
  });

  useEffect(() => {
    if (!enabled || !key) return;
    let cancelled = false;

    const timer = window.setTimeout(() => {
      api
        .post<{ quote: CareQuoteResult }>("/api/care/bookings", { action: "quote", booking: JSON.parse(key) })
        .then((result) => {
          if (!cancelled) setState({ key, quote: result.quote, error: null });
        })
        .catch((err) => {
          if (!cancelled) {
            setState({
              key,
              quote: null,
              error: err instanceof ApiError ? err.message : "We could not price that booking.",
            });
          }
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [key, enabled]);

  const current = enabled && key !== null && state.key === key;
  return {
    loading: enabled && key !== null && !current,
    quote: current ? state.quote : null,
    error: current ? state.error : null,
  };
}

export function QuoteSummary({ quote, loading }: { quote: CareQuoteResult | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-[var(--radius-field)] bg-bg-sunken p-3 text-sm text-fg-muted">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Pricing your booking…
      </div>
    );
  }
  if (!quote) return null;

  return (
    <div className="rounded-[var(--radius-field)] bg-bg-sunken p-3.5 text-sm">
      <ul className="space-y-1.5">
        {quote.lines.map((line) => (
          <li key={line.label} className="flex items-baseline justify-between gap-3">
            <span className="text-fg-muted">{line.label}</span>
            <span className="tabular text-fg">{formatMoney(line.amountCents, quote.currency)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2.5 flex items-baseline justify-between border-t border-[var(--border)] pt-2.5">
        <span className="font-semibold text-fg">Total</span>
        <span className="font-display text-xl font-bold tabular text-fg">
          {formatMoney(quote.totalCents, quote.currency)}
        </span>
      </div>
      {quote.distanceKm != null && (
        <p className="mt-1.5 text-xs text-fg-subtle">{quote.distanceKm} km from the provider, straight line.</p>
      )}
      <p className="mt-2 flex items-start gap-1.5 text-xs text-fg-muted">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
        {CANCELLATION_POLICY_SUMMARY[quote.cancellationPolicy]}
      </p>
    </div>
  );
}
