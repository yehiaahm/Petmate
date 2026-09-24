import "server-only";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { db } from "@/lib/db";
import { formatAge, splitTags } from "@/lib/utils";
import { normalizeSearchText } from "@/lib/search/text";
import { SPECIES, LISTING_INTENT, type Species } from "@/lib/constants";
import {
  aiAvailable,
  aiResult,
  callClaudeStructured,
  ruleResult,
  streamClaude,
  type AiResult,
} from "./client";

/**
 * AI features.
 *
 * Each one exists because it removes real work from a real person:
 *
 *   * listing coach — sellers write bad descriptions, bad descriptions do not
 *     sell, and a checklist is more useful than a blank box
 *   * search understanding — "calm small dog near cairo under 300" is how
 *     people actually think; filters are how databases actually work
 *   * care assistant — grounded in the pet's own record, so the answer knows
 *     the animal's age, species and vaccination state
 *
 * None of them is decoration, and each has a deterministic path that is good
 * enough to ship on its own.
 */

// ---------------------------------------------------------------------------
// Listing coach
// ---------------------------------------------------------------------------

export interface ListingFeedback {
  score: number;
  strengths: string[];
  improvements: { issue: string; suggestion: string }[];
  suggestedTitle?: string;
}

const listingFeedbackSchema = z.object({
  score: z.number().min(0).max(100),
  strengths: z.array(z.string()).max(4),
  improvements: z
    .array(z.object({ issue: z.string(), suggestion: z.string() }))
    .max(5),
  suggestedTitle: z.string().max(120).optional(),
});

export async function reviewListingDraft(input: {
  title: string;
  description: string;
  species: string;
  breedName: string | null;
  intent: string;
  priceCents: number;
  photoCount: number;
  hasHealthRecords: boolean;
}): Promise<AiResult<ListingFeedback>> {
  const deterministic = deterministicListingFeedback(input);

  if (!aiAvailable()) {
    return ruleResult(
      deterministic,
      "Checked against PetMate's listing guidelines. AI suggestions are not configured.",
    );
  }

  const parsed = await callClaudeStructured<ListingFeedback>({
    system: LISTING_COACH_SYSTEM,
    cacheSystem: true,
    effort: "low",
    maxTokens: 1200,
    outputFormat: zodOutputFormat(listingFeedbackSchema),
    messages: [
      {
        role: "user",
        content: [
          `Intent: ${input.intent}`,
          `Species: ${input.species}`,
          `Breed: ${input.breedName ?? "not specified"}`,
          `Price: ${input.priceCents > 0 ? `${(input.priceCents / 100).toFixed(2)}` : "n/a"}`,
          `Photos: ${input.photoCount}`,
          `Health records on file: ${input.hasHealthRecords ? "yes" : "no"}`,
          "",
          `Title: ${input.title}`,
          "",
          "Description:",
          input.description,
        ].join("\n"),
      },
    ],
  });

  if (!parsed) {
    return ruleResult(
      deterministic,
      "Checked against PetMate's listing guidelines. The AI assistant was unavailable.",
    );
  }

  // Structural checks are facts, not opinions — keep them whatever the model says.
  const merged: ListingFeedback = {
    score: Math.round((parsed.score + deterministic.score) / 2),
    strengths: parsed.strengths,
    improvements: [
      ...deterministic.improvements.filter((d) => d.issue.startsWith("[required]")),
      ...parsed.improvements,
    ].slice(0, 6),
    suggestedTitle: parsed.suggestedTitle,
  };

  return aiResult(merged);
}

const LISTING_COACH_SYSTEM = `You help people write honest, useful listings for pets on PetMate, a marketplace where animals are bought, adopted and matched for breeding.

Judge a draft on whether a careful buyer would have enough information to decide, and on whether the tone reflects responsible ownership.

What makes a listing good:
- concrete facts: temperament, daily routine, training, how it behaves with children and other animals
- honesty about health, including anything ongoing
- why the animal is being rehomed
- what the new owner will need to provide

What makes a listing bad, and must be called out:
- vague superlatives with no specifics
- pressure tactics, urgency, or "first to pay" framing
- contact details or payment instructions in the text (this is how scams start, and it breaks platform protection)
- anything implying an animal is a novelty item rather than an animal

Never invent facts about the animal. If something important is missing, say it is missing rather than guessing.
Score 0-100 on completeness and trustworthiness. Be direct and specific; a generic compliment helps nobody.`;

