import { clientEnv } from "@/lib/env";

/**
 * Calendar dates in the platform's time zone.
 *
 * A date a person picks ("the campaign ends on the 30th") means that day where
 * they live, not in UTC: in Cairo, UTC midnight is 2 or 3 in the morning.
 */

/** Minutes the zone is ahead of UTC at a given instant. */
function offsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** The instant a `YYYY-MM-DD` day begins in the zone. */
export function startOfZonedDay(date: string, timeZone = clientEnv.NEXT_PUBLIC_APP_TIMEZONE): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  // Two passes settle a day on which the offset itself changes (DST).
  let instant = guess - offsetMinutes(new Date(guess), timeZone) * 60_000;
  instant = guess - offsetMinutes(new Date(instant), timeZone) * 60_000;
  return new Date(instant);
}

/** The instant the day after `date` begins: an exclusive end for "through this day". */
export function endOfZonedDay(date: string, timeZone = clientEnv.NEXT_PUBLIC_APP_TIMEZONE): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return startOfZonedDay(next, timeZone);
}

/** Today's `YYYY-MM-DD` in the zone. */
export function zonedToday(timeZone = clientEnv.NEXT_PUBLIC_APP_TIMEZONE, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
