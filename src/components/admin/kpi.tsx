import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sparkline } from "./charts/static-charts";

/**
 * Stat tile: label · value · delta against the previous period · trend.
 * The delta's colour follows direction × whether up is good, and always comes
 * with an arrow and a sign, so it never relies on colour alone.
 */
export function KpiTile({
  label,
  value,
  delta,
  upIsGood = true,
  hint,
  trend,
  href,
  icon,
}: {
  label: string;
  value: string;
  delta?: number | null;
  upIsGood?: boolean;
  hint?: string;
  trend?: number[];
  href?: string;
  icon?: React.ReactNode;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-fg-muted">{label}</p>
        {icon && (
          <span className="flex size-8 items-center justify-center rounded-[10px] bg-brand-soft text-brand [&_svg]:size-4">
            {icon}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="min-w-0 truncate font-display text-[1.7rem] font-bold leading-none text-fg tabular">{value}</p>
        {trend && <Sparkline values={trend} className="shrink-0" />}
      </div>
      <div className="mt-3 min-w-0 text-xs">
        {delta !== undefined && <Delta value={delta} upIsGood={upIsGood} />}
        {hint && <p className="mt-0.5 truncate text-fg-subtle">{hint}</p>}
      </div>
    </>
  );

  const className = "surface block p-5 shadow-[var(--shadow-subtle)]";
  return href ? (
    <Link href={href} className={cn(className, "surface-lift")}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export function Delta({ value, upIsGood = true }: { value: number | null; upIsGood?: boolean }) {
  if (value === null) {
    return <span className="font-semibold text-[var(--info)]">New this period</span>;
  }
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  if (rounded === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 font-semibold text-fg-muted">
        <Minus className="size-3.5" aria-hidden />
        No change
      </span>
    );
  }
  const up = rounded > 0;
  const good = up === upIsGood;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 whitespace-nowrap font-semibold tabular",
        good ? "text-[var(--success)]" : "text-[var(--danger)]",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {up ? "+" : "−"}
      {Math.abs(rounded) >= 100 ? Math.round(Math.abs(rounded)) : Math.abs(rounded).toFixed(1)}%
      <span className="font-normal text-fg-subtle">&nbsp;vs previous period</span>
    </span>
  );
}