/** The rule-based reviewer. Runs always, and alone when AI is off. */
export function deterministicListingFeedback(input: {
  title: string;
  description: string;
  photoCount: number;
  hasHealthRecords: boolean;
  priceCents: number;
  intent: string;
}): ListingFeedback {
  const strengths: string[] = [];
  const improvements: { issue: string; suggestion: string }[] = [];
  let score = 50;

  const words = input.description.trim().split(/\s+/).length;

  if (input.photoCount >= 4) {
    strengths.push(`${input.photoCount} photos — buyers scroll past listings with one`);
    score += 12;
  } else if (input.photoCount <= 1) {
    improvements.push({
      issue: "[required] Only one photo",
      suggestion: "Add at least three: face, full body, and one in your home.",
    });
    score -= 12;
  }

  if (words >= 120) {
    strengths.push("Detailed description");
    score += 12;
  } else if (words < 50) {
    improvements.push({
      issue: "[required] Description is very short",
      suggestion: "Aim for 100+ words covering temperament, routine, and why you are rehoming.",
    });
    score -= 15;
  }

  if (input.hasHealthRecords) {
    strengths.push("Health records attached — this is the single biggest trust signal");
    score += 15;
  } else {
    improvements.push({
      issue: "No health records",
      suggestion: "Add vaccinations and check-ups. Listings with records get far more genuine enquiries.",
    });
    score -= 10;
  }

  const text = `${input.title} ${input.description}`;
  if (/\b(?:\+?\d[\d\s().-]{7,}\d)\b|@[\w-]+\.\w+|whats\s?app|telegram/i.test(text)) {
    improvements.push({
      issue: "[required] Contact details in the listing",
      suggestion:
        "Remove them. Messaging through PetMate is what keeps escrow, dispute cover and your own privacy working.",
    });
    score -= 25;
  }

  const lower = input.description.toLowerCase();
  if (/urgent|asap|must go|first come|quick sale|today only/.test(lower)) {
    improvements.push({
      issue: "Urgency language",
      suggestion: "Pressure wording reads as a scam to experienced buyers. Describe the animal instead.",
    });
    score -= 8;
  }

  if (!/\b(vaccin|microchip|neuter|spay|vet)\b/i.test(lower)) {
    improvements.push({
      issue: "No mention of veterinary history",
      suggestion: "Say what has been done: vaccinations, microchip, neutering, last check-up.",
    });
    score -= 5;
  }

  if (/\b(good with|children|kids|other (dogs|cats|pets)|train)\b/i.test(lower)) {
    strengths.push("Describes behaviour with people and other animals");
    score += 8;
  } else {
    improvements.push({
      issue: "No behaviour details",
      suggestion: "Say how the animal is with children, strangers and other pets. This is the first thing people ask.",
    });
  }

  if (input.intent === "SALE" && input.priceCents === 0) {
    improvements.push({
      issue: "[required] No price",
      suggestion: "Set a price. Listings without one are usually skipped.",
    });
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    strengths,
    improvements: improvements.slice(0, 6),
  };
}

// ---------------------------------------------------------------------------
// Natural-language search
// ---------------------------------------------------------------------------

export interface ParsedSearch {
  query?: string;
  species?: Species[];
  intent?: "SALE" | "ADOPTION" | "BREEDING";
  maxPriceCents?: number;
  minPriceCents?: number;
  maxAgeMonths?: number;
  minAgeMonths?: number;
  city?: string;
  sex?: "MALE" | "FEMALE";
  vaccinatedOnly?: boolean;
  verifiedOnly?: boolean;
  interpretation: string;
}

const parsedSearchSchema = z.object({
  query: z.string().max(120).optional(),
  species: z.array(z.enum(SPECIES)).max(3).optional(),
  intent: z.enum(LISTING_INTENT).optional(),
  maxPriceCents: z.number().int().min(0).optional(),
  minPriceCents: z.number().int().min(0).optional(),
  maxAgeMonths: z.number().int().min(0).max(360).optional(),
  minAgeMonths: z.number().int().min(0).max(360).optional(),
  city: z.string().max(80).optional(),
  sex: z.enum(["MALE", "FEMALE"]).optional(),
  vaccinatedOnly: z.boolean().optional(),
  verifiedOnly: z.boolean().optional(),
  interpretation: z.string().max(200),
});

