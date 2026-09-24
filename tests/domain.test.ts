import { describe, it, expect, beforeEach } from "vitest";
import { db, makeUser, makePet, makeListing, resetDatabase } from "./helpers";
import { scoreCompatibility, areCloselyRelated, type BreedingCandidate } from "@/lib/breeding/compatibility";
import { scoreFromSignals } from "@/lib/services/trust.service";
import { recomputeHealthScore, addHealthRecord, getPublicHealthSummary } from "@/lib/services/health.service";
import { scoreApplication } from "@/lib/services/adoption.service";
import { scoreListingRisk, scoreMessageRisk } from "@/lib/services/risk.service";
import { deterministicSearchParse, deterministicListingFeedback } from "@/lib/ai/features";
import { normalizeSearchText, parseSearchTerms, buildSearchText, highlightSegments } from "@/lib/search/text";
import { searchListings } from "@/lib/services/search.service";
import { haversineKm, boundingBox, ageInMonths, formatAge, slugify } from "@/lib/utils";
import { addMonths } from "@/lib/utils";

function candidate(overrides: Partial<BreedingCandidate> = {}): BreedingCandidate {
  return {
    petId: overrides.petId ?? "pet-a",
    ownerId: "owner-a",
    species: "DOG",
    sex: "FEMALE",
    breedId: "breed-lab",
    breedName: "Labrador Retriever",
    birthDate: addMonths(new Date(), -36),
    weightKg: 28,
    isNeutered: false,
    temperament: "Calm,Gentle",
    healthScore: 80,
    verificationLevel: "CLINIC_VERIFIED",
    lat: 30.0444,
    lng: 31.2357,
    city: "Cairo",
    country: "Egypt",
    damId: null,
    sireId: null,
    ancestors: [],
    vaccinationsCurrent: true,
    documentCount: 3,
    profile: {
      willingToTravelKm: 100,
      minPartnerAgeMonths: null,
      maxPartnerAgeMonths: null,
      requiresHealthTests: true,
      requiresVaccination: true,
      requiresPedigree: false,
      allowsMixedBreed: false,
      preferredBreedIds: [],
      temperamentTags: "Calm,Gentle",
    },
    ...overrides,
  };
}

