import { ageInMonths, haversineKm, splitTags, clamp } from "@/lib/utils";

/**
 * Breeding compatibility engine — rules-v1.
 *
 * This is a deterministic, weighted rule engine. It is NOT machine learning,
 * and nothing in the product calls it that. Every score comes with the factor
 * breakdown that produced it, so an owner can see precisely why two animals
 * scored 82 and not 40.
 *
 * It is built to be replaced. `score()` is pure — same inputs, same output, no
 * database, no clock — so it can be evaluated against real outcomes once the
 * platform has enough completed breedings to learn from. When a model does
 * arrive it implements the same interface and the engine label changes from
 * "rules-v1" to something else. Until then, honesty costs nothing.
 *
 * Hard blocks (score 0, never shown as a match):
 *   - same species is required
 *   - opposite sex is required
 *   - neither animal may be neutered
 *   - under the minimum breeding age for the species
 *   - a parent/offspring or full-sibling relationship
 */

export interface BreedingCandidate {
  petId: string;
  ownerId: string;
  species: string;
  sex: string;
  breedId: string | null;
  breedName: string | null;
  birthDate: Date | null;
  weightKg: number | null;
  isNeutered: boolean;
  temperament: string | null;
  healthScore: number;
  verificationLevel: string;
  lat: number | null;
  lng: number | null;
  city: string | null;
  country: string | null;
  damId: string | null;
  sireId: string | null;
  /** Ancestor ids, up to 3 generations, for the relatedness check. */
  ancestors: string[];
  vaccinationsCurrent: boolean;
  documentCount: number;
  profile: {
    willingToTravelKm: number;
    minPartnerAgeMonths: number | null;
    maxPartnerAgeMonths: number | null;
    requiresHealthTests: boolean;
    requiresVaccination: boolean;
    requiresPedigree: boolean;
    allowsMixedBreed: boolean;
    preferredBreedIds: string[];
    temperamentTags: string | null;
  } | null;
}

export interface FactorScore {
  key: string;
  label: string;
  /** 0-1, how well this factor scored. */
  value: number;
  weight: number;
  points: number;
  detail: string;
}

export interface CompatibilityResult {
  score: number;
  engine: "rules-v1";
  eligible: boolean;
  blockers: string[];
  factors: FactorScore[];
  headline: string;
}

/** Minimum age at which breeding is responsible, in months, by species. */
const MIN_BREEDING_AGE_MONTHS: Record<string, number> = {
  DOG: 18,
  CAT: 12,
  RABBIT: 6,
  HORSE: 36,
  BIRD: 12,
  SMALL_MAMMAL: 6,
  REPTILE: 18,
  OTHER: 12,
};

/** Upper age beyond which breeding carries real welfare risk, in months. */
const MAX_BREEDING_AGE_MONTHS: Record<string, number> = {
  DOG: 96,
  CAT: 84,
  RABBIT: 48,
  HORSE: 240,
  BIRD: 120,
  SMALL_MAMMAL: 30,
  REPTILE: 180,
  OTHER: 120,
};

/**
 * Factor weights. Exported because the public breeding page publishes them —
 * a page that restates these from memory would drift the moment one changes.
 */
export const WEIGHTS = {
  breed: 22,
  health: 24,
  age: 16,
  distance: 14,
  temperament: 10,
  verification: 8,
  preferences: 6,
} as const;

export function scoreCompatibility(
  a: BreedingCandidate,
  b: BreedingCandidate,
  now: Date = new Date(),
): CompatibilityResult {
  const blockers = hardBlockers(a, b, now);
  if (blockers.length) {
    return {
      score: 0,
      engine: "rules-v1",
      eligible: false,
      blockers,
      factors: [],
      headline: blockers[0]!,
    };
  }

  const factors: FactorScore[] = [
    scoreBreed(a, b),
    scoreHealth(a, b),
    scoreAge(a, b, now),
    scoreDistance(a, b),
    scoreTemperament(a, b),
    scoreVerification(a, b),
    scorePreferences(a, b, now),
  ];

  const total = factors.reduce((sum, f) => sum + f.points, 0);
  const maxTotal = factors.reduce((sum, f) => sum + f.weight, 0);
  const score = clamp(Math.round((total / maxTotal) * 100), 0, 100);

  return {
    score,
    engine: "rules-v1",
    eligible: true,
    blockers: [],
    factors,
    headline: headlineFor(score, factors),
  };
}

