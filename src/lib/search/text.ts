import type { Species } from "@/lib/constants";

/**
 * Search text normalisation.
 *
 * SQLite's LIKE is case-insensitive for ASCII; Postgres's is not, and Prisma's
 * `mode: "insensitive"` only exists on Postgres. Rather than branch on the
 * engine, every searchable row stores a pre-normalised haystack and every query
 * is normalised the same way. One code path, identical results on both.
 *
 * Normalisation: lowercase, strip diacritics, collapse punctuation to spaces.
 * So "Münchener Schäferhund" is found by "munchener schaferhund".
 *
 * Arabic is kept, and normalised the way Arabic search engines do it, because
 * people type the same word several ways: vowel marks (tashkeel) and the
 * elongation stroke (tatweel) are dropped; أ إ آ ٱ become ا; ؤ becomes و and
 * ئ becomes ي (NFKD splits the hamza off, and the hamza is a mark); ى
 * becomes ي and ة becomes ه; and Arabic-Indic digits become 0-9, so "٥٠٠٠"
 * and "5000" are the same price. So "قِطّة" is found by "قطه".
 */

const ARABIC_INDIC_ZERO = 0x0660;
const PERSIAN_ZERO = 0x06f0;

export function normalizeSearchText(input: string): string {
  return input
    .normalize("NFKD")
    // Latin combining marks (é -> e) and Arabic marks: tashkeel, the hamza and
    // madda NFKD split off alef/waw/yeh, superscript alef, and tatweel.
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - ARABIC_INDIC_ZERO))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - PERSIAN_ZERO))
    .replace(/\u0671/g, "\u0627") // alef wasla -> alef
    .replace(/\u0649/g, "\u064a") // alef maksura -> yeh
    .replace(/\u0629/g, "\u0647") // teh marbuta -> heh
    .toLowerCase()
    .replace(/[^a-z0-9\u0621-\u064a\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Builds the stored haystack from every field worth matching on. */
export function buildSearchText(...parts: (string | null | undefined)[]): string {
  return normalizeSearchText(parts.filter(Boolean).join(" ")).slice(0, 2000);
}

/**
 * Splits a user query into terms, dropping noise words that would match
 * everything. Terms are ANDed: "golden puppy cairo" must match all three.
 */
const STOP_WORDS = new Set([
  "a", "an", "the", "for", "and", "or", "of", "in", "on", "at", "to", "with",
  "my", "is", "are", "be", "i", "we", "you", "it", "this", "that", "pet", "pets",
  // Arabic, in normalised form (so "إلى" appears as "الي").
  "في", "من", "علي", "الي", "عن", "مع", "او", "ان", "هذا", "هذه", "ذلك", "انا", "عايز", "اريد",
]);

/**
 * The Arabic definite article is written joined to the word, so "الكلب" and
 * "كلب" are the same search. Matching is by substring, so dropping "ال" from
 * the query term finds both; the stored haystack is left as written.
 */
function stripArabicArticle(term: string): string {
  return term.length >= 4 && term.startsWith("\u0627\u0644") ? term.slice(2) : term;
}

export function parseSearchTerms(query: string, max = 8): string[] {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];

  const terms = normalized
    .split(" ")
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t))
    .map(stripArabicArticle);

  // If the query was entirely stop words, fall back to the raw tokens rather
  // than returning nothing and silently showing everything.
  const chosen = terms.length ? terms : normalized.split(" ").filter(Boolean);
  return [...new Set(chosen)].slice(0, max);
}

/**
 * Prisma `AND` clauses for a normalised text column. Each term must appear.
 *
 * `contains` compiles to LIKE '%term%', which cannot use a b-tree index. That
 * is acceptable at this scale and every caller pairs it with an indexed
 * predicate (status, species, location) that does the real narrowing. When the
 * listing table outgrows it the swap is Postgres tsvector or an external index,
 * and this is the only function that changes. See docs/SEARCH.md.
 */
export function searchTextClauses(query: string, field = "searchText") {
  const terms = parseSearchTerms(query);
  if (!terms.length) return [];
  return terms.map((term) => ({ [field]: { contains: term } }));
}

/**
 * Relevance score for in-memory re-ranking of a page of results.
 * Deliberately simple and explainable: exact phrase beats prefix beats
 * substring, and a title match beats a description match.
 */
export function relevanceScore(
  query: string,
  fields: { title: string; secondary?: string },
): number {
  const q = normalizeSearchText(query);
  if (!q) return 0;

  const title = normalizeSearchText(fields.title);
  const secondary = normalizeSearchText(fields.secondary ?? "");
  const terms = parseSearchTerms(query);

  let score = 0;
  if (title === q) score += 100;
  else if (title.startsWith(q)) score += 60;
  else if (title.includes(q)) score += 40;

  for (const term of terms) {
    if (title.includes(term)) score += 10;
    if (secondary.includes(term)) score += 3;
  }
  return score;
}

