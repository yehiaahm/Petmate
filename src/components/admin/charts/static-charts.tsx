import { cn } from "@/lib/utils";

/**
 * Charts that need no interaction, rendered on the server: no hydration cost,
 * and the numbers are always in the markup as text next to the marks.
 */

/** 12-ish point trend for a stat tile. De-emphasised line, last point in the accent. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const w = 120;
  const h = 32;
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * (w - 6) + 3;
  const y = (v: number) => h - 4 - ((v - min) / span) * (h - 8);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values.length - 1;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-8 w-[120px]", className)} aria-hidden>
      <path d={d} fill="none" stroke="var(--fg-subtle)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.7" />
      <circle cx={x(last)} cy={y(values[last]!)} r="3.5" fill="var(--viz-1)" stroke="var(--viz-surface)" strokeWidth="2" />
    </svg>
  );
}

/**
 * Ranked magnitudes: one hue, because the bars share one measure and the
 * category is already named in text beside each bar.
 */
export function BarList({
  rows,
  format,
  empty = "Nothing in this period.",
}: {
  rows: { label: string; value: number; hint?: string; href?: string }[];
  format: (v: number) => string;
  empty?: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-fg-muted">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-fg-muted">
              {row.label}
              {row.hint && <span className="ml-1.5 text-xs text-fg-subtle">{row.hint}</span>}
            </span>
            <span className="shrink-0 font-semibold text-fg tabular">{format(row.value)}</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-bg-sunken">
            <div
              className="h-full rounded-full bg-[var(--viz-1)]"
              style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Part-to-whole as one segmented bar with a legend. Slots are assigned in
 * fixed order and anything past the fourth folds into "Other", so a fifth
 * status never gets a generated colour.
 */
export function SegmentBar({
  rows,
  label,
}: {
  rows: { label: string; value: number }[];
  label: string;
}) {
  const total = rows.reduce((a, r) => a + r.value, 0);
  if (total === 0) return <p className="text-sm text-fg-muted">No records yet.</p>;

  const top = rows.slice(0, 4);
  const rest = rows.slice(4).reduce((a, r) => a + r.value, 0);
  const segments = [
    ...top.map((r, i) => ({ ...r, color: `var(--viz-${i + 1})` })),
    ...(rest > 0 ? [{ label: "Other", value: rest, color: "var(--fg-subtle)" }] : []),
  ];

  return (
    <div>
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={`${label}: ${segments.map((s) => `${s.label} ${s.value}`).join(", ")}`}>
        {segments.map((s) => (
          <div key={s.label} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} className="h-full first:rounded-l-full last:rounded-r-full" />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex min-w-0 items-center gap-1.5 text-fg-muted">
              <span className="size-2 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
              <span className="truncate">{s.label}</span>
            </span>
            <span className="font-semibold text-fg tabular">
              {s.value.toLocaleString("en-US")}
              <span className="ml-1 font-normal text-fg-subtle">{Math.round((s.value / total) * 100)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
