import { formatMoney } from "@/lib/money";

interface Point {
  date: string;
  users: number;
  listings: number;
  gmvCents: number;
  orders: number;
}

/**
 * Daily activity, drawn as inline SVG.
 *
 * No charting library: three series over thirty points does not justify
 * shipping one, and an SVG the server renders needs no hydration. The data is
 * also emitted as a real table for screen readers, because a line nobody can
 * read is not an accessible chart.
 */
export function TrendChart({ series, currency }: { series: Point[]; currency: string }) {
  if (series.length === 0) {
    return <p className="text-sm text-fg-muted">No activity in this period.</p>;
  }

  const width = 560;
  const height = 160;
  const pad = { top: 8, right: 8, bottom: 20, left: 8 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const maxGmv = Math.max(1, ...series.map((d) => d.gmvCents));
  const maxCount = Math.max(1, ...series.map((d) => Math.max(d.users, d.listings)));

  const x = (i: number) =>
    pad.left + (series.length === 1 ? innerW / 2 : (i / (series.length - 1)) * innerW);

  const line = (values: number[], max: number) =>
    values
      .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${(pad.top + innerH - (v / max) * innerH).toFixed(1)}`)
      .join(" ");

  const area = (values: number[], max: number) =>
    `${line(values, max)} L${x(values.length - 1).toFixed(1)},${pad.top + innerH} L${x(0).toFixed(1)},${pad.top + innerH} Z`;

  const gmv = series.map((d) => d.gmvCents);
  const users = series.map((d) => d.users);
  const listings = series.map((d) => d.listings);

  const totalGmv = gmv.reduce((a, b) => a + b, 0);
  const totalUsers = users.reduce((a, b) => a + b, 0);
  const totalListings = listings.reduce((a, b) => a + b, 0);

  const first = series[0]!;
  const last = series[series.length - 1]!;

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-40 w-full"
        role="img"
        aria-label={`Daily activity from ${first.date} to ${last.date}: ${formatMoney(totalGmv, currency)} of completed value, ${totalUsers} new members, ${totalListings} new listings.`}
      >
        <defs>
          <linearGradient id="gmvFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <path d={area(gmv, maxGmv)} fill="url(#gmvFill)" />
        <path
          d={line(gmv, maxGmv)}
          fill="none"
          stroke="var(--brand)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d={line(users, maxCount)}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.5"
          strokeDasharray="4 3"
          strokeLinejoin="round"
        />
        <path
          d={line(listings, maxCount)}
          fill="none"
          stroke="var(--fg-subtle)"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />

        <text x={pad.left} y={height - 4} className="fill-[var(--fg-subtle)] text-[10px]">
          {first.date}
        </text>
        <text
          x={width - pad.right}
          y={height - 4}
          textAnchor="end"
          className="fill-[var(--fg-subtle)] text-[10px]"
        >
          {last.date}
        </text>
      </svg>

      <figcaption className="mt-3 flex flex-wrap gap-4 text-xs text-fg-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-brand" aria-hidden />
          Completed value · {formatMoney(totalGmv, currency)}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-accent" aria-hidden />
          New members · {totalUsers}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-[var(--fg-subtle)]" aria-hidden />
          New listings · {totalListings}
        </span>
      </figcaption>

      {/* The same numbers, readable. A chart alone is not an accessible table. */}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-fg-subtle hover:text-fg">
          Show the data
        </summary>
        <div className="mt-2 max-h-56 overflow-auto">
          <table className="w-full text-start text-xs">
            <thead className="sticky top-0 bg-bg-elevated">
              <tr className="text-fg-subtle">
                <th scope="col" className="py-1 pe-3 font-medium">Date</th>
                <th scope="col" className="py-1 pe-3 text-end font-medium">Members</th>
                <th scope="col" className="py-1 pe-3 text-end font-medium">Listings</th>
                <th scope="col" className="py-1 text-end font-medium">Value</th>
              </tr>
            </thead>
            <tbody className="text-fg-muted">
              {series.map((d) => (
                <tr key={d.date} className="border-t border-[var(--border)]">
                  <td className="py-1 pe-3 tabular">{d.date}</td>
                  <td className="py-1 pe-3 text-end tabular">{d.users}</td>
                  <td className="py-1 pe-3 text-end tabular">{d.listings}</td>
                  <td className="py-1 text-end tabular">{formatMoney(d.gmvCents, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