/** Highlights matched terms for display. Returns segments, never raw HTML. */
export function highlightSegments(
  text: string,
  query: string,
): { text: string; match: boolean }[] {
  const terms = parseSearchTerms(query);
  if (!terms.length) return [{ text, match: false }];

  const normalized = normalizeSearchText(text);
  const ranges: [number, number][] = [];

  for (const term of terms) {
    let from = 0;
    for (;;) {
      const at = normalized.indexOf(term, from);
      if (at === -1) break;
      ranges.push([at, at + term.length]);
      from = at + term.length;
    }
  }
  if (!ranges.length) return [{ text, match: false }];

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }

  // Normalisation preserves length for the common case (diacritic folding is
  // 1:1 after NFKD strip), so offsets map back onto the original string.
  const out: { text: string; match: boolean }[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) out.push({ text: text.slice(cursor, start), match: false });
    out.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), match: false });
  return out;
}

// ---------------------------------------------------------------------------
// Cities
// ---------------------------------------------------------------------------

/**
 * Egyptian cities, English name first, with the ways they are written in
 * Arabic. A row stores the city as its owner typed it, so "Cairo", "cairo" and
 * "القاهرة" are all the same place to a buyer.
 */
export const EGYPT_CITIES: readonly (readonly [string, ...string[]])[] = [
  ["Cairo", "القاهرة", "القاهره", "مصر"],
  ["Giza", "الجيزة", "الجيزه"],
  ["Alexandria", "الإسكندرية", "الاسكندرية", "اسكندرية", "إسكندرية"],
  ["New Cairo", "القاهرة الجديدة", "التجمع", "التجمع الخامس"],
  ["6th of October", "6 أكتوبر", "السادس من أكتوبر", "أكتوبر"],
  ["Sheikh Zayed", "الشيخ زايد", "زايد"],
  ["Maadi", "المعادي"],
  ["Zamalek", "الزمالك"],
  ["Heliopolis", "مصر الجديدة"],
  ["Nasr City", "مدينة نصر"],
  ["Mansoura", "المنصورة"],
  ["Tanta", "طنطا"],
  ["Zagazig", "الزقازيق"],
  ["Ismailia", "الإسماعيلية", "الاسماعيلية"],
  ["Port Said", "بورسعيد", "بور سعيد"],
  ["Suez", "السويس"],
  ["Damietta", "دمياط"],
  ["Faiyum", "الفيوم"],
  ["Minya", "المنيا"],
  ["Asyut", "أسيوط", "اسيوط"],
  ["Sohag", "سوهاج"],
  ["Luxor", "الأقصر", "الاقصر"],
  ["Aswan", "أسوان", "اسوان"],
  ["Hurghada", "الغردقة"],
  ["Sharm El Sheikh", "شرم الشيخ"],
];

/**
 * Every spelling of the city a visitor filtered on, for an indexed
 * `city IN (...)` match. Equality is case-sensitive on both SQLite and
 * Postgres, so without this a search for "cairo" found none of the listings
 * stored as "Cairo", and none written in Arabic at all.
 */
export function cityVariants(city: string): string[] {
  const trimmed = city.trim();
  if (!trimmed) return [];
  const key = normalizeSearchText(trimmed);
  const titled = trimmed.replace(/\b\w/g, (c) => c.toUpperCase());
  const out = new Set([trimmed, trimmed.toLowerCase(), titled]);
  for (const names of EGYPT_CITIES) {
    if (names.some((n) => normalizeSearchText(n) === key)) names.forEach((n) => out.add(n));
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Species
// ---------------------------------------------------------------------------

/**
 * The words a person might search for a species, in both languages. Stored in
 * a listing's haystack in place of the bare code, so "كلب" finds a listing
 * titled "Golden Retriever puppy" and "dog" finds one titled "جرو جولدن".
 */
const SPECIES_WORDS: Record<Species, string> = {
  DOG: "dog dogs puppy كلب كلاب جرو جراء",
  CAT: "cat cats kitten قطة قطط قط بسة",
  BIRD: "bird birds parrot طائر طيور عصفور ببغاء",
  RABBIT: "rabbit bunny أرنب أرانب",
  REPTILE: "reptile lizard snake tortoise زواحف سحلية ثعبان سلحفاة",
  SMALL_MAMMAL: "hamster guinea pig ferret هامستر خنزير غينيا",
  HORSE: "horse pony حصان خيل خيول فرس",
  OTHER: "other",
};

export function speciesSearchWords(species: string): string {
  return SPECIES_WORDS[species as Species] ?? species;
}
