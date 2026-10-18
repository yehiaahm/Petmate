import { normalizeSearchText } from "./text";
import type { Species } from "@/lib/constants";

/**
 * Turns "vaccinated labrador under 1200" or "كلب للتبني" into structured filters
 * plus whatever text is left over for the keyword match.
 *
 * This is deliberately a small, readable rule set rather than a model: it is
 * deterministic, free, works offline, and a person can read this file and know
 * why a search behaved the way it did. Words it does not understand are left in
 * the residual and matched as plain keywords, exactly as before.
 */

export interface QueryInterpretation {
  /** The query with every recognised phrase removed. */
  residual: string;
  species?: Species;
  intent?: "SALE" | "ADOPTION" | "BREEDING";
  minPriceCents?: number;
  maxPriceCents?: number;
  vaccinatedOnly?: boolean;
  /** "near me" was asked for; the caller decides whether it has a location. */
  nearMe?: boolean;
  /** Human-readable list of what was understood, for the results header. */
  understood: string[];
}

const SPECIES_WORDS: Record<string, Species> = {
  dog: "DOG", dogs: "DOG", puppy: "DOG", puppies: "DOG", pup: "DOG", pups: "DOG",
  cat: "CAT", cats: "CAT", kitten: "CAT", kittens: "CAT", kitty: "CAT",
  bird: "BIRD", birds: "BIRD", parrot: "BIRD", parrots: "BIRD", budgie: "BIRD", canary: "BIRD",
  rabbit: "RABBIT", rabbits: "RABBIT", bunny: "RABBIT", bunnies: "RABBIT",
  reptile: "REPTILE", reptiles: "REPTILE", lizard: "REPTILE", snake: "REPTILE", turtle: "REPTILE",
  horse: "HORSE", horses: "HORSE", pony: "HORSE",
  hamster: "SMALL_MAMMAL", hamsters: "SMALL_MAMMAL", guinea: "SMALL_MAMMAL", ferret: "SMALL_MAMMAL",
  // Arabic (already normalised: alef variants folded, ta marbuta -> ha, ya folded).
  كلب: "DOG", كلاب: "DOG", جرو: "DOG", جراء: "DOG", كلبه: "DOG",
  قطه: "CAT", قط: "CAT", قطط: "CAT", هر: "CAT", قطوه: "CAT",
  طائر: "BIRD", طيور: "BIRD", ببغاء: "BIRD", عصفور: "BIRD", عصافير: "BIRD",
  ارنب: "RABBIT", ارانب: "RABBIT",
  زواحف: "REPTILE", سلحفاه: "REPTILE", ثعبان: "REPTILE",
  حصان: "HORSE", خيل: "HORSE", احصنه: "HORSE",
};

const SPECIES_LABEL: Record<Species, string> = {
  DOG: "dogs",
  CAT: "cats",
  BIRD: "birds",
  RABBIT: "rabbits",
  REPTILE: "reptiles",
  SMALL_MAMMAL: "small mammals",
  HORSE: "horses",
  OTHER: "other pets",
};

const INTENT_WORDS: Record<string, "SALE" | "ADOPTION" | "BREEDING"> = {
  adopt: "ADOPTION", adoption: "ADOPTION", adopting: "ADOPTION", rescue: "ADOPTION", rehome: "ADOPTION",
  rehoming: "ADOPTION", تبني: "ADOPTION", للتبني: "ADOPTION", تبنى: "ADOPTION",
  stud: "BREEDING", breeding: "BREEDING", mate: "BREEDING", mating: "BREEDING", تزاوج: "BREEDING", للتزاوج: "BREEDING",
  buy: "SALE", sale: "SALE", للبيع: "SALE", شراء: "SALE",
};

/** Words that describe a wish but are not stored fields: they rank, they never exclude. */
const SOFT_WORDS = new Set([
  "a", "an", "the", "for", "and", "or", "of", "in", "on", "to", "with", "my", "is", "are", "i", "we",
  "you", "it", "this", "that", "pet", "pets", "please", "في", "من", "الى", "على",
  "near", "nearby", "me", "close", "around", "small", "little", "tiny", "big", "large", "medium",
  "cute", "good", "best", "cheap", "affordable", "calm", "friendly", "quiet", "playful", "gentle",
  "young", "healthy", "kid", "kids", "family", "looking", "want", "need", "find", "show", "any",
  "some", "under", "below", "over", "above", "less", "more", "than", "max", "min", "up", "from",
  "قريب", "مني", "صغير", "كبير", "هادي", "لطيف", "جميل", "رخيص",
]);

const NEAR_ME = new Set(["near", "nearby", "قريب", "مني"]);
const VACCINATED = new Set(["vaccinated", "vaccinations", "vaccination", "مطعم", "ملقح", "مطعمه"]);

export function interpretQuery(query: string): QueryInterpretation {
  const normalized = normalizeSearchText(query);
  const understood: string[] = [];
  const result: QueryInterpretation = { residual: "", understood };
  if (!normalized) return result;

  let tokens = normalized.split(" ").filter(Boolean);

  // Price phrases first, because their numbers must not become keywords.
  const text = tokens.join(" ");
  const maxMatch = text.match(/(?:^|\s)(?:under|below|less than|max|up to|cheaper than|اقل من)\s+(\d{2,7})(?:\s|$)/u);
  const minMatch = text.match(/(?:^|\s)(?:over|above|more than|min|from|at least|اكثر من)\s+(\d{2,7})(?:\s|$)/u);
  if (maxMatch) {
    result.maxPriceCents = Number(maxMatch[1]) * 100;
    understood.push(`up to ${Number(maxMatch[1]).toLocaleString("en-US")}`);
  }
  if (minMatch) {
    result.minPriceCents = Number(minMatch[1]) * 100;
    understood.push(`from ${Number(minMatch[1]).toLocaleString("en-US")}`);
  }
  if (maxMatch || minMatch) {
    const used = new Set<string>();
    for (const m of [maxMatch, minMatch]) if (m?.[1]) used.add(m[1]);
    tokens = tokens.filter((t) => !used.has(t));
  }

  const residual: string[] = [];
  for (const token of tokens) {
    if (SPECIES_WORDS[token] && !result.species) {
      result.species = SPECIES_WORDS[token];
      understood.push(SPECIES_LABEL[result.species]);
      continue;
    }
    if (INTENT_WORDS[token] && !result.intent) {
      result.intent = INTENT_WORDS[token];
      understood.push(
        result.intent === "ADOPTION" ? "for adoption" : result.intent === "BREEDING" ? "breeding" : "for sale",
      );
      continue;
    }
    if (VACCINATED.has(token)) {
      result.vaccinatedOnly = true;
      understood.push("vaccinated");
      continue;
    }
    if (NEAR_ME.has(token)) result.nearMe = true;
    if (SOFT_WORDS.has(token)) continue;
    residual.push(token);
  }

  result.residual = residual.join(" ");
  return result;
}
