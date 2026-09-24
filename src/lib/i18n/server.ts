import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_HEADER,
  isLocale,
  localeDirection,
  negotiateLocale,
  type Locale,
} from "./config";
import { createTranslator, translateMessage, type Translator } from "./translate";
import { createFormatter, type Formatter } from "./format";
import { messagesFor } from "./messages";

/**
 * The locale of the current request.
 *
 * Middleware resolves it (URL prefix, then cookie, then Accept-Language) and
 * passes the answer down in a header, so this is normally a single header
 * read. The fallbacks exist for code paths that run without middleware, such
 * as a route handler invoked directly in a test.
 *
 * Outside a request (the worker, a script) `headers()` throws; that is caught
 * and the default returned, and anything user-facing written there should use
 * the recipient's stored `User.locale` via `translatorFor` instead.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  try {
    const h = await headers();
    const fromMiddleware = h.get(LOCALE_HEADER);
    if (isLocale(fromMiddleware)) return fromMiddleware;

    const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
    if (isLocale(fromCookie)) return fromCookie;

    return negotiateLocale(h.get("accept-language")) ?? DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
});

export interface I18n {
  locale: Locale;
  dir: "rtl" | "ltr";
  t: Translator;
  fmt: Formatter;
}

/** Everything a server component needs to render in the visitor's language. */
export const getI18n = cache(async (): Promise<I18n> => {
  const locale = await getLocale();
  return i18nFor(locale);
});

/** The same bundle for an explicit locale — emails, SMS, the worker. */
export function i18nFor(locale: Locale): I18n {
  const messages = messagesFor(locale);
  return {
    locale,
    dir: localeDirection(locale),
    t: createTranslator(locale, messages),
    fmt: createFormatter(locale, messages),
  };
}

export function translatorFor(locale: string | null | undefined): Translator {
  const resolved = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return createTranslator(resolved, messagesFor(resolved));
}

/** Translates an already-composed sentence (an error, a validation message). */
export function translateFor(locale: Locale, message: string): string {
  return translateMessage(locale, messagesFor(locale), message);
}
