import Link from "next/link";
import { ShieldCheck, Plus, Minus, ArrowRight } from "lucide-react";
import { Card, Badge } from "@/components/ui/primitives";
import { TRUST_TIER_LABEL, type TrustTier } from "@/lib/constants";
import type { TrustBreakdown } from "@/lib/services/trust.service";
import { getI18n } from "@/lib/i18n/server";

/**
 * The trust score, broken down.
 *
 * A score nobody can interrogate is a number people learn to ignore. This one
 * shows exactly what earned it and exactly what would raise it, which is the
 * only way a trust system changes behaviour rather than just labelling it.
 */
export async function TrustMeter({ trust }: { trust: TrustBreakdown }) {
  const { t } = await getI18n();
  const tone =
    trust.score >= 60
      ? "text-[var(--success)]"
      : trust.score >= 30
        ? "text-brand"
        : "text-[var(--warning)]";

  const circumference = 2 * Math.PI * 34;
  const offset = circumference - (Math.min(100, trust.score) / 100) * circumference;

  return (
    <Card className="p-5">
      <div className="flex items-center gap-4">
        <div className="relative size-20 shrink-0">
          <svg viewBox="0 0 80 80" className="size-20 -rotate-90" aria-hidden>
            <circle
              cx="40"
              cy="40"
              r="34"
              fill="none"
              stroke="var(--border)"
              strokeWidth="7"
            />
            <circle
              cx="40"
              cy="40"
              r="34"
              fill="none"
              stroke="currentColor"
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className={tone}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-display text-xl font-semibold tabular text-fg">
              {trust.score}
            </span>
          </div>
        </div>

        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 font-display text-base font-semibold text-fg">
            <ShieldCheck className="size-4 text-brand" aria-hidden />
            {t("Trust score")}
          </h2>
          <Badge tone={trust.score >= 60 ? "success" : "brand"} size="sm" className="mt-1.5">
            {t(TRUST_TIER_LABEL[trust.tier as TrustTier])}
          </Badge>
          <p className="mt-1.5 text-xs leading-snug text-fg-muted">
            {t("Buyers and sellers see this on your profile.")}
          </p>
        </div>
      </div>

      {trust.earned.length > 0 && (
        <div className="mt-4 border-t border-[var(--border)] pt-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            {t("What earned it")}
          </p>
          <ul className="mt-2 space-y-1.5">
            {trust.earned.slice(0, 4).map((signal) => (
              <li key={signal.kind} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-1.5 text-fg-muted">
                  <Plus className="size-3 shrink-0 text-[var(--success)]" aria-hidden />
                  <span className="truncate">
                    {t(signal.label)}
                    {signal.count > 1 && <span className="text-fg-subtle"> ×{signal.count}</span>}
                  </span>
                </span>
                <span className="shrink-0 font-semibold tabular text-[var(--success)]">
                  +{signal.points}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {trust.lost.length > 0 && (
        <div className="mt-3">
          <ul className="space-y-1.5">
            {trust.lost.slice(0, 2).map((signal) => (
              <li key={signal.kind} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-1.5 text-fg-muted">
                  <Minus className="size-3 shrink-0 text-[var(--danger)]" aria-hidden />
                  <span className="truncate">{t(signal.label)}</span>
                </span>
                <span className="shrink-0 font-semibold tabular text-[var(--danger)]">
                  {signal.points}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {trust.available.length > 0 && (
        <div className="mt-4 rounded-[var(--radius-field)] bg-bg-sunken p-3">
          <p className="text-xs font-semibold text-fg">{t("Raise your score")}</p>
          <ul className="mt-1.5 space-y-1">
            {trust.available.slice(0, 3).map((option) => (
              <li key={option.kind} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-fg-muted">{t(option.label)}</span>
                <span className="shrink-0 font-semibold tabular text-brand">+{option.points}</span>
              </li>
            ))}
          </ul>
          <Link
            href="/settings/verification"
            className="mt-2.5 inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
          >
            {t("Get verified")}
            <ArrowRight className="rtl:-scale-x-100 size-3" aria-hidden />
          </Link>
        </div>
      )}
    </Card>
  );
}
