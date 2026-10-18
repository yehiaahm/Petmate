import { normalizeSearchText } from "@/lib/search/text";

/**
 * The care assistant when no AI provider is configured.
 *
 * This is a rules engine, and the UI says so on every reply. It is deliberately
 * conservative: it triages urgency first, never gives doses or home treatment
 * for anything that could be serious, and otherwise answers the questions owners
 * ask most with widely accepted general guidance. Anything outside that it says
 * it cannot answer, rather than guessing.
 */

export type PetSpecies = "DOG" | "CAT" | "BIRD" | "RABBIT" | "REPTILE" | "SMALL_MAMMAL" | "HORSE" | "OTHER";

export interface CareFacts {
  petName?: string;
  species?: PetSpecies;
  ageMonths?: number | null;
  /** Titles of health records whose next-due date has passed. */
  overdue?: string[];
}

export interface CareAnswer {
  answer: string;
  links: { label: string; href: string }[];
  /** True when the reply tells the owner to get a vet now. The UI highlights it. */
  urgent?: boolean;
}

const EMERGENCY_LINK = { label: "Find an emergency clinic", href: "/clinics?emergency=true" };
const FIND_VET = { label: "Find a vet", href: "/clinics" };
const RECORDS = { label: "Open pet health records", href: "/dashboard/pets" };

