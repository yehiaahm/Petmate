"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatMoney } from "@/lib/money";
import { compactNumber } from "@/lib/utils";

export interface TrendSeries {
  key: string;
  label: string;
  /** 1-5: the fixed categorical slot (teal, coral, blue, gold, violet). */
  slot: 1 | 2 | 3 | 4 | 5;
  values: number[];
}

/**
 * Time-series chart with a crosshair and tooltip.
 *
 * One unit per chart, always: money and counts never share an axis. Lines are
 * 2px, a single series gets a 10% wash, end dots carry a surface ring, and the
 * numbers are also available as a table, because a line nobody can read is
 * not an accessible chart. Arrow keys move the crosshair when focused.
 */
export function TrendChart({
  dates,
  series,
  unit,
  currency = "USD",
  height = 240,
  weekly = false,
}: {
  dates: string[];
  series: TrendSeries[];
  unit: "money" | "count";
  currency?: string;
  height?: number;
  weekly?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);
  const gradientId = useId().replaceAll(":", "");

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(280, Math.round(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const n = dates.length;
  if (n === 0 || series.length === 0) {
    return <p className="py-10 text-center text-sm text-fg-muted">No activity in this period.</p>;
  }

  const fmt = (v: number) => (unit === "money" ? formatMoney(v, currency) : v.toLocaleString("en-US"));
  const fmtAxis = (v: number) =>
    unit === "money" ? formatMoney(v, currency, { compact: true }) : compactNumber(v);

  const pad = { top: 14, right: 14, bottom: 28, left: unit === "money" ? 58 : 40 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const rawMax = Math.max(0, ...series.flatMap((s) => s.values));
  // An empty period still gets a readable axis: $0–$100, or 0–4.
  const { max, ticks } = niceScale(rawMax > 0 ? rawMax : unit === "money" ? 10_000 : 4);

  const x = (i: number) => pad.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - (max ? (v / max) * innerH : 0);

  const linePath = (values: number[]) =>
    values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const areaPath = (values: number[]) =>
    `${linePath(values)} L${x(n - 1).toFixed(1)},${pad.top + innerH} L${x(0).toFixed(1)},${pad.top + innerH} Z`;

  const labelIdx = n <= 2 ? [0, n - 1] : [0, Math.floor((n - 1) / 2), n - 1];
  const single = series.length === 1;

  function indexAt(clientX: number, rect: DOMRect) {
    const px = ((clientX - rect.left) / rect.width) * width;
    const ratio = (px - pad.left) / innerW;
    return Math.min(n - 1, Math.max(0, Math.round(ratio * (n - 1))));
  }

  const active = hover ?? null;
  const tooltipLeft = active !== null ? x(active) : 0;
  const flip = tooltipLeft > width * 0.62;

  return (
    <figure className="m-0">
      {!single && (
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-fg-muted">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="h-[3px] w-4 rounded-full" style={{ background: `var(--viz-${s.slot})` }} aria-hidden />
              {s.label}
              <span className="font-semibold text-fg tabular">{fmt(s.values.reduce((a, b) => a + b, 0))}</span>
            </span>
          ))}
        </div>
      )}

      <div ref={wrapRef} className="relative">
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block touch-pan-y select-none overflow-visible rounded-[10px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ring)]"
          role="img"
          tabIndex={0}
          aria-label={`${series.map((s) => s.label).join(", ")} from ${formatDay(dates[0]!)} to ${formatDay(dates[n - 1]!)}. Use the arrow keys to read each point, or open the data table below.`}
          onPointerMove={(e) => setHover(indexAt(e.clientX, e.currentTarget.getBoundingClientRect()))}
          onPointerLeave={() => setHover(null)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
            else if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n) - 1));
            else return;
            e.preventDefault();
          }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={`var(--viz-${series[0]!.slot})`} stopOpacity="0.16" />
              <stop offset="100%" stopColor={`var(--viz-${series[0]!.slot})`} stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Recessive grid: hairline, solid, one step off the surface. */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth="1" />
              <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-[var(--viz-axis)] text-[11px] tabular">
                {fmtAxis(t)}
              </text>
            </g>
          ))}

          {labelIdx.map((i, k) => (
            <text
              key={`${i}-${k}`}
              x={x(i)}
              y={height - 8}
              textAnchor={k === 0 ? "start" : k === labelIdx.length - 1 ? "end" : "middle"}
              className="fill-[var(--viz-axis)] text-[11px]"
            >
              {formatDay(dates[i]!)}
            </text>
          ))}

          {single && <path d={areaPath(series[0]!.values)} fill={`url(#${gradientId})`} />}

          {series.map((s) => (
            <path
              key={s.key}
              d={linePath(s.values)}
              fill="none"
              stroke={`var(--viz-${s.slot})`}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {/* End markers when nothing is hovered: where each series landed. */}
          {active === null &&
            series.map((s) => (
              <circle
                key={s.key}
                cx={x(n - 1)}
                cy={y(s.values[n - 1] ?? 0)}
                r="4.5"
                fill={`var(--viz-${s.slot})`}
                stroke="var(--viz-surface)"
                strokeWidth="2"
              />
            ))}

          {active !== null && (
            <g>
              <line
                x1={x(active)}
                x2={x(active)}
                y1={pad.top}
                y2={pad.top + innerH}
                stroke="var(--fg-subtle)"
                strokeWidth="1"
              />
              {series.map((s) => (
                <circle
                  key={s.key}
                  cx={x(active)}
                  cy={y(s.values[active] ?? 0)}
                  r="5"
                  fill={`var(--viz-${s.slot})`}
                  stroke="var(--viz-surface)"
                  strokeWidth="2"
                />
              ))}
            </g>
          )}
        </svg>

        {active !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-[12px] border border-[var(--border)] bg-bg-elevated px-3 py-2.5 shadow-[var(--shadow-pop)]"
            style={{
              left: `${(tooltipLeft / width) * 100}%`,
              transform: flip ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
            }}
            role="status"
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
              {weekly ? `Week of ${formatDay(dates[active]!)}` : formatDay(dates[active]!, true)}
            </p>
            <ul className="mt-1.5 space-y-1">
              {series.map((s) => (
                <li key={s.key} className="flex items-center justify-between gap-4 text-sm">
                  <span className="flex items-center gap-1.5 text-fg-muted">
                    <span className="size-2 rounded-full" style={{ background: `var(--viz-${s.slot})` }} aria-hidden />
                    {s.label}
                  </span>
                  <span className="font-semibold text-fg tabular">{fmt(s.values[active] ?? 0)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-fg-subtle hover:text-fg">Show the data</summary>
        <div className="admin-scroll mt-2 max-h-56 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-bg-elevated">
              <tr className="text-fg-subtle">
                <th scope="col" className="py-1 pr-3 font-medium">{weekly ? "Week of" : "Date"}</th>
                {series.map((s) => (
                  <th key={s.key} scope="col" className="py-1 pr-3 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-fg-muted">
              {dates.map((d, i) => (
                <tr key={d} className="border-t border-[var(--border)]">
                  <td className="py-1 pr-3 tabular">{d}</td>
                  {series.map((s) => (
                    <td key={s.key} className="py-1 pr-3 text-right tabular">
                      {fmt(s.values[i] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** Rounds the top of the axis up to a clean number and returns 4-5 ticks. */
function niceScale(rawMax: number): { max: number; ticks: number[] } {
  // Every series here is whole units (counts, or money in cents), so a step
  // below 1 would only produce repeated tick labels.
  const roughStep = Math.max(1, rawMax / 4);
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const step = Math.max(
    1,
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= roughStep && Number.isInteger(s)) ?? roughStep,
  );
  const max = Math.ceil(rawMax / step) * step;
  const ticks: number[] = [];
  for (let i = 0; i * step <= max; i++) ticks.push(i * step);
  return { max, ticks };
}

function formatDay(iso: string, withYear = false) {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}