describe("breeding compatibility", () => {
  it("is deterministic — the same inputs always give the same score", () => {
    const a = candidate({ petId: "a" });
    const b = candidate({ petId: "b", sex: "MALE", ownerId: "owner-b" });

    const first = scoreCompatibility(a, b, new Date("2026-01-01"));
    const second = scoreCompatibility(a, b, new Date("2026-01-01"));

    expect(first.score).toBe(second.score);
    expect(first.engine).toBe("rules-v1");
  });

  it("blocks pairings that must never be suggested", () => {
    const female = candidate({ petId: "a" });

    const sameSex = scoreCompatibility(female, candidate({ petId: "b", sex: "FEMALE" }));
    expect(sameSex.eligible).toBe(false);
    expect(sameSex.score).toBe(0);
    expect(sameSex.blockers.join(" ")).toMatch(/one male and one female/i);

    const neutered = scoreCompatibility(
      female,
      candidate({ petId: "b", sex: "MALE", isNeutered: true }),
    );
    expect(neutered.eligible).toBe(false);
    expect(neutered.blockers.join(" ")).toMatch(/neutered/i);

    const differentSpecies = scoreCompatibility(
      female,
      candidate({ petId: "b", sex: "MALE", species: "CAT" }),
    );
    expect(differentSpecies.eligible).toBe(false);

    // A dog under 18 months is below the responsible breeding age.
    const tooYoung = scoreCompatibility(
      female,
      candidate({ petId: "b", sex: "MALE", birthDate: addMonths(new Date(), -8) }),
    );
    expect(tooYoung.eligible).toBe(false);
    expect(tooYoung.blockers.join(" ")).toMatch(/minimum breeding age/i);
  });

  it("blocks close relatives, which is the welfare case that matters most", () => {
    const parent = candidate({ petId: "parent", sex: "MALE" });
    const child = candidate({ petId: "child", sex: "FEMALE", sireId: "parent" });

    expect(areCloselyRelated(child, parent)).toBe(true);
    expect(scoreCompatibility(child, parent).eligible).toBe(false);

    // Full siblings share both parents.
    const siblingA = candidate({ petId: "s1", sex: "MALE", damId: "mum", sireId: "dad" });
    const siblingB = candidate({ petId: "s2", sex: "FEMALE", damId: "mum", sireId: "dad" });
    expect(areCloselyRelated(siblingA, siblingB)).toBe(true);

    // A shared grandparent also counts.
    const cousinA = candidate({ petId: "c1", sex: "MALE", ancestors: ["gran", "x"] });
    const cousinB = candidate({ petId: "c2", sex: "FEMALE", ancestors: ["gran", "y"] });
    expect(areCloselyRelated(cousinA, cousinB)).toBe(true);

    // Unrelated animals are fine.
    const unrelatedA = candidate({ petId: "u1", sex: "MALE", ancestors: ["a1", "a2"] });
    const unrelatedB = candidate({ petId: "u2", sex: "FEMALE", ancestors: ["b1", "b2"] });
    expect(areCloselyRelated(unrelatedA, unrelatedB)).toBe(false);
  });

  it("scores a strong pairing above a weak one, and explains why", () => {
    const female = candidate({ petId: "a" });

    const ideal = scoreCompatibility(
      female,
      candidate({ petId: "b", sex: "MALE", ownerId: "owner-b" }),
    );

    const poor = scoreCompatibility(
      female,
      candidate({
        petId: "c",
        sex: "MALE",
        ownerId: "owner-c",
        breedId: "breed-chihuahua",
        breedName: "Chihuahua",
        healthScore: 10,
        verificationLevel: "NONE",
        vaccinationsCurrent: false,
        documentCount: 0,
        // Far away: London to Cairo.
        lat: 51.5074,
        lng: -0.1278,
        city: "London",
      }),
    );

    expect(ideal.score).toBeGreaterThan(poor.score);
    expect(ideal.score).toBeGreaterThan(70);

    // The breakdown must be present and add up to the score.
    expect(ideal.factors.length).toBeGreaterThan(4);
    for (const factor of ideal.factors) {
      expect(factor.detail.length).toBeGreaterThan(0);
      expect(factor.value).toBeGreaterThanOrEqual(0);
      expect(factor.value).toBeLessThanOrEqual(1);
    }

    const totalPoints = ideal.factors.reduce((sum, f) => sum + f.points, 0);
    const maxPoints = ideal.factors.reduce((sum, f) => sum + f.weight, 0);
    expect(Math.round((totalPoints / maxPoints) * 100)).toBe(ideal.score);
  });

  it("penalises a partner who does not meet a stated requirement", () => {
    const strict = candidate({
      petId: "a",
      profile: {
        willingToTravelKm: 50,
        minPartnerAgeMonths: 24,
        maxPartnerAgeMonths: 72,
        requiresHealthTests: true,
        requiresVaccination: true,
        requiresPedigree: true,
        allowsMixedBreed: false,
        preferredBreedIds: ["breed-lab"],
        temperamentTags: "Calm",
      },
    });

    const meets = scoreCompatibility(strict, candidate({ petId: "b", sex: "MALE" }));
    const misses = scoreCompatibility(
      strict,
      candidate({ petId: "c", sex: "MALE", breedId: "breed-other", documentCount: 0 }),
    );

    expect(meets.score).toBeGreaterThan(misses.score);

    const preferenceFactor = misses.factors.find((f) => f.key === "preferences");
    expect(preferenceFactor?.detail).toMatch(/does not meet/i);
  });
});