function hardBlockers(a: BreedingCandidate, b: BreedingCandidate, now: Date): string[] {
  const blockers: string[] = [];

  if (a.petId === b.petId) blockers.push("Same pet");
  if (a.species !== b.species) blockers.push("Different species");
  if (a.sex === b.sex || a.sex === "UNKNOWN" || b.sex === "UNKNOWN") {
    blockers.push("Breeding needs one male and one female");
  }
  if (a.isNeutered || b.isNeutered) blockers.push("One of these pets is neutered");

  const minAge = MIN_BREEDING_AGE_MONTHS[a.species] ?? 12;
  const ageA = ageInMonths(a.birthDate, now);
  const ageB = ageInMonths(b.birthDate, now);

  if (ageA !== null && ageA < minAge) blockers.push(`${a.species.toLowerCase()} is below the minimum breeding age`);
  if (ageB !== null && ageB < minAge) blockers.push("The other pet is below the minimum breeding age");

  // Close relatives. Doubling on a recent ancestor is where the real welfare
  // harm in hobby breeding happens, so it is a block rather than a penalty.
  if (areCloselyRelated(a, b)) blockers.push("These pets are closely related");

  return blockers;
}

export function areCloselyRelated(a: BreedingCandidate, b: BreedingCandidate): boolean {
  if (a.damId && a.damId === b.petId) return true;
  if (a.sireId && a.sireId === b.petId) return true;
  if (b.damId && b.damId === a.petId) return true;
  if (b.sireId && b.sireId === a.petId) return true;

  // Full siblings: both parents shared.
  if (a.damId && a.sireId && a.damId === b.damId && a.sireId === b.sireId) return true;

  // Any shared ancestor within the recorded generations.
  const ancestorsOfB = new Set(b.ancestors);
  return a.ancestors.some((id) => ancestorsOfB.has(id));
}

function scoreBreed(a: BreedingCandidate, b: BreedingCandidate): FactorScore {
  let value: number;
  let detail: string;

  if (a.breedId && b.breedId && a.breedId === b.breedId) {
    value = 1;
    detail = `Both are ${a.breedName ?? "the same breed"}`;
  } else if (a.breedId && b.breedId) {
    const allowsMixed = (a.profile?.allowsMixedBreed ?? true) && (b.profile?.allowsMixedBreed ?? true);
    value = allowsMixed ? 0.5 : 0.15;
    detail = allowsMixed
      ? `Cross of ${a.breedName ?? "one breed"} and ${b.breedName ?? "another"}`
      : "Different breeds, and one owner prefers a same-breed match";
  } else {
    value = 0.45;
    detail = "At least one breed is unrecorded";
  }

  return factor("breed", "Breed match", value, WEIGHTS.breed, detail);
}

function scoreHealth(a: BreedingCandidate, b: BreedingCandidate): FactorScore {
  const avg = (a.healthScore + b.healthScore) / 2 / 100;

  let value = avg;
  const notes: string[] = [];

  // A partner who demands vaccination and does not get it is a near-miss.
  if (a.profile?.requiresVaccination && !b.vaccinationsCurrent) {
    value *= 0.4;
    notes.push("vaccinations not current on one side");
  }
  if (b.profile?.requiresVaccination && !a.vaccinationsCurrent) {
    value *= 0.4;
    notes.push("vaccinations not current on one side");
  }
  if (a.profile?.requiresHealthTests && b.documentCount === 0) {
    value *= 0.6;
    notes.push("no health documents uploaded");
  }
  if (b.profile?.requiresHealthTests && a.documentCount === 0) {
    value *= 0.6;
    notes.push("no health documents uploaded");
  }

  const detail = notes.length
    ? `Average health record ${Math.round(avg * 100)}/100 — ${[...new Set(notes)].join(", ")}`
    : `Average health record ${Math.round(avg * 100)}/100`;

  return factor("health", "Health records", clamp(value, 0, 1), WEIGHTS.health, detail);
}

