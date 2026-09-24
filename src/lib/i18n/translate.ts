import type { Locale } from "./config";

/**
 * Translation.
 *
 * The English sentence is the key. `t("Sign in")` renders "Sign in" in English
 * and looks the sentence up in the Arabic dictionary otherwise. This keeps
 * every screen readable in source, needs no English dictionary at all, and
 * makes a missing translation degrade to English rather than to a key like
 * `auth.login.submit` that means nothing to a customer.
 *
 * `tests/i18n.test.ts` scans the source for every literal passed to `t()` and
 * fails when one has no Arabic entry, so "falls back to English" is a safety
 * net, not a way for strings to go untranslated.
 *
 * Client-safe and pure: the same functions run in server components, client
 * components, route handlers, email rendering and the worker.
 */

export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";
export type PluralForms = Partial<Record<PluralCategory, string>> & { other: string };
export type MessageValue = string | PluralForms;
export type Messages = Readonly<Record<string, MessageValue>>;
export type Vars = Record<string, string | number | null | undefined>;

export interface Translator {
  (key: string, vars?: Vars): string;
  /**
   * A count-dependent sentence. English supplies its two forms; Arabic, which
   * has six plural categories, keys its entry by the English `other` form and
   * gives whichever categories it needs. `{count}` is always available.
   */
  plural(count: number, forms: { one: string; other: string }, vars?: Vars): string;
  readonly locale: Locale;
}

const PLACEHOLDER = /\{(\w+)\}/g;

export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? match : String(value);
  });
}

const pluralRules = new Map<Locale, Intl.PluralRules>();
function pluralCategory(locale: Locale, count: number): PluralCategory {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules.select(count) as PluralCategory;
}

function pickForm(value: MessageValue, locale: Locale, count: number): string {
  if (typeof value === "string") return value;
  return value[pluralCategory(locale, count)] ?? value.other;
}

export function createTranslator(locale: Locale, messages: Messages): Translator {
  const lookup = (key: string): MessageValue | undefined =>
    locale === "en" ? undefined : messages[key];

  const t = ((key: string, vars?: Vars) => {
    const value = lookup(key);
    const template = value === undefined ? key : pickForm(value, locale, Number(vars?.count ?? 0));
    return interpolate(template, vars);
  }) as Translator;

  t.plural = (count, forms, vars) => {
    const all = { ...vars, count };
    const value = lookup(forms.other);
    if (value !== undefined) return interpolate(pickForm(value, locale, count), all);
    const english = pluralCategory("en", count) === "one" ? forms.one : forms.other;
    return interpolate(english, all);
  };

  Object.defineProperty(t, "locale", { value: locale });
  return t;
}

// ---------------------------------------------------------------------------
// Messages that arrive already written
// ---------------------------------------------------------------------------

interface CompiledTemplate {
  pattern: RegExp;
  names: string[];
  value: MessageValue;
}

const compiled = new WeakMap<Messages, CompiledTemplate[]>();

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function templatesOf(messages: Messages): CompiledTemplate[] {
  const cached = compiled.get(messages);
  if (cached) return cached;

  const list: CompiledTemplate[] = [];
  for (const [key, value] of Object.entries(messages)) {
    if (!key.includes("{")) continue;
    const names: string[] = [];
    let source = "";
    let last = 0;
    for (const match of key.matchAll(PLACEHOLDER)) {
      source += escapeRegExp(key.slice(last, match.index));
      source += "(.+?)";
      names.push(match[1]!);
      last = match.index! + match[0].length;
    }
    source += escapeRegExp(key.slice(last));
    list.push({ pattern: new RegExp(`^${source}$`, "s"), names, value });
  }
  // Longest literal text first, so "Use at least {n} characters." wins over a
  // looser template that would also match.
  list.sort((a, b) => b.pattern.source.length - a.pattern.source.length);
  compiled.set(messages, list);
  return list;
}

/**
 * Translates a sentence that was composed before the locale was known — an
 * error thrown deep in a service, a validation message built with the limit
 * already filled in. An exact match wins; otherwise the dictionary's
 * placeholder templates are tried, and the captured values are carried into
 * the Arabic sentence (translated themselves when the dictionary knows them).
 * Unknown sentences are returned unchanged.
 */
export function translateMessage(locale: Locale, messages: Messages, message: string): string {
  if (locale === "en" || !message) return message;

  const exact = messages[message];
  if (exact !== undefined) return pickForm(exact, locale, 0);

  for (const template of templatesOf(messages)) {
    const match = template.pattern.exec(message);
    if (!match) continue;
    const vars: Vars = {};
    template.names.forEach((name, i) => {
      // A captured phrase is often itself translatable: `notFound("That
      // clinic")` yields "That clinic could not be found.", and the Arabic
      // sentence should not keep "That clinic" in English.
      const captured = match[i + 1] ?? "";
      const known = messages[captured];
      vars[name] = known === undefined ? captured : pickForm(known, locale, 0);
    });
    const count = Number(vars.count ?? vars.n ?? 0);
    return interpolate(pickForm(template.value, locale, Number.isFinite(count) ? count : 0), vars);
  }
  return message;
}