describe("trust scoring", () => {
  it("sums signals and clamps to 0-100", () => {
    expect(scoreFromSignals([])).toBe(0);
    expect(scoreFromSignals([{ kind: "EMAIL_VERIFIED", weight: 8 }])).toBe(8);

    // Penalties can take a score down but never below zero.
    expect(
      scoreFromSignals([
        { kind: "EMAIL_VERIFIED", weight: 8 },
        { kind: "DISPUTE_LOST", weight: -20 },
      ]),
    ).toBe(0);

    // A huge pile of positives cannot exceed 100.
    const many = Array.from({ length: 40 }, () => ({ kind: "ID_VERIFIED", weight: 20 }));
    expect(scoreFromSignals(many)).toBeLessThanOrEqual(100);
  });

  it("caps a repeatable signal so it cannot be farmed", () => {
    // Twenty tiny sales must not outweigh identity verification.
    const sales = Array.from({ length: 20 }, () => ({ kind: "SALE_COMPLETED", weight: 5 }));
    const capped = scoreFromSignals(sales);
    expect(capped).toBe(25);
  });

  it("does not cap penalties", () => {
    const reports = Array.from({ length: 3 }, () => ({ kind: "REPORT_UPHELD", weight: -25 }));
    const withPositives = [
      { kind: "ID_VERIFIED", weight: 20 },
      { kind: "EMAIL_VERIFIED", weight: 8 },
      ...reports,
    ];
    expect(scoreFromSignals(withPositives)).toBe(0);
  });
});

describe("health scoring", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rewards clinic-verified records over self-reported ones", async () => {
    const owner = await makeUser();
    const selfReported = await makePet(owner.id, { name: "Self" });
    const documented = await makePet(owner.id, { name: "Documented" });

    for (const petId of [selfReported.id, documented.id]) {
      for (let i = 0; i < 4; i++) {
        await db.healthRecord.create({
          data: {
            petId,
            type: i === 0 ? "CHECKUP" : "VACCINATION",
            title: `Record ${i}`,
            occurredAt: addMonths(new Date(), -2),
            nextDueAt: addMonths(new Date(), 10),
            createdById: owner.id,
            source: petId === documented.id ? "CLINIC" : "OWNER",
            verifiedAt: petId === documented.id ? new Date() : null,
          },
        });
      }
    }

    const selfScore = await recomputeHealthScore(selfReported.id);
    const clinicScore = await recomputeHealthScore(documented.id);

    expect(clinicScore).toBeGreaterThan(selfScore);
  });

  it("penalises overdue items", async () => {
    const owner = await makeUser();
    const current = await makePet(owner.id, { name: "Current" });
    const overdue = await makePet(owner.id, { name: "Overdue" });

    await db.healthRecord.create({
      data: {
        petId: current.id,
        type: "VACCINATION",
        title: "Rabies",
        occurredAt: addMonths(new Date(), -2),
        nextDueAt: addMonths(new Date(), 10),
        createdById: owner.id,
      },
    });

    await db.healthRecord.create({
      data: {
        petId: overdue.id,
        type: "VACCINATION",
        title: "Rabies",
        occurredAt: addMonths(new Date(), -20),
        nextDueAt: addMonths(new Date(), -8),
        createdById: owner.id,
      },
    });

    expect(await recomputeHealthScore(current.id)).toBeGreaterThan(
      await recomputeHealthScore(overdue.id),
    );
  });

  it("does not punish a newborn with no records yet", async () => {
    const owner = await makeUser();
    const puppy = await makePet(owner.id, { ageMonths: 1 });

    const score = await recomputeHealthScore(puppy.id);
    expect(score).toBeGreaterThanOrEqual(40);
  });

  it("reports vaccination currency honestly in the public summary", async () => {
    const owner = await makeUser();
    const pet = await makePet(owner.id);

    await addHealthRecord(owner.auth, {
      petId: pet.id,
      type: "VACCINATION",
      title: "Rabies",
      occurredAt: addMonths(new Date(), -20),
      nextDueAt: addMonths(new Date(), -8),
    });

    const summary = await getPublicHealthSummary(pet.id);
    expect(summary.vaccinated).toBe(true);
    expect(summary.vaccinationsCurrent).toBe(false);
    expect(summary.clinicVerifiedCount).toBe(0);
  });
});