export async function parseNaturalSearch(raw: string): Promise<AiResult<ParsedSearch>> {
  const deterministic = deterministicSearchParse(raw);

  // Short or obviously literal queries do not need a model round trip.
  if (!aiAvailable() || raw.trim().split(/\s+/).length <= 2) {
    return ruleResult(deterministic, "Interpreted with PetMate's keyword rules.");
  }

  const parsed = await callClaudeStructured<ParsedSearch>({
    system: SEARCH_SYSTEM,
    cacheSystem: true,
    effort: "low",
    maxTokens: 500,
    outputFormat: zodOutputFormat(parsedSearchSchema),
    messages: [{ role: "user", content: raw.slice(0, 300) }],
  });

  if (!parsed) return ruleResult(deterministic, "Interpreted with PetMate's keyword rules.");

  // Never let a parse produce a nonsensical range.
  if (
    parsed.minPriceCents != null &&
    parsed.maxPriceCents != null &&
    parsed.minPriceCents > parsed.maxPriceCents
  ) {
    delete parsed.minPriceCents;
  }

  return aiResult(parsed);
}

const SEARCH_SYSTEM = `Convert a person's plain-language pet search into structured filters for PetMate.

Rules:
- Money is in cents: "under $300" is maxPriceCents 30000.
- Ages are in months: "puppy" is maxAgeMonths 12, "kitten" is maxAgeMonths 12, "young" is maxAgeMonths 36, "adult" is minAgeMonths 24, "senior" is minAgeMonths 84.
- "adopt", "rescue", "rehome" mean intent ADOPTION. "buy", "for sale", "price" mean SALE. "stud", "mate", "breeding" mean BREEDING.
- Put descriptive words that are not filters (temperament, colour, coat) into the query field.
- Only set a field the person actually expressed. Do not guess a city, a species or a budget that was not stated.
- The interpretation field is one short sentence, in the person's own terms, describing what you filtered on.`;

