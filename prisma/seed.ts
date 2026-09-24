import { config } from "dotenv";
config();

import { PrismaClient } from "@prisma/client";
import { BREEDS, VACCINES, CATEGORIES, PLANS } from "./seed-data";
import { slugify, generatePassportNumber, readableCode, addDays, addMonths } from "../src/lib/utils";
import { hashPassword } from "../src/lib/auth/password";
import { buildSearchText } from "../src/lib/search/text";
import { DEFAULT_SETTINGS, SETTING_DESCRIPTIONS, settingCategory } from "../src/lib/settings";
import { recomputeHealthScore } from "../src/lib/services/health.service";
import { awardTrustSignal } from "../src/lib/services/trust.service";
import type { TrustSignalKind } from "../src/lib/constants";

const db = new PrismaClient();

/**
 * Seeding.
 *
 * Two distinct phases:
 *
 *   1. Reference data — breeds, vaccines, categories, plans, settings. This is
 *      product data and is seeded in every environment, idempotently.
 *   2. Demo data — accounts, pets, listings, clinics. Only runs with
 *      SEED_DEMO_DATA=true, and every generated account is obviously fake
 *      (@demo.petmate.invalid) so it can never be mistaken for a real user.
 */

async function seedReferenceData() {
  console.log("Seeding reference data...");

  for (const breed of BREEDS) {
    const slug = slugify(`${breed.species}-${breed.name}`);
    await db.breed.upsert({
      where: { species_name: { species: breed.species, name: breed.name } },
      create: {
        species: breed.species,
        name: breed.name,
        slug,
        sizeClass: breed.sizeClass ?? null,
        avgWeightKgMin: breed.avgWeightKgMin ?? null,
        avgWeightKgMax: breed.avgWeightKgMax ?? null,
        lifespanMinY: breed.lifespanMinY ?? null,
        lifespanMaxY: breed.lifespanMaxY ?? null,
        temperament: breed.temperament ?? null,
        description: breed.description ?? null,
        careLevel: breed.careLevel ?? null,
        hypoallergenic: breed.hypoallergenic ?? false,
        originCountry: breed.originCountry ?? null,
        popularity: breed.popularity ?? 0,
      },
      update: {
        sizeClass: breed.sizeClass ?? null,
        temperament: breed.temperament ?? null,
        description: breed.description ?? null,
        popularity: breed.popularity ?? 0,
      },
    });
  }
  console.log(`  ${BREEDS.length} breeds`);

  for (const vaccine of VACCINES) {
    await db.vaccineCatalog.upsert({
      where: { species_code: { species: vaccine.species, code: vaccine.code } },
      create: vaccine,
      update: { name: vaccine.name, description: vaccine.description },
    });
  }
  console.log(`  ${VACCINES.length} vaccines`);

  let categoryCount = 0;
  for (const [index, category] of CATEGORIES.entries()) {
    const parent = await db.category.upsert({
      where: { slug: category.slug },
      create: {
        name: category.name,
        slug: category.slug,
        icon: category.icon,
        species: category.species ?? null,
        position: index,
      },
      update: { name: category.name, icon: category.icon, position: index },
      select: { id: true },
    });
    categoryCount++;

    for (const [childIndex, child] of (category.children ?? []).entries()) {
      await db.category.upsert({
        where: { slug: child.slug },
        create: { name: child.name, slug: child.slug, parentId: parent.id, position: childIndex },
        update: { name: child.name, parentId: parent.id, position: childIndex },
      });
      categoryCount++;
    }
  }
  console.log(`  ${categoryCount} categories`);

  for (const plan of PLANS) {
    await db.plan.upsert({
      where: { code: plan.code },
      create: {
        code: plan.code,
        name: plan.name,
        tagline: plan.tagline,
        audience: plan.audience,
        priceMonthlyCents: plan.priceMonthlyCents,
        priceYearlyCents: plan.priceYearlyCents,
        features: JSON.stringify(plan.features),
        limits: JSON.stringify(plan.limits),
        position: plan.position,
      },
      update: {
        name: plan.name,
        tagline: plan.tagline,
        priceMonthlyCents: plan.priceMonthlyCents,
        priceYearlyCents: plan.priceYearlyCents,
        features: JSON.stringify(plan.features),
        limits: JSON.stringify(plan.limits),
      },
    });
  }
  console.log(`  ${PLANS.length} plans`);

  // Settings are written explicitly so the admin console shows every knob with
  // its description, rather than an empty table until someone changes one.
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.platformSetting.upsert({
      where: { key },
      create: {
        key,
        value: JSON.stringify(value),
        description: SETTING_DESCRIPTIONS[key as keyof typeof SETTING_DESCRIPTIONS],
        category: settingCategory(key as keyof typeof DEFAULT_SETTINGS),
      },
      update: {},
    });
  }
  console.log(`  ${Object.keys(DEFAULT_SETTINGS).length} platform settings`);
}

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