// Matched against the normalised question (lowercase, Arabic variants folded).
const EMERGENCY: { test: RegExp; what: string }[] = [
  { test: /(not|cant|cannot|difficulty|trouble|struggling to|hard to) breath|breathing (hard|fast|heavy)|gasping|blue (gums|tongue)|صعوبه في التنفس|لا يتنفس|ازرق/, what: "trouble breathing" },
  { test: /seizure|convuls|fitting|shaking uncontroll|تشنج|نوبه صرع|صرع/, what: "a seizure" },
  { test: /collaps|unconscious|unresponsive|wont wake|cant stand|cannot stand|paraly|اغماء|فاقد الوعي|لا يستطيع الوقوف|شلل/, what: "collapse or loss of consciousness" },
  { test: /poison|toxic|antifreeze|rat (bait|poison)|ate (chocolate|grapes|raisins|xylitol|lily|lilies|onion|garlic|medication|pills|ibuprofen|paracetamol|tylenol)|swallowed (a )?(pill|battery|coin|sock)|تسمم|اكل شوكولاته|اكل عنب|سم فئران/, what: "possible poisoning" },
  { test: /(heavy|severe|wont stop|won't stop|a lot of|lots of) bleed|bleeding (heavily|a lot|wont stop)|blood (everywhere|pouring)|نزيف شديد|ينزف كثير/, what: "heavy bleeding" },
  { test: /hit by (a )?(car|vehicle|truck|bike)|run over|fell (from|off)|fall from|دهس|صدمته سياره|سقط من/, what: "an accident or fall" },
  { test: /bloat|swollen (hard )?(belly|abdomen|stomach)|distended|retching (but|and) (nothing|unproductive)|انتفاخ البطن|بطن منتفخ/, what: "a swollen abdomen, which can be bloat" },
  { test: /chok|something stuck in (his|her|its|the) throat|gagging constantly|اختناق/, what: "choking" },
  { test: /heat ?stroke|overheat|collapsed in the heat|panting (and|with) (drool|collaps)|ضربه شمس/, what: "heatstroke" },
  { test: /(cant|cannot|unable to|straining to|not able to|trying to) (pee|urinate|wee)|straining (in|at) (the )?litter|no urine|blocked (bladder|urethra)|لا يستطيع التبول/, what: "being unable to urinate, which can be fatal within a day or two, especially in male cats" },
  { test: /pale gums|white gums|gums (are )?(white|grey|gray|blue)/, what: "pale or blue gums" },
  { test: /(labou?r|straining|pushing|whelping|queening).*(hour|no (puppy|kitten))|green discharge|stuck (puppy|kitten)/, what: "a difficult birth" },
  { test: /snake ?bite|bitten by (a )?snake|scorpion|لدغه ثعبان|لدغه عقرب/, what: "a snake or scorpion bite" },
  { test: /broken (leg|bone|back|jaw)|bone (sticking|showing)|dislocat|كسر/, what: "a possible fracture" },
  { test: /(eye|eyeball) (is )?(bulging|ruptured|popped|punctured|hanging)|chemical (in|on) (his|her|the) eye|scratched cornea/, what: "a serious eye injury" },
  { test: /vomit(ing)? blood|blood in (the )?vomit|bloody (diarrh|stool)|blood in (the )?(stool|poo)|تقيؤ دم|دم في البراز/, what: "blood in vomit or stool" },
  { test: /emergency|urgent|dying|critical|طوارئ|عاجل|يحتضر/, what: "an emergency" },
];

// Not necessarily an emergency, but not something to wait on.
const CONCERN: { test: RegExp; what: string }[] = [
  { test: /vomit|throwing up|threw up|puking|تقيؤ|تقيء|استفراغ|يتقيا|تتقيا|يرجع|ترجع/, what: "vomiting" },
  { test: /diarrh|loose (stool|poo)|runny (stool|poo)|اسهال/, what: "diarrhoea" },
  { test: /(not|isnt|isn't|wont|won't|stopped|refus\w*|off) (eating|his food|her food|food)|loss of appetite|no appetite|stopped eating|لا (ي|ت)اكل|مش (بياكل|بتاكل)|رفض الاكل|فقد الشهيه/, what: "not eating" },
  { test: /letharg|very (tired|weak|sleepy)|listless|weak|no energy|خامل|ضعيف|خمول/, what: "lethargy" },
  { test: /limp|favou?ring (a )?(leg|paw)|not putting weight|يعرج|عرج/, what: "limping" },
  { test: /cough|wheez|sneez|nasal discharge|runny nose|كحه|عطس/, what: "coughing or sneezing" },
  { test: /(eye|eyes) (discharge|goop|red|weeping|watering|squint)|rubbing (his|her) eye|عين (حمراء|تدمع)/, what: "an eye problem" },
  { test: /itch|scratching|hot ?spot|hair loss|bald patch|rash|fleas|ticks|mange|حكه|تساقط الشعر|براغيث/, what: "skin trouble" },
  { test: /drinking (a lot|more|too much)|very thirsty|peeing (a lot|more)|يشرب كثير/, what: "drinking or urinating much more than usual" },
  { test: /losing weight|weight loss|skinny|thin(ner)?|نزول الوزن|نحيف/, what: "weight loss" },
  { test: /(ear|ears) (smell|infection|discharge|scratch)|head ?shak/, what: "an ear problem" },
  { test: /lump|bump|swelling|swollen|growth|كتله|ورم/, what: "a lump or swelling" },
  { test: /constipat|straining to (poo|poop|defecate)|امساك/, what: "constipation" },
  { test: /limping|hiding|not (himself|herself)|behaviou?r (change|different)|aggress|يختبئ/, what: "a change in behaviour" },
];

const ASK_SPECIES: { test: RegExp; species: PetSpecies }[] = [
  { test: /\b(puppy|puppies|dog|dogs|pup|canine)\b|كلب|جرو/, species: "DOG" },
  { test: /\b(kitten|kittens|cat|cats|kitty|feline)\b|(^|\s)(قطه|قطتي|قطتنا|قط|قطط|هر)(\s|$)/, species: "CAT" },
  { test: /\b(bird|parrot|budgie|canary|cockatiel)\b|ببغاء|طائر|عصفور/, species: "BIRD" },
  { test: /\b(rabbit|bunny)\b|ارنب/, species: "RABBIT" },
  { test: /\b(horse|pony)\b|حصان/, species: "HORSE" },
  { test: /\b(hamster|guinea pig|ferret|rat|mouse)\b|هامستر/, species: "SMALL_MAMMAL" },
  { test: /\b(turtle|tortoise|lizard|snake|gecko|reptile)\b|سلحفاه/, species: "REPTILE" },
];

const SPECIES_NOUN: Record<PetSpecies, string> = {
  DOG: "dog",
  CAT: "cat",
  BIRD: "bird",
  RABBIT: "rabbit",
  REPTILE: "reptile",
  SMALL_MAMMAL: "small pet",
  HORSE: "horse",
  OTHER: "pet",
};

function detectSpecies(text: string, facts?: CareFacts): PetSpecies | undefined {
  const fromQuestion = ASK_SPECIES.find((s) => s.test.test(text))?.species;
  return fromQuestion ?? facts?.species;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function who(facts?: CareFacts, species?: PetSpecies): string {
  return facts?.petName ?? (species ? `your ${SPECIES_NOUN[species]}` : "your pet");
}

export function careRulesAnswer(question: string, facts?: CareFacts): CareAnswer {
  // Apostrophes are dropped, not spaced, so "can't" and "won't" become "cant" and "wont".
  const text = ` ${normalizeSearchText(question.replace(/['’]/g, ""))} `;
  const species = detectSpecies(text, facts);
  const name = who(facts, species);

  // 1. Urgent. Always first, never softened.
  const urgent = EMERGENCY.filter((e) => e.test.test(text)).map((e) => e.what);
  if (urgent.length) {
    return {
      urgent: true,
      answer:
        `This could be an emergency (${joinList([...new Set(urgent)])}). Do not wait for advice here: call or go to the nearest emergency vet now.\n\n` +
        "While you get there: stay calm, keep " + name + " warm and as still as you can, and do not give food, water, human medicine or home remedies unless a vet tells you to. " +
        "If you think they swallowed something, bring the packaging or a photo of it. Call ahead so the clinic can prepare.",
      links: [EMERGENCY_LINK, FIND_VET],
    };
  }

  // 2. Symptoms worth a vet visit. Several together raise the urgency.
  const concerns = CONCERN.filter((c) => c.test.test(text)).map((c) => c.what);
  if (concerns.length) {
    const several = concerns.length >= 2;
    const young = facts?.ageMonths != null && facts.ageMonths < 6;
    const senior = facts?.ageMonths != null && facts.ageMonths > 12 * 9;
    const vulnerable = young || senior || species === "BIRD" || species === "RABBIT" || species === "SMALL_MAMMAL";

    const when =
      several || vulnerable || concerns.includes("not eating")
        ? "Please book a vet today rather than waiting to see if it passes."
        : "If it has lasted more than a day, or it is getting worse, book a vet within the next day or two.";

    const extra: string[] = [];
    if (species === "CAT" && concerns.includes("not eating")) {
      extra.push("Cats that stop eating for more than a day can become seriously ill quickly, so do not wait it out.");
    }
    if (species === "RABBIT" && concerns.includes("not eating")) {
      extra.push("A rabbit that stops eating or producing droppings needs a vet the same day.");
    }
    if (young) extra.push("Young animals can get worse much faster than adults, which is why the advice is not to wait.");
    if (senior) extra.push("Older animals hide illness well, so a change like this deserves a proper check.");

    return {
      answer:
        `Thank you for the detail. ${name === "your pet" ? "A pet" : name[0]!.toUpperCase() + name.slice(1)} showing ${joinList(concerns)} should be checked by a vet, and I cannot examine them or tell you the cause. ${when}\n\n` +
        (extra.length ? extra.join(" ") + "\n\n" : "") +
        "Until then: keep fresh water available, do not give human medicine (many are toxic to pets), and note when it started, how often it happens, what they ate, and whether anything has changed at home. A photo or short video helps the vet a lot.\n\n" +
        "Go to an emergency vet immediately if you see repeated vomiting, blood, a swollen belly, pale gums, difficulty breathing, collapse, or you cannot get them to drink.",
      links: [{ label: "Book a vet", href: "/clinics" }, EMERGENCY_LINK, RECORDS],
    };
  }

  // 3. Everyday questions.
  if (/(sleep|sleeping|nap|tired all|asleep|ينام|نوم)/.test(text)) {
    const s = species ?? "DOG";
    const hours =
      s === "CAT"
        ? "Adult cats typically sleep 12 to 16 hours a day, kittens and seniors even more, so a lot of sleeping is usually normal."
        : s === "DOG"
          ? "Adult dogs typically sleep 12 to 14 hours a day, puppies 18 to 20 and seniors more, so a lot of sleeping is usually normal."
          : "Many pets sleep far more than people expect, and the amount varies a lot by species and age.";
    return {
      answer:
        `${hours}\n\nWhat matters is change. See a vet if ${name} suddenly sleeps much more than usual, seems hard to wake, stops eating or drinking, hides, or has lost interest in things they normally enjoy.`,
      links: [FIND_VET, RECORDS],
    };
  }

  if (/(vaccin|jab|shot|booster|immuni|تطعيم|لقاح)/.test(text)) {
    const core =
      species === "CAT"
        ? "Core vaccines for cats usually cover feline panleukopenia, herpesvirus and calicivirus, plus rabies where required."
        : species === "DOG"
          ? "Core vaccines for dogs usually cover distemper, parvovirus, adenovirus and rabies."
          : "Which vaccines are needed depends on the species, age and where you live.";
    const due =
      facts?.overdue && facts.overdue.length
        ? `${facts.petName ?? "Your pet"} has overdue items on the health record: ${joinList(facts.overdue)}. It is worth booking those soon.`
        : facts?.petName
          ? `Nothing is marked overdue on ${facts.petName}'s record right now, and the health timeline shows what is next.`
          : "Pick a pet above and I can point at what is due on their own record.";
    return {
      answer: `${core} Schedules vary with age and local risk, so your vet sets the exact dates.\n\n${due}\n\nBookings made through PetMate are written onto the health record automatically as clinic-verified entries.`,
      links: [RECORDS, { label: "Book a vaccination", href: "/clinics?category=VACCINATION" }],
    };
  }

  if (/(eat|eating|feed|feeding|food|diet|portion|meals|how much|اكل|طعام|وجبه|كم)/.test(text) && /(how much|how often|how many|portion|meals|amount|what should|schedule|كم|وجبات)/.test(text)) {
    const young = text.includes("puppy") || text.includes("kitten") || (facts?.ageMonths != null && facts.ageMonths < 12);
    const base = young
      ? "Young animals eat smaller meals more often, commonly three to four a day until around four to six months, then fewer. Use a food made for their life stage."
      : "Most adult dogs and cats do well on two meals a day with a complete food made for their life stage.";
    return {
      answer:
        `${base}\n\nThe right amount depends on weight, activity and the food itself, so start from the feeding guide on the pack, then adjust to keep ${name} lean: you should be able to feel the ribs without seeing them. Weigh them regularly and change the amount slowly. Your vet can give an exact target for ${name}.`,
      links: [RECORDS, FIND_VET, { label: "Browse pet food", href: "/store" }],
    };
  }

  if (/(neuter|spay|castrat|sterili|تعقيم|خصي)/.test(text)) {
    return {
      answer:
        "The best age to neuter or spay depends on species, breed, size and health, and recommendations differ, so it is a conversation with your vet. For many cats and small dogs it is commonly done from around five to six months; larger dogs are often advised to wait longer. It also affects heat cycles, roaming and some health risks.",
      links: [{ label: "Book a consultation", href: "/clinics?category=CONSULTATION" }, FIND_VET],
    };
  }

  if (/(flea|tick|worm|deworm|parasite|برغوث|قراد|ديدان)/.test(text)) {
    return {
      answer:
        "Regular flea, tick and worm prevention is part of routine care for dogs and cats. The right product and schedule depend on species, weight, age and what is common where you live, and some dog products are dangerous to cats, so ask your vet which one to use rather than choosing from the shelf.",
      links: [{ label: "Book a consultation", href: "/clinics?category=CONSULTATION" }, { label: "Browse treatments", href: "/store" }],
    };
  }

  if (/(chew|teeth|teething|bite|biting|bark|barking|train|training|potty|house.?train|scratch(ing)? (the )?(furniture|sofa)|تدريب|ينبح|يعض)/.test(text)) {
    return {
      answer:
        "Most behaviour problems come from unmet needs, usually exercise, mental stimulation, or consistency. Reward the behaviour you want straight away, redirect the one you do not (a chew toy instead of a shoe, a scratching post instead of the sofa), and keep sessions short and positive. Puppies and kittens chew while teething, which settles at around six months. If it is sudden, intense or aggressive, a vet check comes first because pain is a common cause.",
      links: [FIND_VET, { label: "Behaviour and puzzle toys", href: "/store" }],
    };
  }

  if (/(litter|toilet|accident|pee(ing)? (inside|in the house)|house soiling|بيت الرمل|رمل القطط)/.test(text)) {
    return {
      answer:
        "Sudden toileting accidents are often medical (a urinary infection, for example), so a vet check is the right first step, especially for male cats. Meanwhile keep litter trays clean, one per cat plus one spare, in quiet places away from food, and avoid changing the litter type suddenly.",
      links: [FIND_VET, { label: "Litter and supplies", href: "/store" }],
    };
  }

  if (/(exercise|walk|walking|how long.*(play|walk)|activity|رياضه|مشي)/.test(text)) {
    return {
      answer:
        "Exercise needs vary a lot by breed, age and health. Many adult dogs need at least 30 to 60 minutes of activity a day split into walks and play, working and sporting breeds more, puppies shorter and more frequent sessions, and indoor cats benefit from daily play. In hot weather walk early or late and watch for heavy panting.",
      links: [RECORDS, { label: "Breed guides", href: "/breeds" }],
    };
  }

  if (/(bath|groom|brush|nail|trim|حمام|تنظيف)/.test(text)) {
    return {
      answer:
        "Brush regularly (daily for long coats, weekly for short), bathe only when needed with a shampoo made for pets, and trim nails when you hear them clicking on the floor. Do not shave double-coated breeds, because the coat helps regulate temperature. A groomer or your vet can show you the safe way to trim nails.",
      links: [{ label: "Grooming supplies", href: "/store" }, FIND_VET],
    };
  }

  if (/(dental|teeth clean|bad breath|tooth|اسنان)/.test(text)) {
    return {
      answer:
        "Most dogs and cats develop dental disease by middle age. Daily brushing with pet toothpaste is the best prevention, with dental chews as a helper. Persistent bad breath, drooling, dropping food or a swollen face means a vet check.",
      links: [{ label: "Book a dental check", href: "/clinics?category=DENTAL" }, { label: "Dental chews", href: "/store" }],
    };
  }

  if (/(hot|heat|summer|temperature|cool down|حر|صيف)/.test(text)) {
    return {
      answer:
        "Pets overheat faster than people. Always provide shade and fresh water, never leave an animal in a parked car, walk early or late, and take extra care with flat-faced breeds, puppies, seniors and heavy coats. Heavy panting with drooling, weakness or collapse is an emergency: cool them gradually with lukewarm water and get to a vet at once.",
      links: [EMERGENCY_LINK],
    };
  }

  if (/(check.?up|ask the vet|what should i ask|questions for (the )?vet|annual|wellness|فحص دوري)/.test(text)) {
    return {
      answer:
        `Useful things to ask at ${name}'s check-up:\n\n- Is their weight and body condition right for their age?\n- Are vaccinations, parasite prevention and microchip details up to date?\n- Is the food and portion size suitable?\n- How are their teeth, skin, ears and eyes?\n- What changes should I watch for as they get older?\n- Anything I have noticed lately, such as appetite, thirst, energy or toileting? Write these down beforehand.`,
      links: [{ label: "Book a wellness check", href: "/clinics?category=WELLNESS" }, RECORDS],
    };
  }

  if (/(breed|mate|stud|litter|pregnan|whelp|تزاوج|حمل)/.test(text)) {
    return {
      answer:
        "Breeding questions depend heavily on the individual animal's age, health and history. The breeding tools check compatibility and show exactly which factors apply to your pet. For pregnancy care, a vet visit early on is strongly recommended.",
      links: [{ label: "Open breeding matches", href: "/dashboard/breeding" }, FIND_VET],
    };
  }

  // 4. Honest default: say what this can and cannot do.
  return {
    answer:
      "I can only give general guidance without the AI service. I can help with urgent signs, common symptoms (vomiting, not eating, limping, itching), sleep, feeding, vaccines, parasites, neutering, grooming, dental care, training and heat. Try rewording your question around one of those, or ask a vet, who can examine " + name + " properly.\n\nIf anything seems wrong right now, do not wait: book a vet or use the emergency finder.",
    links: [FIND_VET, EMERGENCY_LINK, RECORDS],
  };
}