/** Keyword parser. Handles the common shapes without a model. */
export function deterministicSearchParse(raw: string): ParsedSearch {
  const text = normalizeSearchText(raw);
  const out: ParsedSearch = { interpretation: "" };
  const applied: string[] = [];

  const speciesWords: Record<string, Species> = {
    dog: "DOG", dogs: "DOG", puppy: "DOG", puppies: "DOG",
    cat: "CAT", cats: "CAT", kitten: "CAT", kittens: "CAT",
    bird: "BIRD", birds: "BIRD", parrot: "BIRD",
    rabbit: "RABBIT", rabbits: "RABBIT", bunny: "RABBIT",
    reptile: "REPTILE", lizard: "REPTILE", snake: "REPTILE",
    hamster: "SMALL_MAMMAL", guinea: "SMALL_MAMMAL", ferret: "SMALL_MAMMAL",
    horse: "HORSE", horses: "HORSE", pony: "HORSE",
  };

  const found = new Set<Species>();
  for (const [word, species] of Object.entries(speciesWords)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) found.add(species);
  }
  if (found.size) {
    out.species = [...found];
    applied.push([...found].map((s) => s.toLowerCase().replace("_", " ")).join(" or "));
  }

  if (/\b(adopt|adoption|rescue|rehome|rehoming)\b/.test(text)) {
    out.intent = "ADOPTION";
    applied.push("for adoption");
  } else if (/\b(stud|mate|mating|breed|breeding)\b/.test(text)) {
    out.intent = "BREEDING";
    applied.push("for breeding");
  } else if (/\b(buy|sale|selling|purchase)\b/.test(text)) {
    out.intent = "SALE";
    applied.push("for sale");
  }

  const under = text.match(/\b(?:under|below|less than|max|up to)\s+(\d+)/);
  if (under?.[1]) {
    out.maxPriceCents = Number(under[1]) * 100;
    applied.push(`under ${under[1]}`);
  }
  const over = text.match(/\b(?:over|above|more than|min|from)\s+(\d+)/);
  if (over?.[1]) {
    out.minPriceCents = Number(over[1]) * 100;
    applied.push(`over ${over[1]}`);
  }
  if (/\b(free|no fee|no cost)\b/.test(text)) {
    out.maxPriceCents = 0;
    applied.push("free");
  }

  if (/\b(puppy|puppies|kitten|kittens|baby)\b/.test(text)) {
    out.maxAgeMonths = 12;
    applied.push("under a year old");
  } else if (/\b(young)\b/.test(text)) {
    out.maxAgeMonths = 36;
    applied.push("young");
  } else if (/\b(adult|grown)\b/.test(text)) {
    out.minAgeMonths = 24;
    applied.push("adult");
  } else if (/\b(senior|older|old)\b/.test(text)) {
    out.minAgeMonths = 84;
    applied.push("senior");
  }

  if (/\b(male|boy)\b/.test(text)) {
    out.sex = "MALE";
    applied.push("male");
  } else if (/\b(female|girl)\b/.test(text)) {
    out.sex = "FEMALE";
    applied.push("female");
  }

  if (/\b(vaccinated|vaccination|jabs|shots)\b/.test(text)) {
    out.vaccinatedOnly = true;
    applied.push("vaccinated");
  }
  if (/\b(verified|documented|papers|pedigree)\b/.test(text)) {
    out.verifiedOnly = true;
    applied.push("verified");
  }

  // "near cairo under 300" is how people actually type, so the place name has
  // to be matchable mid-query. It runs until the next filter keyword rather
  // than to the end of the string.
  const LOCATION_STOP =
    "under|below|less|than|max|up|to|over|above|more|min|from|free|young|adult|" +
    "grown|senior|older|old|male|boy|female|girl|vaccinated|vaccination|jabs|" +
    "shots|verified|documented|papers|pedigree|adopt|adoption|rescue|rehome|" +
    "rehoming|stud|mate|mating|breed|breeding|buy|sale|selling|purchase";

  const nearMatch = text.match(
    new RegExp(`\\b(?:near|in|around)\\s+((?:(?!\\b(?:${LOCATION_STOP})\\b)[a-z]+\\s*){1,3})`),
  );

  if (nearMatch?.[1]) {
    const city = nearMatch[1].trim();
    // "near me" is a request for geolocation, not a place name.
    if (city && city !== "me" && city.length >= 3) {
      out.city = city;
      applied.push(`near ${city}`);
    }
  }

  // Whatever is left over becomes free text: colours, breeds, temperament.
  const filterWords = new Set([
    ...Object.keys(speciesWords),
    "adopt", "adoption", "rescue", "rehome", "rehoming", "stud", "mate", "mating",
    "breed", "breeding", "buy", "sale", "selling", "purchase", "under", "below",
    "less", "than", "max", "up", "to", "over", "above", "more", "min", "from",
    "free", "young", "adult", "grown", "senior", "older", "old", "male", "boy",
    "female", "girl", "vaccinated", "vaccination", "jabs", "shots", "verified",
    "documented", "papers", "pedigree", "near", "in", "around", "baby",
  ]);

  const remaining = text
    .split(" ")
    .filter((w) => w && !filterWords.has(w) && !/^\d+$/.test(w))
    .join(" ")
    .trim();

  if (remaining) {
    out.query = remaining;
    applied.push(`matching "${remaining}"`);
  }

  out.interpretation = applied.length ? `Showing pets ${applied.join(", ")}.` : "Showing all pets.";
  return out;
}

// ---------------------------------------------------------------------------
// Care assistant
// ---------------------------------------------------------------------------

/**
 * Builds the grounding block for a pet. The assistant answers about *this*
 * animal, which is what separates it from a generic chatbot.
 */