function scoreAge(a: BreedingCandidate, b: BreedingCandidate, now: Date): FactorScore {
  const ageA = ageInMonths(a.birthDate, now);
  const ageB = ageInMonths(b.birthDate, now);

  if (ageA === null || ageB === null) {
    return factor("age", "Age suitability", 0.5, WEIGHTS.age, "One birth date is unknown");
  }

  const min = MIN_BREEDING_AGE_MONTHS[a.species] ?? 12;
  const max = MAX_BREEDING_AGE_MONTHS[a.species] ?? 120;

  // Peak is the middle of the viable window; score falls off toward each end.
  const prime = (age: number) => {
    const span = max - min;
    const position = (age - min) / span; // 0 at minimum, 1 at maximum
    if (position < 0 || position > 1) return 0;
    // Best between 15% and 55% into the window.
    if (position >= 0.15 && position <= 0.55) return 1;
    if (position < 0.15) return 0.7 + (position / 0.15) * 0.3;
    return clamp(1 - (position - 0.55) / 0.45, 0.1, 1);
  };

  const value = (prime(ageA) + prime(ageB)) / 2;
  const years = (m: number) => (m / 12).toFixed(1);

  return factor(
    "age",
    "Age suitability",
    value,
    WEIGHTS.age,
    `${years(ageA)}y and ${years(ageB)}y — ${value > 0.8 ? "both in prime range" : value > 0.5 ? "acceptable" : "one is near the edge of the safe range"}`,
  );
}

function scoreDistance(a: BreedingCandidate, b: BreedingCandidate): FactorScore {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) {
    const sameCity = a.city && b.city && a.city.toLowerCase() === b.city.toLowerCase();
    return factor(
      "distance",
      "Distance",
      sameCity ? 0.85 : 0.4,
      WEIGHTS.distance,
      sameCity ? `Both in ${a.city}` : "Exact locations unknown",
    );
  }

  const km = haversineKm(a.lat, a.lng, b.lat, b.lng);
  const willing = Math.max(
    a.profile?.willingToTravelKm ?? 50,
    b.profile?.willingToTravelKm ?? 50,
  );

  // Full marks inside the shorter of the two travel limits, tapering to zero at
  // three times the limit.
  const value = km <= willing ? 1 : clamp(1 - (km - willing) / (willing * 2), 0, 1);

  return factor(
    "distance",
    "Distance",
    value,
    WEIGHTS.distance,
    `${Math.round(km)} km apart, ${km <= willing ? "within" : "beyond"} the stated travel range`,
  );
}

function scoreTemperament(a: BreedingCandidate, b: BreedingCandidate): FactorScore {
  const tagsA = new Set(splitTags(a.temperament).map((t) => t.toLowerCase()));
  const tagsB = new Set(splitTags(b.temperament).map((t) => t.toLowerCase()));

  if (!tagsA.size || !tagsB.size) {
    return factor("temperament", "Temperament", 0.5, WEIGHTS.temperament, "Temperament not recorded for both");
  }

  const shared = [...tagsA].filter((t) => tagsB.has(t));
  const union = new Set([...tagsA, ...tagsB]).size;
  const jaccard = shared.length / union;

  // Some complementarity is good; identical is not required. Peak around 0.5.
  const value = clamp(0.45 + jaccard * 0.9, 0, 1);

  return factor(
    "temperament",
    "Temperament",
    value,
    WEIGHTS.temperament,
    shared.length
      ? `Shared traits: ${shared.slice(0, 3).join(", ")}`
      : "Different temperaments, which can balance well",
  );
}

