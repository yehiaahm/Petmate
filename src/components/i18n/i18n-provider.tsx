"use client";

import { createContext, useContext, useMemo } from "react";
import { localeDirection, type Locale } from "@/lib/i18n/config";
import { createTranslator, type Messages, type Translator } from "@/lib/i18n/translate";
import { createFormatter, type Formatter } from "@/lib/i18n/format";

/**
 * Client-side i18n.
 *
 * The root layout passes the locale and its dictionary down once. English
 * visitors receive an empty dictionary — the English sentence is the key — so
 * only an Arabic page pays for the Arabic strings.
 */
interface I18nValue {
  locale: Locale;
  dir: "rtl" | "ltr";
  t: Translator;
  fmt: Formatter;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Messages;
  children: React.ReactNode;
}) {
  const value = useMemo<I18nValue>(
    () => ({
      locale,
      dir: localeDirection(locale),
      t: createTranslator(locale, messages),
      fmt: createFormatter(locale, messages),
    }),
    [locale, messages],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

const ENGLISH: I18nValue = {
  locale: "en",
  dir: "ltr",
  t: createTranslator("en", {}),
  fmt: createFormatter("en", {}),
};

/**
 * Translation and formatting for a client component. Outside a provider (an
 * isolated component test) it falls back to English rather than throwing.
 */
export function useI18n(): I18nValue {
  return useContext(I18nContext) ?? ENGLISH;
}
