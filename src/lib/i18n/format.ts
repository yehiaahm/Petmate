import { intlLocale, type Locale } from "./config";
import { createTranslator, type Messages, type Translator } from "./translate";
import {
  ageInMonths,
  compactNumber,
  formatDistance as formatDistanceEn,
  relativeTime as relativeTimeEn,
} from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { clientEnv } from "@/lib/env";

/**
 * Locale-aware formatting for dates, numbers, money, ages and distances.
 *
 * English wording is what the pre-i18n helpers in `lib/utils` and
 * `lib/money` produced, so switching a screen to the formatter changes nothing
 * for an English reader except one fix: every date and time is rendered in the
 * platform time zone (`NEXT_PUBLIC_APP_TIMEZONE`) rather than whichever zone
 * the server or browser happens to run in. Arabic goes through `Intl` with
 * Latin digits (see `intlLocale`) plus the Arabic dictionary for the few
 * phrases `Intl` has no formatter for, such as a pet's age.
 */
export interface Formatter {
  readonly locale: Locale;
  date(d: Date | string | null | undefined, style?: "short" | "long"): string;
  dateTime(d: Date | string | null | undefined): string;
  time(d: Date | string): string;
  relative(d: Date | string | null | undefined): string;
  number(n: number): string;
  compact(n: number): string;
  money(cents: number, currency?: string, opts?: { compact?: boolean; showFree?: boolean }): string;
  age(birthDate: Date | null | undefined): string;
  distance(km: number): string;
}

const toDate = (d: Date | string) => (typeof d === "string" ? new Date(d) : d);
const valid = (d: Date) => !Number.isNaN(d.getTime());

export function createFormatter(
  locale: Locale,
  messages: Messages,
  timeZone: string = clientEnv.NEXT_PUBLIC_APP_TIMEZONE,
): Formatter {
  const t: Translator = createTranslator(locale, messages);
  const tag = intlLocale(locale);

  const dateFormat = {
    short: new Intl.DateTimeFormat(tag, { timeZone, year: "numeric", month: "short", day: "numeric" }),
    long: new Intl.DateTimeFormat(tag, { timeZone, year: "numeric", month: "long", day: "numeric" }),
  };
  const dateTimeFormat = new Intl.DateTimeFormat(tag, {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const timeFormat = new Intl.DateTimeFormat(tag, { timeZone, hour: "numeric", minute: "2-digit" });

  const date = (d: Date | string | null | undefined, style: "short" | "long" = "short") => {
    if (!d) return "—";
    const value = toDate(d);
    return valid(value) ? dateFormat[style].format(value) : "—";
  };
  const dateTime = (d: Date | string | null | undefined) => {
    if (!d) return "—";
    const value = toDate(d);
    return valid(value) ? dateTimeFormat.format(value) : "—";
  };
  const time = (d: Date | string) => {
    const value = toDate(d);
    return valid(value) ? timeFormat.format(value) : "—";
  };

  if (locale === "en") {
    return {
      locale,
      date,
      dateTime,
      time,
      relative: relativeTimeEn,
      number: (n) => n.toLocaleString("en-US"),
      compact: compactNumber,
      money: (cents, currency, opts) => formatMoney(cents, currency, { ...opts, locale }),
      age: (birthDate) => englishAge(birthDate),
      distance: formatDistanceEn,
    };
  }

  const relativeFormat = new Intl.RelativeTimeFormat(tag, { numeric: "auto", style: "short" });
  const numberFormat = new Intl.NumberFormat(tag);
  const compactFormat = new Intl.NumberFormat(tag, { notation: "compact", maximumFractionDigits: 1 });

  return {
    locale,
    date,
    dateTime,
    time,
    relative(d) {
      if (!d) return "";
      const date = toDate(d);
      if (!valid(date)) return "";
      const seconds = (date.getTime() - Date.now()) / 1000;
      const abs = Math.abs(seconds);
      if (abs < 60) return t("just now");
      const steps: [number, Intl.RelativeTimeFormatUnit][] = [
        [3600, "minute"],
        [86_400, "hour"],
        [604_800, "day"],
        [2_592_000, "week"],
        [31_536_000, "month"],
      ];
      const sizes: Record<string, number> = { minute: 60, hour: 3600, day: 86_400, week: 604_800, month: 2_592_000 };
      for (const [limit, unit] of steps) {
        if (abs < limit) return relativeFormat.format(Math.trunc(seconds / sizes[unit]!), unit);
      }
      return relativeFormat.format(Math.trunc(seconds / 31_536_000), "year");
    },
    number: (n) => numberFormat.format(n),
    compact: (n) => compactFormat.format(n),
    money: (cents, currency, opts) => formatMoney(cents, currency, { ...opts, locale }),
    age(birthDate) {
      const months = ageInMonths(birthDate);
      if (months === null) return t("Age unknown");
      if (months < 1) return t("Under 1 month");
      if (months < 12) return t.plural(months, { one: "{count} month", other: "{count} months" });
      const years = Math.floor(months / 12);
      const rem = months % 12;
      const yearsText = t.plural(years, { one: "{count} year", other: "{count} years" });
      if (rem === 0) return yearsText;
      return t("{years} and {months}", {
        years: yearsText,
        months: t.plural(rem, { one: "{count} month", other: "{count} months" }),
      });
    },
    distance(km) {
      if (km < 1) return t("Less than 1 km away");
      const value = km < 10 ? km.toFixed(1) : String(Math.round(km));
      return t("{distance} km away", { distance: value });
    },
  };
}

/** The original English age wording, kept byte-for-byte. */
function englishAge(birthDate: Date | null | undefined): string {
  const months = ageInMonths(birthDate);
  if (months === null) return "Age unknown";
  if (months < 1) return "Under 1 month";
  if (months < 12) return `${months} month${months === 1 ? "" : "s"}`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (rem === 0) return `${years} year${years === 1 ? "" : "s"}`;
  return `${years}y ${rem}m`;
}