export async function buildPetContext(petId: string, ownerId: string): Promise<string | null> {
  const pet = await db.pet.findFirst({
    where: { id: petId, ownerId, deletedAt: null },
    select: {
      name: true,
      species: true,
      sex: true,
      birthDate: true,
      weightKg: true,
      isNeutered: true,
      temperament: true,
      healthScore: true,
      breed: { select: { name: true, sizeClass: true, careLevel: true } },
      breedText: true,
      healthRecords: {
        where: { deletedAt: null },
        orderBy: { occurredAt: "desc" },
        take: 12,
        select: { type: true, title: true, occurredAt: true, nextDueAt: true, source: true },
      },
    },
  });
  if (!pet) return null;

  const now = new Date();
  const overdue = pet.healthRecords.filter((r) => r.nextDueAt && r.nextDueAt < now);

  return [
    `Pet: ${pet.name}`,
    `Species: ${pet.species}`,
    `Breed: ${pet.breed?.name ?? pet.breedText ?? "unknown"}`,
    `Sex: ${pet.sex}${pet.isNeutered ? " (neutered)" : ""}`,
    `Age: ${formatAge(pet.birthDate)}`,
    pet.weightKg ? `Weight: ${pet.weightKg} kg` : null,
    pet.temperament ? `Temperament: ${splitTags(pet.temperament).join(", ")}` : null,
    "",
    "Recent health record:",
    ...(pet.healthRecords.length
      ? pet.healthRecords.map(
          (r) =>
            `- ${r.occurredAt.toISOString().slice(0, 10)} ${r.type}: ${r.title}` +
            `${r.source === "CLINIC" ? " (clinic verified)" : " (owner entered)"}` +
            `${r.nextDueAt ? ` — next due ${r.nextDueAt.toISOString().slice(0, 10)}` : ""}`,
        )
      : ["- no records yet"]),
    overdue.length ? `\nOverdue items: ${overdue.map((r) => r.title).join(", ")}` : "",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

const CARE_ASSISTANT_SYSTEM = `You are PetMate's care assistant. You help owners with everyday questions about their own pet, using the record they keep on PetMate.

Boundaries, which matter more than being helpful:
- You are not a veterinarian and you never diagnose. Say so plainly when a question needs one.
- For anything that could be an emergency — breathing difficulty, seizure, bloat or a distended abdomen, suspected poisoning, uncontrolled bleeding, collapse, inability to urinate, a hit by a car, a bitch in trouble whelping — stop and tell the owner to contact an emergency vet now. Do not offer home management as an alternative. PetMate can find nearby clinics; say so.
- Never recommend a prescription medication, a dose, or a schedule. General guidance on over-the-counter basics is fine if you name the risk and say to confirm with a vet.
- Never contradict a clinic-recorded entry in the pet's record.

How to answer:
- Use the pet's actual age, species, breed and record. Refer to the animal by name.
- If the record shows something overdue, mention it once, without lecturing.
- Be concrete and short. Two or three short paragraphs, or a few bullets. No preamble.
- If you do not know, say so and suggest what a vet would check.`;

export async function careAssistantStream(params: {
  question: string;
  petContext: string | null;
  history: { role: "user" | "assistant"; content: string }[];
}): Promise<ReadableStream<Uint8Array> | null> {
  const system = params.petContext
    ? `${CARE_ASSISTANT_SYSTEM}\n\n--- The pet this conversation is about ---\n${params.petContext}`
    : `${CARE_ASSISTANT_SYSTEM}\n\nNo specific pet was selected, so keep guidance general and ask which animal it concerns when it matters.`;

  return streamClaude({
    system,
    effort: "low",
    maxTokens: 1500,
    messages: [
      ...params.history.slice(-8).map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: params.question.slice(0, 2000) },
    ],
  });
}

/**
 * The care assistant's deterministic path. Not a chatbot: it routes the
 * question to the relevant part of the product, which is honest and often more
 * useful than a paragraph of generic text.
 */
export function careAssistantFallback(question: string): {
  answer: string;
  links: { label: string; href: string }[];
} {
  const text = normalizeSearchText(question);

  if (
    /\b(emergency|bleeding|seizure|poison|collapse|not breathing|hit by|choking|bloat)\b/.test(text)
  ) {
    return {
      answer:
        "This sounds urgent. Contact an emergency vet now rather than waiting for guidance here. If you do not have one, use the clinic finder and filter for emergency services.",
      links: [{ label: "Find an emergency clinic", href: "/clinics?emergency=true" }],
    };
  }

  if (/\b(vaccin|jab|shot|booster)\b/.test(text)) {
    return {
      answer:
        "Vaccination schedules depend on species, age and where you live. Your pet's health timeline shows what has been given and what is due, and booking through PetMate adds the result to the record automatically.",
      links: [
        { label: "Open pet health records", href: "/dashboard/pets" },
        { label: "Book a vaccination", href: "/clinics?category=VACCINATION" },
      ],
    };
  }

  if (/\b(breed|mate|stud|litter|pregnan)\b/.test(text)) {
    return {
      answer:
        "Breeding questions depend heavily on the individual animal's age, health and history. The breeding tools check compatibility and show exactly which factors apply to your pet.",
      links: [{ label: "Open breeding matches", href: "/dashboard/breeding" }],
    };
  }

  return {
    answer:
      "The AI care assistant is not configured on this deployment, so I cannot answer freely. Your pet's health timeline and the clinic finder cover most questions, and a vet can answer the rest properly.",
    links: [
      { label: "Pet health records", href: "/dashboard/pets" },
      { label: "Find a vet", href: "/clinics" },
    ],
  };
}

// ---------------------------------------------------------------------------
// Moderation assist
// ---------------------------------------------------------------------------

export interface ModerationOpinion {
  concern: "NONE" | "LOW" | "MEDIUM" | "HIGH";
  reasons: string[];
  summary: string;
}

const moderationSchema = z.object({
  concern: z.enum(["NONE", "LOW", "MEDIUM", "HIGH"]),
  reasons: z.array(z.string()).max(5),
  summary: z.string().max(300),
});

/**
 * A second opinion for the moderation queue. Advisory only: it orders a human's
 * queue and never takes an action by itself.
 */
export async function reviewListingForModeration(input: {
  title: string;
  description: string;
  priceCents: number;
  species: string;
  sellerAgeDays: number;
  ruleFlags: string[];
}): Promise<AiResult<ModerationOpinion>> {
  const fallback: ModerationOpinion = {
    concern: input.ruleFlags.length >= 3 ? "HIGH" : input.ruleFlags.length ? "MEDIUM" : "NONE",
    reasons: input.ruleFlags,
    summary: input.ruleFlags.length
      ? "Flagged by PetMate's rule checks."
      : "No rule checks triggered.",
  };

  if (!aiAvailable()) {
    return ruleResult(fallback, "Rule checks only. AI review is not configured.");
  }

  const parsed = await callClaudeStructured<ModerationOpinion>({
    system: MODERATION_SYSTEM,
    cacheSystem: true,
    effort: "low",
    maxTokens: 700,
    outputFormat: zodOutputFormat(moderationSchema),
    messages: [
      {
        role: "user",
        content: [
          `Seller account age: ${input.sellerAgeDays} days`,
          `Species: ${input.species}`,
          `Price: ${(input.priceCents / 100).toFixed(2)}`,
          `Automated rule flags: ${input.ruleFlags.join("; ") || "none"}`,
          "",
          `Title: ${input.title}`,
          "",
          input.description,
        ].join("\n"),
      },
    ],
  });

  if (!parsed) return ruleResult(fallback, "Rule checks only. The AI reviewer was unavailable.");

  // The rules are evidence; never let a model talk the queue out of them.
  const concernRank = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 } as const;
  const merged: ModerationOpinion = {
    concern:
      concernRank[parsed.concern] >= concernRank[fallback.concern] ? parsed.concern : fallback.concern,
    reasons: [...new Set([...input.ruleFlags, ...parsed.reasons])].slice(0, 6),
    summary: parsed.summary,
  };

  return aiResult(merged);
}

const MODERATION_SYSTEM = `You triage pet marketplace listings for a human moderator. You do not make decisions; you rank how much a person should look.

Raise concern for:
- advance-fee patterns: a deposit before viewing, shipping or customs fees, a "pet courier" who will make contact
- payment methods with no recourse: wire transfer, gift cards, crypto, money transfer services
- pushing the conversation to another app
- prices far below plausible for the animal described
- text that reads as copied from another listing, or a description that contradicts itself
- welfare concerns: animals too young to leave their mother, protected or prohibited species, breeding language that implies neglect
- a listing that treats the animal as an object rather than an animal

Do not raise concern for: a bad writer, an unusual price with a stated reason, a first-time seller, or a short listing that is otherwise specific and honest.

Be concise. Each reason is one clause a moderator can act on.`;