describe("adoption fit scoring", () => {
  it("rewards more time at home and penalises long absences", () => {
    const base = {
      homeType: "HOUSE" as const,
      hasYard: true,
      experienceLevel: "SOME" as const,
      hasOtherPets: false,
      motivation: "x".repeat(300),
      previousPets: "x".repeat(60),
    };

    const homeAllDay = scoreApplication({ ...base, hoursAloneDaily: 2 }, "DOG");
    const goneAllDay = scoreApplication({ ...base, hoursAloneDaily: 11 }, "DOG");

    expect(homeAllDay).toBeGreaterThan(goneAllDay);
  });

  it("applies species-specific realities", () => {
    const apartment = {
      homeType: "APARTMENT" as const,
      hasYard: false,
      hoursAloneDaily: 4,
      experienceLevel: "SOME" as const,
      hasOtherPets: false,
      motivation: "x".repeat(100),
      previousPets: "",
    };

    // A horse in a flat should score far worse than a cat in a flat.
    expect(scoreApplication(apartment, "HORSE")).toBeLessThan(scoreApplication(apartment, "CAT"));
  });

  it("stays inside 0-100", () => {
    const extreme = scoreApplication(
      {
        homeType: "FARM",
        hasYard: true,
        hoursAloneDaily: 0,
        experienceLevel: "EXPERIENCED",
        hasOtherPets: true,
        motivation: "x".repeat(2000),
        previousPets: "x".repeat(500),
      },
      "DOG",
    );
    expect(extreme).toBeLessThanOrEqual(100);
    expect(extreme).toBeGreaterThanOrEqual(0);
  });
});

describe("risk heuristics", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("flags the scam patterns it was built for", async () => {
    const seller = await makeUser({ trustScore: 50 });

    const clean = await scoreListingRisk({
      sellerId: seller.id,
      priceCents: 80_000,
      species: "DOG",
      title: "Labrador puppy from health-tested parents",
      description:
        "She has been raised in the house with children and a cat, is used to the vacuum and the doorbell, and comes with her first vaccinations, microchip and four weeks of insurance. Visits welcome before you decide.",
    });

    const scam = await scoreListingRisk({
      sellerId: seller.id,
      priceCents: 80_000,
      species: "DOG",
      title: "URGENT must go today",
      description:
        "Free to good home just pay shipping. Contact me on whatsapp +20 100 123 4567 and send the deposit by western union, the pet courier will contact you about the customs fee.",
    });

    expect(scam.score).toBeGreaterThan(clean.score);
    expect(scam.score).toBeGreaterThanOrEqual(60);
    expect(scam.reasons.length).toBeGreaterThan(2);
  });

  it("flags off-platform payment requests in messages", () => {
    expect(scoreMessageRisk("Sounds good, when can I visit?").flagged).toBe(false);
    expect(scoreMessageRisk("Please send the deposit first via western union").flagged).toBe(true);
    expect(scoreMessageRisk("Can you pay outside the app?").flagged).toBe(true);
  });

  it("treats a new account with an expensive listing as higher risk", async () => {
    const established = await makeUser({ trustScore: 70 });
    await db.user.update({
      where: { id: established.id },
      data: { createdAt: addMonths(new Date(), -12) },
    });

    const brandNew = await makeUser({ trustScore: 0, emailVerified: false });

    const params = {
      priceCents: 400_000,
      species: "DOG",
      title: "Puppy for sale to a good home",
      description: "A description that is long enough to avoid the short-description penalty here.",
    };

    const establishedRisk = await scoreListingRisk({ ...params, sellerId: established.id });
    const newRisk = await scoreListingRisk({ ...params, sellerId: brandNew.id });

    expect(newRisk.score).toBeGreaterThan(establishedRisk.score);
  });
});