const DEMO_DOMAIN = "demo.petmate.invalid";
const DEMO_PASSWORD = "DemoPassword123!";

const CITIES = [
  { city: "Cairo", region: "Cairo Governorate", country: "Egypt", lat: 30.0444, lng: 31.2357 },
  { city: "Giza", region: "Giza Governorate", country: "Egypt", lat: 30.0131, lng: 31.2089 },
  { city: "Alexandria", region: "Alexandria Governorate", country: "Egypt", lat: 31.2001, lng: 29.9187 },
  { city: "Dubai", region: "Dubai", country: "United Arab Emirates", lat: 25.2048, lng: 55.2708 },
  { city: "London", region: "England", country: "United Kingdom", lat: 51.5074, lng: -0.1278 },
  { city: "Manchester", region: "England", country: "United Kingdom", lat: 53.4808, lng: -2.2426 },
];

const PHOTOS: Record<string, string[]> = {
  DOG: [
    "https://images.unsplash.com/photo-1543466835-00a7907e9de1?w=900&q=80",
    "https://images.unsplash.com/photo-1552053831-71594a27632d?w=900&q=80",
    "https://images.unsplash.com/photo-1583512603805-3cc6b41f3edb?w=900&q=80",
    "https://images.unsplash.com/photo-1561037404-61cd46aa615b?w=900&q=80",
  ],
  CAT: [
    "https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=900&q=80",
    "https://images.unsplash.com/photo-1533738363-b7f9aef128ce?w=900&q=80",
    "https://images.unsplash.com/photo-1495360010541-f48722b34f7d?w=900&q=80",
  ],
  RABBIT: ["https://images.unsplash.com/photo-1585110396000-c9ffd4e4b308?w=900&q=80"],
  BIRD: ["https://images.unsplash.com/photo-1452570053594-1b985d6ea890?w=900&q=80"],
  REPTILE: ["https://images.unsplash.com/photo-1504450874802-0ba2bcd9b5ae?w=900&q=80"],
  SMALL_MAMMAL: ["https://images.unsplash.com/photo-1425082661705-1834bfd09dca?w=900&q=80"],
  HORSE: ["https://images.unsplash.com/photo-1553284965-83fd3e82fa5a?w=900&q=80"],
};

function pick<T>(items: T[], index: number): T {
  return items[index % items.length]!;
}

