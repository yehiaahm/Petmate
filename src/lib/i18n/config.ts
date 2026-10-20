/**
 * Locale configuration.
 *
 * Client-safe: no Node or Next server imports, so middleware (Edge), server
 * components and client components all read the same definitions.
 *
 * PetMate ships in Arabic and English. Arabic is the default because the
 * launch market is Egypt; a visitor whose browser asks for English gets
 * English, and anyone can switch from the header.
 */

export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "ar";

/** Remembers an explicit choice. Readable by script so the switcher can set it. */
export const LOCALE_COOKIE = "pm_locale";

/**
 * Set by middleware on every request after it has resolved the locale, so
 * server code reads one header instead of re-deriving it from the URL, the
 * cookie and Accept-Language in several places.
 */
export const LOCALE_HEADER = "x-pm-locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function localeDirection(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

/**
 * The BCP 47 tag handed to `Intl`. Arabic uses Western (Latin) digits: prices,
 * phone numbers and order references in Egyptian commerce are overwhelmingly
 * written that way, and mixing digit systems between a price and the order
 * number beside it is harder to read than either one alone.
 */
export function intlLocale(locale: Locale): string {
  return locale === "ar" ? "ar-EG-u-nu-latn" : "en-US";
}

/** Human names, each written in its own language, for the switcher. */
export const LOCALE_NAME: Record<Locale, string> = {
  ar: "العربية",
  en: "English",
};

/**
 * Picks the best supported locale from an Accept-Language header, honouring
 * q-values. Returns null when the visitor asked for nothing we have, so the
 * caller can apply the default.
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale | null {
  if (!acceptLanguage) return null;

  const ranked = acceptLanguage
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const quality = q ? Number(q.slice(2)) : 1;
      return { base: tag.toLowerCase().split("-")[0] ?? "", quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((entry) => entry.base && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);

  for (const entry of ranked) {
    if (isLocale(entry.base)) return entry.base;
  }
  return null;
}

/**
 * A locale-prefixed path, used for hreflang alternates, the sitemap and the
 * switcher. `/pets?intent=ADOPTION` becomes `/ar/pets?intent=ADOPTION`.
 */
export function localizedPath(locale: Locale, path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return clean === "/" ? `/${locale}` : `/${locale}${clean}`;
}

/** Strips a leading `/ar` or `/en` segment. Returns the locale it found. */
export function splitLocalePath(pathname: string): { locale: Locale | null; path: string } {
  const match = /^\/(ar|en)(?=\/|$)/.exec(pathname);
  if (!match) return { locale: null, path: pathname };
  const rest = pathname.slice(match[0].length);
  return { locale: match[1] as Locale, path: rest || "/" };
}