function scoreVerification(a: BreedingCandidate, b: BreedingCandidate): FactorScore {
  const rank: Record<string, number> = {
    NONE: 0,
    OWNER_CLAIMED: 0.4,
    DOCUMENTED: 0.75,
    CLINIC_VERIFIED: 1,
  };

  const value = ((rank[a.verificationLevel] ?? 0) + (rank[b.verificationLevel] ?? 0)) / 2;

  return factor(
    "verification",
    "Verification",
    value,
    WEIGHTS.verification,
    value === 1
      ? "Both clinic verified"
      : value >= 0.6
        ? "Documents on file for at least one"
        : "Limited verification on both sides",
  );
}

function scorePreferences(a: BreedingCandidate, b: BreedingCandidate, now: Date): FactorScore {
  const checks: { ok: boolean; label: string }[] = [];

  const ageB = ageInMonths(b.birthDate, now);
  const ageA = ageInMonths(a.birthDate, now);

  if (a.profile?.minPartnerAgeMonths != null && ageB != null) {
    checks.push({ ok: ageB >= a.profile.minPartnerAgeMonths, label: "minimum partner age" });
  }
  if (a.profile?.maxPartnerAgeMonths != null && ageB != null) {
    checks.push({ ok: ageB <= a.profile.maxPartnerAgeMonths, label: "maximum partner age" });
  }
  if (b.profile?.minPartnerAgeMonths != null && ageA != null) {
    checks.push({ ok: ageA >= b.profile.minPartnerAgeMonths, label: "partner age preference" });
  }
  if (a.profile?.preferredBreedIds.length && b.breedId) {
    checks.push({
      ok: a.profile.preferredBreedIds.includes(b.breedId),
      label: "preferred breed",
    });
  }
  if (b.profile?.preferredBreedIds.length && a.breedId) {
    checks.push({
      ok: b.profile.preferredBreedIds.includes(a.breedId),
      label: "preferred breed",
    });
  }
  if (a.profile?.requiresPedigree) {
    checks.push({ ok: b.documentCount > 0, label: "pedigree requirement" });
  }

  if (!checks.length) {
    return factor("preferences", "Stated preferences", 0.7, WEIGHTS.preferences, "No specific requirements set");
  }

  const met = checks.filter((c) => c.ok).length;
  const failed = checks.filter((c) => !c.ok).map((c) => c.label);

  return factor(
    "preferences",
    "Stated preferences",
    met / checks.length,
    WEIGHTS.preferences,
    failed.length ? `Does not meet: ${[...new Set(failed)].join(", ")}` : "Meets every stated requirement",
  );
}

function factor(
  key: string,
  label: string,
  value: number,
  weight: number,
  detail: string,
): FactorScore {
  const clamped = clamp(value, 0, 1);
  return { key, label, value: clamped, weight, points: Math.round(clamped * weight * 10) / 10, detail };
}

function headlineFor(score: number, factors: FactorScore[]): string {
  const weakest = [...factors].sort((a, b) => a.value - b.value)[0];
  const strongest = [...factors].sort((a, b) => b.value - a.value)[0];

  if (score >= 80) return `Strong match — ${strongest?.label.toLowerCase()} lines up well`;
  if (score >= 60) return `Good match, with ${weakest?.label.toLowerCase()} worth discussing`;
  if (score >= 40) return `Possible match — ${weakest?.label.toLowerCase()} is the main gap`;
  return `Weak match on ${weakest?.label.toLowerCase()}`;
}

export function scoreBand(score: number): { label: string; tone: "success" | "warning" | "neutral" | "danger" } {
  if (score >= 80) return { label: "Strong", tone: "success" };
  if (score >= 60) return { label: "Good", tone: "success" };
  if (score >= 40) return { label: "Fair", tone: "warning" };
  if (score > 0) return { label: "Weak", tone: "neutral" };
  return { label: "Not eligible", tone: "danger" };
}
