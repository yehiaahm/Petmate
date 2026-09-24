import type { Locale } from "./config";
import type { Messages } from "./translate";
import { ar } from "./ar";

const EMPTY: Messages = Object.freeze({});

/**
 * The dictionary for a locale. English has none: the English sentence is the
 * key, so there is nothing to look up.
 */
export function messagesFor(locale: Locale): Messages {
  return locale === "ar" ? ar : EMPTY;
}