async function seedDemoData() {
  console.log("\nSeeding demo data (SEED_DEMO_DATA=true)...");

  const existing = await db.user.findFirst({
    where: { emailNormalized: { endsWith: DEMO_DOMAIN } },
    select: { id: true },
  });
  if (existing) {
    console.log("  Demo data already present, skipping.");
    return;
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const breeds = await db.breed.findMany({ select: { id: true, name: true, species: true } });
  const vaccines = await db.vaccineCatalog.findMany({
    select: { id: true, species: true, code: true, coreVaccine: true },
  });

  async function createUser(params: {
    name: string;
    handle: string;
    roles: string[];
    cityIndex: number;
    bio?: string;
    /**
     * The signals that earned this account its score. The score itself is
     * never set directly — it is derived, exactly as it is in the live app,
     * so the trust breakdown on the profile actually adds up.
     */
    trustSignals?: TrustSignalKind[];
  }) {
    const place = pick(CITIES, params.cityIndex);
    const created = await db.user.create({
      data: {
        email: `${params.handle}@${DEMO_DOMAIN}`,
        emailNormalized: `${params.handle}@${DEMO_DOMAIN}`,
        emailVerifiedAt: new Date(),
        passwordHash,
        name: params.name,
        handle: params.handle,
        bio: params.bio ?? null,
        city: place.city,
        region: place.region,
        country: place.country,
        lat: place.lat,
        lng: place.lng,
        acceptedTermsAt: new Date(),
        onboardedAt: new Date(),
        createdAt: addDays(new Date(), -120),
        roles: { create: params.roles.map((role) => ({ role })) },
        notifPrefs: {
          create: ["MESSAGE", "LISTING", "ORDER", "PAYMENT", "APPOINTMENT", "BREEDING", "ADOPTION", "HEALTH", "DELIVERY", "SECURITY", "SYSTEM"].map(
            (category) => ({ category, inApp: true, email: true }),
          ),
        },
      },
      select: { id: true, name: true, handle: true, city: true, country: true, lat: true, lng: true },
    });

    for (const signal of params.trustSignals ?? ["EMAIL_VERIFIED", "ACCOUNT_AGE_90D"]) {
      await awardTrustSignal(created.id, signal, { reference: `seed:${created.id}` }, db);
    }

    return created;
  }

  await createUser({
    name: "Platform Admin",
    handle: "admin",
    roles: ["USER", "ADMIN", "SUPER_ADMIN"],
    cityIndex: 0,
    trustSignals: ["EMAIL_VERIFIED", "PHONE_VERIFIED", "ID_VERIFIED", "ADDRESS_VERIFIED", "PROFILE_COMPLETE", "ACCOUNT_AGE_90D"],
  });

  await createUser({
    name: "Sam Moderator",
    handle: "moderator",
    roles: ["USER", "MODERATOR"],
    cityIndex: 0,
    trustSignals: ["EMAIL_VERIFIED", "PHONE_VERIFIED", "ID_VERIFIED", "PROFILE_COMPLETE", "ACCOUNT_AGE_90D"],
  });

  const breeder = await createUser({
    name: "Amina Hassan",
    handle: "amina-kennels",
    roles: ["USER", "BREEDER"],
    cityIndex: 0,
    bio: "Small-scale Labrador and Golden Retriever breeder. Every litter is hip-scored and eye-tested, and I keep in touch with every family.",
    trustSignals: ["EMAIL_VERIFIED", "PHONE_VERIFIED", "ID_VERIFIED", "BREEDER_VERIFIED", "PROFILE_COMPLETE", "FIRST_PET_ADDED", "ACCOUNT_AGE_90D"],
  });

  const owner = await createUser({
    name: "Yusuf Rahman",
    handle: "yusuf",
    roles: ["USER"],
    cityIndex: 1,
    bio: "Two cats, one very opinionated parrot.",
    trustSignals: ["EMAIL_VERIFIED", "PHONE_VERIFIED", "PROFILE_COMPLETE", "FIRST_PET_ADDED", "ACCOUNT_AGE_90D"],
  });

  const rescuer = await createUser({
    name: "Second Chance Rescue",
    handle: "second-chance",
    roles: ["USER"],
    cityIndex: 2,
    bio: "Volunteer-run rescue. We home-check every adopter, and we would rather say no than get it wrong.",
    trustSignals: ["EMAIL_VERIFIED", "PHONE_VERIFIED", "ID_VERIFIED", "ADDRESS_VERIFIED", "PROFILE_COMPLETE", "FIRST_PET_ADDED", "ACCOUNT_AGE_90D"],
  });

  const vetOwner = await createUser({
    name: "Dr Leila Farouk",
    handle: "dr-leila",
    roles: ["USER", "VET", "CLINIC_ADMIN"],
    cityIndex: 0,
    bio: "Small animal medicine, 14 years. Special interest in preventive care.",
    trustSignals: ["EMAIL_VERIFIED", "PHONE_VERIFIED", "ID_VERIFIED", "CLINIC_VERIFIED", "PROFILE_COMPLETE", "ACCOUNT_AGE_90D"],
  });

  const shopOwner = await createUser({
    name: "PawSupply",
    handle: "pawsupply",
    roles: ["USER", "SELLER"],
    cityIndex: 3,
    bio: "Independent pet supply shop. Free delivery over 50.",
    trustSignals: ["EMAIL_VERIFIED", "PHONE_VERIFIED", "ID_VERIFIED", "PROFILE_COMPLETE", "ACCOUNT_AGE_90D"],
  });

  const buyer = await createUser({
    name: "Nour Adel",
    handle: "nour",
    roles: ["USER"],
    cityIndex: 0,
    bio: "Looking for a calm dog for a flat with a small garden.",
    trustSignals: ["EMAIL_VERIFIED", "PROFILE_COMPLETE"],
  });

  console.log("  8 demo accounts");

  // ---- Pets and listings --------------------------------------------------
  const petSpecs: {
    ownerId: string;
    ownerCity: { city: string | null; country: string | null; lat: number | null; lng: number | null };
    species: string;
    breedName: string;
    sex: "MALE" | "FEMALE";
    ageMonths: number;
    name: string;
    temperament: string;
    intent?: "SALE" | "ADOPTION" | "BREEDING";
    priceCents?: number;
    description?: string;
  }[] = [
    { ownerId: breeder.id, ownerCity: breeder, species: "DOG", breedName: "Labrador Retriever", sex: "FEMALE", ageMonths: 4, name: "Maple", temperament: "Playful,Gentle,Good with kids", intent: "SALE", priceCents: 95000, description: "Maple is from our spring litter, out of a hip-scored dam and a sire with a clear eye certificate. She has been raised in the house with two children and a cat, is used to the vacuum, the doorbell and being handled all over. Toilet training is well underway and she sleeps through the night in her crate. She comes with her first two vaccinations, microchip, a four-week insurance policy and lifetime breeder support. I ask every buyer to visit at least once before deciding, and I will always take a dog back if circumstances change." },
    { ownerId: breeder.id, ownerCity: breeder, species: "DOG", breedName: "Golden Retriever", sex: "MALE", ageMonths: 5, name: "Basil", temperament: "Affectionate,Energetic,Good with other pets", intent: "SALE", priceCents: 110000, description: "Basil is a confident, sociable pup who has met everything from wheelie bins to horses. Both parents are health-tested and live with us. He has been clicker-introduced and will sit for his food. He needs an active family who will take training seriously, not a household that wants an ornament. First vaccinations done, microchipped, wormed to date, and I will meet you at the vet for the second set if you would find that reassuring." },
    { ownerId: rescuer.id, ownerCity: rescuer, species: "DOG", breedName: "Mixed Breed", sex: "FEMALE", ageMonths: 36, name: "Willow", temperament: "Calm,Shy,Quiet", intent: "ADOPTION", description: "Willow came to us from a hoarding case and has taken nine months to become the dog she is now. She is soft, quiet and deeply bonded to the one person she trusts. She needs an adult-only home with no other dogs, a secure garden, and someone who is home most of the day. She will not be the dog who greets your visitors. She will be the dog who lies against your leg every evening for the next ten years. Adoption fee covers spay, vaccinations, microchip and dental work." },
    { ownerId: rescuer.id, ownerCity: rescuer, species: "CAT", breedName: "Domestic Shorthair", sex: "MALE", ageMonths: 18, name: "Pepper", temperament: "Playful,Curious,Good with other pets", intent: "ADOPTION", description: "Pepper was found in a car park at about six weeks old and has never met a stranger he did not like. He is neutered, vaccinated, FIV/FeLV negative and litter trained. He would be happiest with another young cat or a confident older one, and he must have access to a garden or a catio because he is relentlessly nosy. He is not suitable for a household that wants a lap cat; he wants to be involved in everything you do from a distance of about a metre." },
    { ownerId: owner.id, ownerCity: owner, species: "CAT", breedName: "Maine Coon", sex: "FEMALE", ageMonths: 30, name: "Nova", temperament: "Gentle,Affectionate,Calm", intent: "BREEDING", description: "Nova is a registered Maine Coon with HCM-clear parents and her own echo done at two years. She has had one previous litter with no complications. I am looking for a stud with current HCM and SMA screening, papers, and an owner who wants to be involved rather than just collect a fee. Happy to travel within a few hours or to host. Terms to be agreed properly in writing before anything is arranged." },
    { ownerId: owner.id, ownerCity: owner, species: "BIRD", breedName: "African Grey Parrot", sex: "MALE", ageMonths: 84, name: "Ziggy", temperament: "Vocal,Curious,Independent" },
    { ownerId: buyer.id, ownerCity: buyer, species: "RABBIT", breedName: "Holland Lop", sex: "FEMALE", ageMonths: 14, name: "Hazel", temperament: "Gentle,Calm,Curious" },
    { ownerId: breeder.id, ownerCity: breeder, species: "DOG", breedName: "Labrador Retriever", sex: "MALE", ageMonths: 48, name: "Rocky", temperament: "Calm,Trained,Gentle", intent: "BREEDING", description: "Rocky is our stud dog: hip score 4/3, elbows 0, eyes clear, DNA panel clear for PRA, EIC and CNM. He is a steady, unbothered dog who lives in the house and is good with puppies, children and other males. I am selective about bitches and will want to see health testing and meet the owner. Fee negotiable for the right match, and I am open to a pick-of-litter arrangement." },
  ];

  const createdPets: { id: string; name: string; species: string; ownerId: string }[] = [];

  for (const [index, spec] of petSpecs.entries()) {
    const breed = breeds.find((b) => b.name === spec.breedName && b.species === spec.species);
    const birthDate = addMonths(new Date(), -spec.ageMonths);
    const photos = PHOTOS[spec.species] ?? PHOTOS.DOG!;

    const pet = await db.pet.create({
      data: {
        ownerId: spec.ownerId,
        name: spec.name,
        species: spec.species,
        breedId: breed?.id ?? null,
        sex: spec.sex,
        birthDate,
        isNeutered: spec.intent === "BREEDING" ? false : spec.ageMonths > 12,
        temperament: spec.temperament,
        passportNo: generatePassportNumber(),
        verificationLevel: index < 3 ? "CLINIC_VERIFIED" : "OWNER_CLAIMED",
        verifiedAt: index < 3 ? new Date() : null,
        city: spec.ownerCity.city,
        country: spec.ownerCity.country,
        lat: spec.ownerCity.lat,
        lng: spec.ownerCity.lng,
        availability:
          spec.intent === "SALE"
            ? "FOR_SALE"
            : spec.intent === "ADOPTION"
              ? "FOR_ADOPTION"
              : spec.intent === "BREEDING"
                ? "FOR_BREEDING"
                : "NOT_AVAILABLE",
        status: spec.intent ? "LISTED" : "ACTIVE",
        photos: {
          create: photos.slice(0, 3).map((url, i) => ({
            url,
            alt: `${spec.name}, a ${spec.breedName}`,
            position: i,
            isPrimary: i === 0,
            width: 900,
            height: 600,
          })),
        },
      },
      select: { id: true, name: true, species: true, ownerId: true },
    });
    createdPets.push(pet);

    // Health records — clinic-sourced for the verified pets, so the difference
    // between verified and self-reported is visible in the demo.
    const vaccine = vaccines.find((v) => v.species === spec.species && v.code === "RABIES");
    const core = vaccines.find((v) => v.species === spec.species && v.coreVaccine !== false);

    const records = [
      core && {
        petId: pet.id,
        type: "VACCINATION",
        title: `Core vaccination (${core.code})`,
        occurredAt: addMonths(birthDate, 2),
        nextDueAt: addMonths(addMonths(birthDate, 2), 12),
        vaccineId: core.id,
        createdById: spec.ownerId,
        source: index < 3 ? "CLINIC" : "OWNER",
        verifiedAt: index < 3 ? new Date() : null,
      },
      spec.ageMonths > 6 && vaccine
        ? {
            petId: pet.id,
            type: "VACCINATION",
            title: "Rabies",
            occurredAt: addMonths(birthDate, 4),
            nextDueAt: addMonths(addMonths(birthDate, 4), 12),
            vaccineId: vaccine.id,
            createdById: spec.ownerId,
            source: index < 3 ? "CLINIC" : "OWNER",
            verifiedAt: index < 3 ? new Date() : null,
          }
        : null,
      {
        petId: pet.id,
        type: "CHECKUP",
        title: "Annual health check",
        description: "Weight, teeth, ears and heart all unremarkable.",
        occurredAt: addDays(new Date(), -60),
        createdById: spec.ownerId,
        source: index < 3 ? "CLINIC" : "OWNER",
        verifiedAt: index < 3 ? new Date() : null,
      },
    ].filter(Boolean) as Parameters<typeof db.healthRecord.create>[0]["data"][];

    for (const record of records) {
      await db.healthRecord.create({ data: record });
    }

    // The health score is derived, not stored by hand — run the same function
    // the app uses so seeded pets look exactly like real ones.
    await recomputeHealthScore(pet.id, db);

    // Listing
    if (spec.intent) {
      const title =
        spec.intent === "SALE"
          ? `${spec.name} — ${spec.breedName} ${spec.sex === "FEMALE" ? "girl" : "boy"}, ready now`
          : spec.intent === "ADOPTION"
            ? `${spec.name} is looking for a quiet home`
            : `${spec.name} — ${spec.breedName} available at stud`;

      await db.listing.create({
        data: {
          petId: pet.id,
          sellerId: spec.ownerId,
          intent: spec.intent,
          title,
          slug: `${slugify(title, 50)}-${readableCode(6).toLowerCase()}`,
          description: spec.description ?? "",
          priceCents: spec.intent === "SALE" ? (spec.priceCents ?? 0) : 0,
          adoptionFeeCents: spec.intent === "ADOPTION" ? 15000 : 0,
          studFeeCents: spec.intent === "BREEDING" ? 60000 : 0,
          status: "ACTIVE",
          moderationStatus: "APPROVED",
          publishedAt: addDays(new Date(), -Math.floor(Math.random() * 20)),
          expiresAt: addDays(new Date(), 45),
          city: spec.ownerCity.city,
          country: spec.ownerCity.country,
          lat: spec.ownerCity.lat,
          lng: spec.ownerCity.lng,
          viewCount: 40 + Math.floor(Math.random() * 400),
          favoriteCount: Math.floor(Math.random() * 25),
          searchText: buildSearchText(
            title,
            spec.description,
            spec.name,
            spec.species,
            spec.breedName,
            spec.ownerCity.city,
            spec.ownerCity.country,
          ),
          ...(spec.intent === "ADOPTION"
            ? {
                questions: {
                  create: [
                    { prompt: "Who else lives in your home, and how do they feel about a dog?", required: true, position: 0 },
                    { prompt: "Describe a normal weekday from the animal's point of view.", required: true, position: 1 },
                    { prompt: "What would make you return an animal to us?", required: false, position: 2 },
                  ],
                },
              }
            : {}),
        },
      });
    }

    // Breeding profile
    if (spec.intent === "BREEDING") {
      await db.breedingProfile.create({
        data: {
          petId: pet.id,
          ownerId: spec.ownerId,
          status: "ACTIVE",
          goals: "PEDIGREE",
          studFeeCents: 60000,
          feeType: spec.sex === "MALE" ? "FEE" : "PICK_OF_LITTER",
          willingToTravelKm: 150,
          requiresHealthTests: true,
          requiresVaccination: true,
          requiresPedigree: true,
          temperamentTags: spec.temperament,
          notes: "Health testing is non-negotiable. Happy to share full records before anything is agreed.",
        },
      });
    }
  }
  console.log(`  ${createdPets.length} pets with health records and listings`);

  // ---- Clinic -------------------------------------------------------------
  const clinic = await db.clinic.create({
    data: {
      ownerUserId: vetOwner.id,
      name: "Nile Veterinary Centre",
      slug: "nile-veterinary-centre",
      description:
        "A small animal practice in Zamalek offering consultations, vaccinations, dental work and soft tissue surgery. We run an in-house laboratory and digital radiography, and we are open seven days.",
      email: `clinic@${DEMO_DOMAIN}`,
      phone: "+20221234567",
      addressLine: "14 Brazil Street, Zamalek",
      city: "Cairo",
      region: "Cairo Governorate",
      country: "Egypt",
      lat: 30.0626,
      lng: 31.2197,
      status: "ACTIVE",
      verifiedAt: new Date(),
      licenseNumber: "EG-VET-2019-4412",
      emergencyServices: true,
      homeVisits: false,
      acceptsWalkIns: true,
      ratingAvgBps: 470,
      ratingCount: 38,
      bookingCount: 214,
      searchText: buildSearchText(
        "Nile Veterinary Centre",
        "small animal practice consultations vaccinations dental surgery",
        "Cairo",
        "Egypt",
      ),
      members: { create: { userId: vetOwner.id, role: "OWNER" } },
      hours: {
        create: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          startMinute: weekday === 5 ? 10 * 60 : 9 * 60,
          endMinute: weekday === 5 ? 14 * 60 : 18 * 60,
          slotMinutes: 30,
        })),
      },
    },
    select: { id: true },
  });

  await db.vet.create({
    data: {
      userId: vetOwner.id,
      clinicId: clinic.id,
      licenseNumber: "EG-VET-2019-4412",
      licenseVerifiedAt: new Date(),
      specialties: "Internal medicine,Preventive care,Dentistry",
      bio: "Graduated Cairo University 2010. Particular interest in getting owners to preventive care before it becomes emergency care.",
      yearsExperience: 14,
      ratingAvgBps: 480,
      ratingCount: 26,
    },
    select: { id: true },
  });

  const services = [
    { name: "General consultation", category: "CONSULTATION", durationMinutes: 30, priceCents: 25000, description: "A full physical examination with time to actually talk through what you are seeing at home." },
    { name: "Vaccination appointment", category: "VACCINATION", durationMinutes: 20, priceCents: 18000, description: "Core or booster vaccination, recorded straight into your pet's PetMate health timeline." },
    { name: "Dental scale and polish", category: "DENTAL", durationMinutes: 90, priceCents: 120000, description: "Under general anaesthetic, with pre-anaesthetic bloods included." },
    { name: "Neutering (cat)", category: "SURGERY", durationMinutes: 60, priceCents: 90000, description: "Includes pain relief, post-operative check and a collar." },
    { name: "Annual wellness screen", category: "WELLNESS", durationMinutes: 45, priceCents: 45000, description: "Examination, bloods and urinalysis. Recommended yearly from seven years old." },
    { name: "Emergency assessment", category: "EMERGENCY", durationMinutes: 30, priceCents: 60000, description: "Same-day triage and stabilisation." },
  ];

  for (const [index, service] of services.entries()) {
    await db.service.create({
      data: { ...service, clinicId: clinic.id, position: index, currency: "USD" },
    });
  }
  console.log("  1 verified clinic with 6 services");

  // ---- Shop and products --------------------------------------------------
  const shop = await db.shop.create({
    data: {
      ownerUserId: shopOwner.id,
      name: "PawSupply",
      slug: "pawsupply",
      description: "Independent pet supply shop. We stock what we would feed our own animals, and nothing else.",
      email: `shop@${DEMO_DOMAIN}`,
      country: "United Arab Emirates",
      city: "Dubai",
      status: "ACTIVE",
      verifiedAt: new Date(),
      flatShippingCents: 599,
      freeShippingThresholdCents: 5000,
      ratingAvgBps: 460,
      ratingCount: 112,
      orderCount: 340,
      searchText: buildSearchText("PawSupply", "independent pet supply shop Dubai"),
    },
    select: { id: true },
  });

  const categories = await db.category.findMany({ select: { id: true, slug: true } });
  const categoryBySlug = new Map(categories.map((c) => [c.slug, c.id]));

  const products = [
    { title: "Grain-free adult dog food, 12kg", slug: "grain-free-adult-dog-food-12kg", category: "dry-food", priceCents: 6499, compareAtCents: 7499, stock: 42, brand: "Northfield", description: "Single-protein salmon recipe with no wheat, corn or soy. Suitable for adult dogs of all sizes, including those with grain sensitivities. Contains glucosamine and chondroitin for joint support, and omega oils for coat condition. Feeding guide on the pack; transition over seven days when switching.", image: "https://images.unsplash.com/photo-1589924691995-400dc9ecc119?w=800&q=80" },
    { title: "Stainless steel slow feeder bowl", slug: "stainless-steel-slow-feeder-bowl", category: "beds-mats", priceCents: 1899, stock: 88, brand: "Northfield", description: "A raised maze insert that turns a thirty-second meal into a five-minute one, which helps with bloat risk in deep-chested dogs and with cats who eat too fast and bring it straight back up. Dishwasher safe, non-slip base.", image: "https://images.unsplash.com/photo-1601758124510-52d02ddb7cbd?w=800&q=80" },
    { title: "Spot-on flea and tick treatment, 6 pack", slug: "spot-on-flea-tick-6-pack", category: "flea-tick", priceCents: 3299, stock: 120, brand: "Vetline", description: "Six monthly pipettes for dogs 10-25kg. Kills fleas within 24 hours and ticks within 48, and breaks the flea life cycle by preventing egg development. Read the weight band carefully before buying, and never use a dog product on a cat.", image: "https://images.unsplash.com/photo-1607923432780-7a2d0c9d1e4f?w=800&q=80" },
    { title: "Orthopaedic memory foam dog bed, large", slug: "orthopaedic-memory-foam-dog-bed-large", category: "beds-mats", priceCents: 8999, compareAtCents: 10999, stock: 17, brand: "Restwell", description: "10cm of high-density memory foam with a bolstered edge, sized for dogs up to 40kg. Genuinely worth it for older dogs and for any breed prone to hip or elbow problems. Removable, machine-washable cover with a waterproof inner liner.", image: "https://images.unsplash.com/photo-1583337130417-3346a1be7dee?w=800&q=80" },
    { title: "Interactive treat puzzle, level 2", slug: "interactive-treat-puzzle-level-2", category: "puzzle-feeders", priceCents: 2499, stock: 64, brand: "Braintoy", description: "Sliding compartments and removable pegs that take most dogs ten to fifteen minutes to work through. Real mental work, which tires a dog more reliably than another walk. Not a chew toy — supervise, and put it away afterwards.", image: "https://images.unsplash.com/photo-1601758174114-e711c0cbaa69?w=800&q=80" },
    { title: "Clumping cat litter, 10L", slug: "clumping-cat-litter-10l", category: "litter-trays", priceCents: 1599, stock: 200, brand: "Northfield", description: "Fine-grain bentonite that clumps hard and scoops clean, with no added fragrance. Low dust, which matters for cats with any respiratory history and for you.", image: "https://images.unsplash.com/photo-1606214174585-fe31582dc6ee?w=800&q=80" },
    { title: "Adjustable no-pull harness", slug: "adjustable-no-pull-harness", category: "leads-harnesses", priceCents: 3499, stock: 55, brand: "Trailmate", description: "Front and back attachment points with five adjustment points for a genuine fit. The front clip redirects a pulling dog rather than punishing them, which makes loose-lead training far easier. Padded chest plate, reflective stitching.", image: "https://images.unsplash.com/photo-1601758003122-53c40e686a19?w=800&q=80" },
    { title: "Dental chews, 28 pack", slug: "dental-chews-28-pack", category: "dental-care", priceCents: 1999, stock: 150, brand: "Vetline", description: "Textured chews shown to reduce plaque accumulation when given daily. Not a substitute for brushing or for a scale and polish when one is needed, but a realistic addition for dogs who will not tolerate a toothbrush.", image: "https://images.unsplash.com/photo-1585846888147-3fe14c130048?w=800&q=80" },
  ];

  for (const product of products) {
    await db.product.create({
      data: {
        shopId: shop.id,
        categoryId: categoryBySlug.get(product.category) ?? null,
        title: product.title,
        slug: product.slug,
        description: product.description,
        brand: product.brand,
        priceCents: product.priceCents,
        compareAtCents: product.compareAtCents ?? null,
        stock: product.stock,
        status: "ACTIVE",
        publishedAt: addDays(new Date(), -30),
        soldCount: Math.floor(Math.random() * 80),
        viewCount: 100 + Math.floor(Math.random() * 900),
        ratingAvgBps: 400 + Math.floor(Math.random() * 100),
        ratingCount: Math.floor(Math.random() * 40),
        searchText: buildSearchText(product.title, product.description, product.brand),
        images: { create: [{ url: product.image, alt: product.title, position: 0 }] },
        variants: {
          create: { name: "Default", priceCents: product.priceCents, stock: product.stock, isDefault: true },
        },
      },
    });
  }
  console.log(`  1 shop with ${products.length} products`);

  // ---- Community ----------------------------------------------------------
  const group = await db.group.create({
    data: {
      name: "New puppy owners",
      slug: "new-puppy-owners",
      description: "The first six months, honestly. Sleep, biting, toilet training and everything nobody warned you about.",
      species: "DOG",
      ownerId: breeder.id,
      memberCount: 3,
      postCount: 2,
      rules: "Be useful or be quiet. No breeder advertising. If a question needs a vet, say so.",
      members: {
        create: [
          { userId: breeder.id, role: "OWNER" },
          { userId: owner.id, role: "MEMBER" },
          { userId: buyer.id, role: "MEMBER" },
        ],
      },
    },
    select: { id: true },
  });

  await db.post.create({
    data: {
      groupId: group.id,
      authorId: breeder.id,
      type: "DISCUSSION",
      title: "The two-week shutdown, and why it works",
      body: "Almost every problem I hear about in the first month comes from doing too much too soon. A new puppy or a rescue dog does not need to meet your friends, go to the park or visit a cafe in week one. Give them two weeks of nothing: the house, the garden, you, and a predictable routine. No visitors, no other dogs, no car trips beyond the vet. It feels like you are wasting time. What you are actually doing is letting the animal work out that this place is safe and that you are the person who makes good things happen. Everything you teach afterwards lands better.",
      likeCount: 12,
      commentCount: 1,
    },
  });

  console.log("  1 community group with a post");

  console.log("\nDemo accounts (password for all: " + DEMO_PASSWORD + "):");
  console.log(`  admin@${DEMO_DOMAIN}           super admin`);
  console.log(`  moderator@${DEMO_DOMAIN}       moderator`);
  console.log(`  amina-kennels@${DEMO_DOMAIN}   breeder with listings`);
  console.log(`  second-chance@${DEMO_DOMAIN}   rescue with adoption listings`);
  console.log(`  dr-leila@${DEMO_DOMAIN}        clinic owner and vet`);
  console.log(`  pawsupply@${DEMO_DOMAIN}       shop owner`);
  console.log(`  yusuf@${DEMO_DOMAIN}           pet owner`);
  console.log(`  nour@${DEMO_DOMAIN}            buyer`);
}

async function main() {
  await seedReferenceData();

  if (process.env.SEED_DEMO_DATA === "true") {
    await seedDemoData();
  } else {
    console.log("\nSkipping demo data. Set SEED_DEMO_DATA=true to create demo accounts.");
  }

  console.log("\nSeed complete.");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
