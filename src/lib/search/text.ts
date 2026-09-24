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
 */

export function normalizeSearchText(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
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
]);

export function parseSearchTerms(query: string, max = 8): string[] {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];

  const terms = normalized
    .split(" ")
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));

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