describe("search", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("normalises accents and case so matching is engine-independent", () => {
    expect(normalizeSearchText("Münchener Schäferhund")).toBe("munchener schaferhund");
    expect(normalizeSearchText("  Golden   Retriever!  ")).toBe("golden retriever");
    expect(buildSearchText("Bella", null, "Labrador")).toBe("bella labrador");
  });

  it("drops noise words but never returns nothing", () => {
    // "dog" is a real search term and must survive; only noise words go.
    expect(parseSearchTerms("a dog for the home")).toEqual(["dog", "home"]);
    // A query of pure stop words falls back to the raw tokens.
    expect(parseSearchTerms("the a for").length).toBeGreaterThan(0);
  });

  it("highlights matched segments without losing text", () => {
    const segments = highlightSegments("Golden Retriever puppy", "retriever");
    expect(segments.map((s) => s.text).join("")).toBe("Golden Retriever puppy");
    expect(segments.some((s) => s.match)).toBe(true);
  });

  it("parses a plain-language query into filters", () => {
    const parsed = deterministicSearchParse("calm small dog near cairo under 300");

    expect(parsed.species).toContain("DOG");
    expect(parsed.maxPriceCents).toBe(30_000);
    expect(parsed.city).toBe("cairo");
    expect(parsed.interpretation.length).toBeGreaterThan(0);

    const adoption = deterministicSearchParse("kitten for adoption vaccinated");
    expect(adoption.species).toContain("CAT");
    expect(adoption.intent).toBe("ADOPTION");
    expect(adoption.maxAgeMonths).toBe(12);
    expect(adoption.vaccinatedOnly).toBe(true);
  });

  it("filters listings by species, price and intent against the database", async () => {
    const seller = await makeUser();
    const dog = await makePet(seller.id, { species: "DOG" });
    const cat = await makePet(seller.id, { species: "CAT" });

    await makeListing(seller.id, dog.id, { priceCents: 100_000 });
    await makeListing(seller.id, cat.id, { priceCents: 20_000 });

    const dogs = await searchListings({ species: ["DOG"] });
    expect(dogs.total).toBe(1);
    expect(dogs.items[0]!.pet.species).toBe("DOG");

    const cheap = await searchListings({ maxPriceCents: 50_000 });
    expect(cheap.total).toBe(1);
    expect(cheap.items[0]!.pet.species).toBe("CAT");

    const none = await searchListings({ intent: "ADOPTION" });
    expect(none.total).toBe(0);
  });

  it("never returns a draft or removed listing publicly", async () => {
    const seller = await makeUser();
    const pet = await makePet(seller.id);
    await makeListing(seller.id, pet.id, { status: "DRAFT" });

    const results = await searchListings({});
    expect(results.total).toBe(0);
  });
});

describe("listing quality checks", () => {
  it("penalises contact details and urgency, rewards records and detail", () => {
    const bad = deterministicListingFeedback({
      title: "URGENT puppy must go",
      description: "Call me on 0100 123 4567 quick sale today only",
      photoCount: 1,
      hasHealthRecords: false,
      priceCents: 50_000,
      intent: "SALE",
    });

    const good = deterministicListingFeedback({
      title: "Labrador puppy from health-tested parents",
      description:
        "Maple is good with children and our cat, is crate trained and sleeps through the night. She has had her first vaccinations, is microchipped and has been wormed to date. I am rehoming her because our circumstances changed, and I would like her to go to a home with time for training. ".repeat(
          2,
        ),
      photoCount: 5,
      hasHealthRecords: true,
      priceCents: 95_000,
      intent: "SALE",
    });

    expect(good.score).toBeGreaterThan(bad.score);
    expect(bad.improvements.some((i) => /contact details/i.test(i.issue))).toBe(true);
    expect(good.strengths.length).toBeGreaterThan(1);
  });
});

describe("geography and formatting", () => {
  it("measures distance and builds a usable bounding box", () => {
    // Cairo to Alexandria is roughly 180 km.
    const distance = haversineKm(30.0444, 31.2357, 31.2001, 29.9187);
    expect(distance).toBeGreaterThan(150);
    expect(distance).toBeLessThan(230);

    const box = boundingBox(30.0444, 31.2357, 50);
    expect(box.minLat).toBeLessThan(30.0444);
    expect(box.maxLat).toBeGreaterThan(30.0444);
    // A point inside the radius must be inside the box.
    expect(30.3).toBeLessThan(box.maxLat);
  });

  it("formats ages the way people say them", () => {
    expect(formatAge(null)).toBe("Age unknown");
    expect(formatAge(addMonths(new Date(), -3))).toBe("3 months");
    expect(formatAge(addMonths(new Date(), -12))).toBe("1 year");
    expect(formatAge(addMonths(new Date(), -30))).toBe("2y 6m");
    expect(ageInMonths(addMonths(new Date(), -18))).toBe(18);
  });

  it("produces safe slugs", () => {
    expect(slugify("Golden Retriever Puppy!")).toBe("golden-retriever-puppy");
    expect(slugify("Münchener Schäferhund")).toBe("munchener-schaferhund");
    expect(slugify("   ")).toBe("item");
    expect(slugify("../../etc/passwd")).toBe("etc-passwd");
  });
});
