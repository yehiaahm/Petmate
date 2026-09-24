/**
 * Reference data.
 *
 * Breeds, vaccines, categories and plans are part of the product, not demo
 * content — they ship in every environment including production. The demo
 * accounts and listings in `seed.ts` are separate and gated behind
 * SEED_DEMO_DATA, so production never gets a fake dog.
 */

export interface BreedSeed {
  species: string;
  name: string;
  sizeClass?: string;
  avgWeightKgMin?: number;
  avgWeightKgMax?: number;
  lifespanMinY?: number;
  lifespanMaxY?: number;
  temperament?: string;
  careLevel?: string;
  hypoallergenic?: boolean;
  originCountry?: string;
  description?: string;
  popularity?: number;
}

export const BREEDS: BreedSeed[] = [
  // ---- Dogs ---------------------------------------------------------------
  { species: "DOG", name: "Labrador Retriever", sizeClass: "LARGE", avgWeightKgMin: 25, avgWeightKgMax: 36, lifespanMinY: 10, lifespanMaxY: 12, temperament: "Friendly,Energetic,Gentle,Good with kids", careLevel: "MODERATE", originCountry: "Canada", popularity: 100, description: "Even-tempered, endlessly patient and famously food-motivated, which makes training straightforward. Needs real daily exercise or the weight goes on fast." },
  { species: "DOG", name: "German Shepherd", sizeClass: "LARGE", avgWeightKgMin: 22, avgWeightKgMax: 40, lifespanMinY: 9, lifespanMaxY: 13, temperament: "Protective,Intelligent,Energetic,Trained", careLevel: "HIGH", originCountry: "Germany", popularity: 95, description: "A working dog that needs a job. Exceptional with a committed owner, difficult without structure and daily mental work." },
  { species: "DOG", name: "Golden Retriever", sizeClass: "LARGE", avgWeightKgMin: 25, avgWeightKgMax: 34, lifespanMinY: 10, lifespanMaxY: 12, temperament: "Affectionate,Gentle,Playful,Good with kids", careLevel: "MODERATE", originCountry: "Scotland", popularity: 94, description: "Sociable and biddable, with a coat that sheds heavily twice a year. Prone to hip issues, so parental screening matters." },
  { species: "DOG", name: "French Bulldog", sizeClass: "SMALL", avgWeightKgMin: 8, avgWeightKgMax: 14, lifespanMinY: 10, lifespanMaxY: 12, temperament: "Affectionate,Playful,Calm,Quiet", careLevel: "MODERATE", originCountry: "France", popularity: 93, description: "Companionable and low-exercise, but brachycephalic: heat, flying and strenuous activity all carry real risk. Buy only from health-tested parents." },
  { species: "DOG", name: "Poodle", sizeClass: "MEDIUM", avgWeightKgMin: 20, avgWeightKgMax: 32, lifespanMinY: 12, lifespanMaxY: 15, temperament: "Intelligent,Playful,Affectionate,Trained", careLevel: "HIGH", hypoallergenic: true, originCountry: "Germany", popularity: 88, description: "One of the most trainable breeds, with a coat that needs professional grooming every six to eight weeks rather than shedding." },
  { species: "DOG", name: "Beagle", sizeClass: "SMALL", avgWeightKgMin: 9, avgWeightKgMax: 11, lifespanMinY: 12, lifespanMaxY: 15, temperament: "Curious,Friendly,Energetic,Vocal", careLevel: "MODERATE", originCountry: "England", popularity: 82, description: "Scent hound first, companion second. Will follow a smell through a fence, so recall training and secure boundaries are essential." },
  { species: "DOG", name: "Siberian Husky", sizeClass: "LARGE", avgWeightKgMin: 16, avgWeightKgMax: 27, lifespanMinY: 12, lifespanMaxY: 14, temperament: "Energetic,Independent,Vocal,Playful", careLevel: "HIGH", originCountry: "Russia", popularity: 80, description: "Bred to run for hours. Escape-prone, highly vocal, and unsuited to hot climates or owners who cannot exercise them properly." },
  { species: "DOG", name: "Border Collie", sizeClass: "MEDIUM", avgWeightKgMin: 14, avgWeightKgMax: 20, lifespanMinY: 12, lifespanMaxY: 15, temperament: "Intelligent,Energetic,Trained,Protective", careLevel: "HIGH", originCountry: "United Kingdom", popularity: 78, description: "Arguably the most intelligent breed, which is the problem: without daily work they invent jobs you will not enjoy." },
  { species: "DOG", name: "Chihuahua", sizeClass: "TOY", avgWeightKgMin: 1.5, avgWeightKgMax: 3, lifespanMinY: 12, lifespanMaxY: 20, temperament: "Affectionate,Protective,Vocal,Curious", careLevel: "LOW", originCountry: "Mexico", popularity: 75 },
  { species: "DOG", name: "Dachshund", sizeClass: "SMALL", avgWeightKgMin: 7, avgWeightKgMax: 15, lifespanMinY: 12, lifespanMaxY: 16, temperament: "Curious,Playful,Vocal,Independent", careLevel: "MODERATE", originCountry: "Germany", popularity: 74, description: "Long back means real spinal risk: no stairs, no jumping off furniture, keep them lean." },
  { species: "DOG", name: "Rottweiler", sizeClass: "LARGE", avgWeightKgMin: 35, avgWeightKgMax: 60, lifespanMinY: 8, lifespanMaxY: 10, temperament: "Protective,Calm,Trained,Independent", careLevel: "HIGH", originCountry: "Germany", popularity: 70 },
  { species: "DOG", name: "Yorkshire Terrier", sizeClass: "TOY", avgWeightKgMin: 2, avgWeightKgMax: 3.5, lifespanMinY: 13, lifespanMaxY: 16, temperament: "Energetic,Affectionate,Vocal,Curious", careLevel: "MODERATE", hypoallergenic: true, originCountry: "England", popularity: 68 },
  { species: "DOG", name: "Shih Tzu", sizeClass: "SMALL", avgWeightKgMin: 4, avgWeightKgMax: 7, lifespanMinY: 10, lifespanMaxY: 16, temperament: "Affectionate,Calm,Playful,Good with kids", careLevel: "HIGH", hypoallergenic: true, originCountry: "China", popularity: 66 },
  { species: "DOG", name: "Boxer", sizeClass: "LARGE", avgWeightKgMin: 25, avgWeightKgMax: 32, lifespanMinY: 10, lifespanMaxY: 12, temperament: "Playful,Energetic,Protective,Good with kids", careLevel: "MODERATE", originCountry: "Germany", popularity: 64 },
  { species: "DOG", name: "Australian Shepherd", sizeClass: "MEDIUM", avgWeightKgMin: 16, avgWeightKgMax: 32, lifespanMinY: 12, lifespanMaxY: 15, temperament: "Energetic,Intelligent,Trained,Protective", careLevel: "HIGH", originCountry: "United States", popularity: 62 },
  { species: "DOG", name: "Cavalier King Charles Spaniel", sizeClass: "SMALL", avgWeightKgMin: 5, avgWeightKgMax: 8, lifespanMinY: 9, lifespanMaxY: 14, temperament: "Affectionate,Gentle,Calm,Good with kids", careLevel: "MODERATE", originCountry: "United Kingdom", popularity: 60, description: "Exceptionally sweet-natured, but mitral valve disease and syringomyelia are common. Heart and MRI screening of parents is not optional." },
  { species: "DOG", name: "Pug", sizeClass: "SMALL", avgWeightKgMin: 6, avgWeightKgMax: 8, lifespanMinY: 12, lifespanMaxY: 15, temperament: "Playful,Affectionate,Calm,Good with kids", careLevel: "MODERATE", originCountry: "China", popularity: 58 },
  { species: "DOG", name: "Doberman Pinscher", sizeClass: "LARGE", avgWeightKgMin: 27, avgWeightKgMax: 45, lifespanMinY: 10, lifespanMaxY: 13, temperament: "Protective,Intelligent,Energetic,Trained", careLevel: "HIGH", originCountry: "Germany", popularity: 55 },
  { species: "DOG", name: "Shiba Inu", sizeClass: "SMALL", avgWeightKgMin: 7, avgWeightKgMax: 11, lifespanMinY: 12, lifespanMaxY: 16, temperament: "Independent,Curious,Quiet,Protective", careLevel: "MODERATE", originCountry: "Japan", popularity: 54 },
  { species: "DOG", name: "Mixed Breed", sizeClass: "MEDIUM", lifespanMinY: 10, lifespanMaxY: 16, temperament: "Friendly,Playful,Curious", careLevel: "MODERATE", popularity: 90, description: "Often healthier than pedigree lines through greater genetic diversity, and the majority of dogs waiting in rescue." },

  // ---- Cats ---------------------------------------------------------------
  { species: "CAT", name: "Domestic Shorthair", sizeClass: "MEDIUM", avgWeightKgMin: 3, avgWeightKgMax: 6, lifespanMinY: 12, lifespanMaxY: 20, temperament: "Independent,Affectionate,Playful,Curious", careLevel: "LOW", popularity: 100, description: "Not a breed but a population, and the most common cat in the world. Robust, varied and overwhelmingly what is available in rescue." },
  { species: "CAT", name: "Persian", sizeClass: "MEDIUM", avgWeightKgMin: 3, avgWeightKgMax: 6, lifespanMinY: 10, lifespanMaxY: 17, temperament: "Calm,Affectionate,Quiet,Independent", careLevel: "HIGH", originCountry: "Iran", popularity: 88, description: "Daily grooming is mandatory, not optional. Flat-faced lines have tear duct and breathing problems." },
  { species: "CAT", name: "Maine Coon", sizeClass: "LARGE", avgWeightKgMin: 5, avgWeightKgMax: 11, lifespanMinY: 12, lifespanMaxY: 15, temperament: "Gentle,Playful,Affectionate,Good with kids", careLevel: "MODERATE", originCountry: "United States", popularity: 86, description: "The largest domestic breed, unusually dog-like in temperament. HCM screening of breeding cats is essential." },
  { species: "CAT", name: "Siamese", sizeClass: "MEDIUM", avgWeightKgMin: 3, avgWeightKgMax: 6, lifespanMinY: 12, lifespanMaxY: 20, temperament: "Vocal,Affectionate,Curious,Playful", careLevel: "MODERATE", originCountry: "Thailand", popularity: 82, description: "Extremely people-oriented and extremely vocal. Does badly alone all day." },
  { species: "CAT", name: "British Shorthair", sizeClass: "MEDIUM", avgWeightKgMin: 4, avgWeightKgMax: 8, lifespanMinY: 12, lifespanMaxY: 20, temperament: "Calm,Independent,Quiet,Gentle", careLevel: "LOW", originCountry: "United Kingdom", popularity: 80 },
  { species: "CAT", name: "Ragdoll", sizeClass: "LARGE", avgWeightKgMin: 4, avgWeightKgMax: 9, lifespanMinY: 12, lifespanMaxY: 17, temperament: "Calm,Affectionate,Gentle,Good with kids", careLevel: "MODERATE", originCountry: "United States", popularity: 78 },
  { species: "CAT", name: "Bengal", sizeClass: "MEDIUM", avgWeightKgMin: 4, avgWeightKgMax: 7, lifespanMinY: 12, lifespanMaxY: 16, temperament: "Energetic,Curious,Playful,Vocal", careLevel: "HIGH", originCountry: "United States", popularity: 74, description: "Very high energy and genuinely demanding. Restricted or licensable in some jurisdictions depending on generation." },
  { species: "CAT", name: "Sphynx", sizeClass: "MEDIUM", avgWeightKgMin: 3, avgWeightKgMax: 5, lifespanMinY: 9, lifespanMaxY: 15, temperament: "Affectionate,Energetic,Curious,Vocal", careLevel: "HIGH", hypoallergenic: false, originCountry: "Canada", popularity: 66, description: "Hairless does not mean allergen-free. Needs weekly bathing and warmth." },
  { species: "CAT", name: "Scottish Fold", sizeClass: "MEDIUM", avgWeightKgMin: 3, avgWeightKgMax: 6, lifespanMinY: 11, lifespanMaxY: 15, temperament: "Calm,Affectionate,Quiet", careLevel: "MODERATE", originCountry: "Scotland", popularity: 64, description: "The folded ear comes from a cartilage defect that affects every joint. Several veterinary bodies oppose breeding them." },
  { species: "CAT", name: "Abyssinian", sizeClass: "MEDIUM", avgWeightKgMin: 3, avgWeightKgMax: 5, lifespanMinY: 9, lifespanMaxY: 15, temperament: "Energetic,Curious,Playful,Independent", careLevel: "MODERATE", originCountry: "Ethiopia", popularity: 58 },

  // ---- Birds --------------------------------------------------------------
  { species: "BIRD", name: "Budgerigar", sizeClass: "TOY", lifespanMinY: 5, lifespanMaxY: 10, temperament: "Playful,Vocal,Curious,Affectionate", careLevel: "MODERATE", originCountry: "Australia", popularity: 90 },
  { species: "BIRD", name: "Cockatiel", sizeClass: "SMALL", lifespanMinY: 15, lifespanMaxY: 25, temperament: "Affectionate,Gentle,Vocal,Curious", careLevel: "MODERATE", originCountry: "Australia", popularity: 85 },
  { species: "BIRD", name: "African Grey Parrot", sizeClass: "MEDIUM", lifespanMinY: 40, lifespanMaxY: 60, temperament: "Intelligent,Vocal,Independent,Curious", careLevel: "HIGH", originCountry: "Central Africa", popularity: 70, description: "A 50-year commitment with the cognitive needs of a small child. CITES-listed: paperwork is legally required." },
  { species: "BIRD", name: "Lovebird", sizeClass: "TOY", lifespanMinY: 10, lifespanMaxY: 15, temperament: "Affectionate,Energetic,Vocal", careLevel: "MODERATE", originCountry: "Africa", popularity: 62 },
  { species: "BIRD", name: "Canary", sizeClass: "TOY", lifespanMinY: 10, lifespanMaxY: 14, temperament: "Quiet,Independent,Vocal", careLevel: "LOW", originCountry: "Canary Islands", popularity: 55 },

  // ---- Rabbits ------------------------------------------------------------
  { species: "RABBIT", name: "Holland Lop", sizeClass: "SMALL", avgWeightKgMin: 1, avgWeightKgMax: 2, lifespanMinY: 7, lifespanMaxY: 14, temperament: "Gentle,Playful,Calm,Affectionate", careLevel: "MODERATE", originCountry: "Netherlands", popularity: 80 },
  { species: "RABBIT", name: "Netherland Dwarf", sizeClass: "TOY", avgWeightKgMin: 0.5, avgWeightKgMax: 1.2, lifespanMinY: 7, lifespanMaxY: 12, temperament: "Curious,Energetic,Shy", careLevel: "MODERATE", originCountry: "Netherlands", popularity: 74 },
  { species: "RABBIT", name: "Rex", sizeClass: "MEDIUM", avgWeightKgMin: 3, avgWeightKgMax: 5, lifespanMinY: 5, lifespanMaxY: 8, temperament: "Calm,Affectionate,Gentle", careLevel: "MODERATE", popularity: 60 },
  { species: "RABBIT", name: "Flemish Giant", sizeClass: "GIANT", avgWeightKgMin: 6, avgWeightKgMax: 10, lifespanMinY: 5, lifespanMaxY: 8, temperament: "Calm,Gentle,Affectionate,Good with kids", careLevel: "HIGH", originCountry: "Belgium", popularity: 52 },

  // ---- Small mammals ------------------------------------------------------
  { species: "SMALL_MAMMAL", name: "Syrian Hamster", sizeClass: "TOY", lifespanMinY: 2, lifespanMaxY: 3, temperament: "Independent,Curious,Quiet", careLevel: "LOW", popularity: 75, description: "Strictly solitary: housing two together leads to serious injury." },
  { species: "SMALL_MAMMAL", name: "Guinea Pig", sizeClass: "SMALL", lifespanMinY: 4, lifespanMaxY: 8, temperament: "Gentle,Vocal,Good with kids,Affectionate", careLevel: "MODERATE", originCountry: "Peru", popularity: 72, description: "Highly social — keeping one alone is a welfare problem. Needs dietary vitamin C." },
  { species: "SMALL_MAMMAL", name: "Ferret", sizeClass: "SMALL", lifespanMinY: 6, lifespanMaxY: 10, temperament: "Playful,Curious,Energetic,Independent", careLevel: "HIGH", popularity: 50 },
  { species: "SMALL_MAMMAL", name: "Chinchilla", sizeClass: "SMALL", lifespanMinY: 10, lifespanMaxY: 20, temperament: "Shy,Curious,Quiet,Independent", careLevel: "HIGH", originCountry: "Chile", popularity: 44 },

  // ---- Reptiles -----------------------------------------------------------
  { species: "REPTILE", name: "Bearded Dragon", sizeClass: "SMALL", lifespanMinY: 8, lifespanMaxY: 15, temperament: "Calm,Curious,Gentle", careLevel: "MODERATE", originCountry: "Australia", popularity: 80, description: "Needs UVB lighting and a proper heat gradient. Most health problems in captivity come from getting those wrong." },
  { species: "REPTILE", name: "Leopard Gecko", sizeClass: "TOY", lifespanMinY: 10, lifespanMaxY: 20, temperament: "Calm,Quiet,Independent", careLevel: "LOW", originCountry: "Pakistan", popularity: 76 },
  { species: "REPTILE", name: "Ball Python", sizeClass: "MEDIUM", lifespanMinY: 20, lifespanMaxY: 30, temperament: "Calm,Quiet,Shy", careLevel: "MODERATE", originCountry: "West Africa", popularity: 70 },
  { species: "REPTILE", name: "Corn Snake", sizeClass: "SMALL", lifespanMinY: 15, lifespanMaxY: 20, temperament: "Calm,Curious,Quiet", careLevel: "LOW", originCountry: "United States", popularity: 66 },

  // ---- Horses -------------------------------------------------------------
  { species: "HORSE", name: "Arabian", sizeClass: "LARGE", lifespanMinY: 25, lifespanMaxY: 30, temperament: "Intelligent,Energetic,Affectionate", careLevel: "HIGH", originCountry: "Arabian Peninsula", popularity: 70 },
  { species: "HORSE", name: "Quarter Horse", sizeClass: "LARGE", lifespanMinY: 25, lifespanMaxY: 35, temperament: "Calm,Trained,Gentle", careLevel: "HIGH", originCountry: "United States", popularity: 68 },
  { species: "HORSE", name: "Thoroughbred", sizeClass: "LARGE", lifespanMinY: 25, lifespanMaxY: 30, temperament: "Energetic,Intelligent,Protective", careLevel: "HIGH", originCountry: "England", popularity: 60 },
];

export interface VaccineSeed {
  species: string;
  code: string;
  name: string;
  description: string;
  coreVaccine: boolean;
  boosterMonths: number | null;
}

export const VACCINES: VaccineSeed[] = [
  // Dogs
  { species: "DOG", code: "DHPP", name: "DHPP (distemper, hepatitis, parvovirus, parainfluenza)", description: "The core combination vaccine. Puppies need a series, then boosters.", coreVaccine: true, boosterMonths: 12 },
  { species: "DOG", code: "RABIES", name: "Rabies", description: "Legally required in most countries. Interval depends on the product and local law.", coreVaccine: true, boosterMonths: 12 },
  { species: "DOG", code: "LEPTO", name: "Leptospirosis", description: "Recommended where there is standing water or wildlife exposure.", coreVaccine: false, boosterMonths: 12 },
  { species: "DOG", code: "BORDETELLA", name: "Bordetella (kennel cough)", description: "Usually required by boarding kennels, groomers and daycare.", coreVaccine: false, boosterMonths: 12 },
  { species: "DOG", code: "LYME", name: "Lyme disease", description: "For dogs in tick-heavy regions.", coreVaccine: false, boosterMonths: 12 },
  { species: "DOG", code: "CIV", name: "Canine influenza", description: "For dogs in group settings during an outbreak.", coreVaccine: false, boosterMonths: 12 },

  // Cats
  { species: "CAT", code: "FVRCP", name: "FVRCP (rhinotracheitis, calicivirus, panleukopenia)", description: "The core feline combination vaccine.", coreVaccine: true, boosterMonths: 12 },
  { species: "CAT", code: "RABIES", name: "Rabies", description: "Legally required in most countries.", coreVaccine: true, boosterMonths: 12 },
  { species: "CAT", code: "FELV", name: "Feline leukaemia (FeLV)", description: "Core for kittens and for any cat with outdoor access.", coreVaccine: false, boosterMonths: 12 },
  { species: "CAT", code: "FIV", name: "Feline immunodeficiency virus", description: "Availability varies by country; discuss with your vet.", coreVaccine: false, boosterMonths: 12 },

  // Rabbits
  { species: "RABBIT", code: "RHDV", name: "Rabbit haemorrhagic disease (RHDV1/2)", description: "Essential. The disease is almost always fatal and spreads easily.", coreVaccine: true, boosterMonths: 12 },
  { species: "RABBIT", code: "MYXO", name: "Myxomatosis", description: "Core in regions where myxomatosis is present.", coreVaccine: true, boosterMonths: 12 },

  // Ferrets
  { species: "SMALL_MAMMAL", code: "DISTEMPER", name: "Canine distemper (ferrets)", description: "Ferrets are highly susceptible and distemper is usually fatal.", coreVaccine: true, boosterMonths: 12 },
  { species: "SMALL_MAMMAL", code: "RABIES", name: "Rabies (ferrets)", description: "Required in many jurisdictions.", coreVaccine: false, boosterMonths: 12 },

  // Horses
  { species: "HORSE", code: "TETANUS", name: "Tetanus", description: "Core. Horses are unusually susceptible to tetanus.", coreVaccine: true, boosterMonths: 12 },
  { species: "HORSE", code: "EQUINE_FLU", name: "Equine influenza", description: "Required for most competition and transport.", coreVaccine: true, boosterMonths: 6 },
  { species: "HORSE", code: "EHV", name: "Equine herpesvirus (EHV-1/4)", description: "Recommended for horses that travel or live in groups.", coreVaccine: false, boosterMonths: 6 },

  // Birds
  { species: "BIRD", code: "POLYOMA", name: "Avian polyomavirus", description: "Used mainly in breeding aviaries and for young psittacines.", coreVaccine: false, boosterMonths: 12 },
];

export interface CategorySeed {
  name: string;
  slug: string;
  icon: string;
  species?: string;
  children?: { name: string; slug: string }[];
}

export const CATEGORIES: CategorySeed[] = [
  {
    name: "Food & treats",
    slug: "food-treats",
    icon: "bowl",
    children: [
      { name: "Dry food", slug: "dry-food" },
      { name: "Wet food", slug: "wet-food" },
      { name: "Raw & frozen", slug: "raw-frozen" },
      { name: "Treats & chews", slug: "treats-chews" },
      { name: "Prescription diets", slug: "prescription-diets" },
      { name: "Supplements", slug: "supplements" },
    ],
  },
  {
    name: "Health & care",
    slug: "health-care",
    icon: "heart-pulse",
    children: [
      { name: "Flea & tick", slug: "flea-tick" },
      { name: "Dental care", slug: "dental-care" },
      { name: "Wound & first aid", slug: "first-aid" },
      { name: "Joint & mobility", slug: "joint-mobility" },
      { name: "Calming aids", slug: "calming-aids" },
    ],
  },
  {
    name: "Grooming",
    slug: "grooming",
    icon: "scissors",
    children: [
      { name: "Shampoo & conditioner", slug: "shampoo-conditioner" },
      { name: "Brushes & combs", slug: "brushes-combs" },
      { name: "Clippers & trimmers", slug: "clippers-trimmers" },
      { name: "Nail care", slug: "nail-care" },
    ],
  },
  {
    name: "Toys & enrichment",
    slug: "toys-enrichment",
    icon: "puzzle",
    children: [
      { name: "Chew toys", slug: "chew-toys" },
      { name: "Puzzle feeders", slug: "puzzle-feeders" },
      { name: "Fetch & tug", slug: "fetch-tug" },
      { name: "Scratching posts", slug: "scratching-posts" },
    ],
  },
  {
    name: "Beds & furniture",
    slug: "beds-furniture",
    icon: "bed",
    children: [
      { name: "Beds & mats", slug: "beds-mats" },
      { name: "Crates & carriers", slug: "crates-carriers" },
      { name: "Cat trees", slug: "cat-trees" },
      { name: "Hutches & cages", slug: "hutches-cages" },
    ],
  },
  {
    name: "Walking & travel",
    slug: "walking-travel",
    icon: "route",
    children: [
      { name: "Collars & tags", slug: "collars-tags" },
      { name: "Leads & harnesses", slug: "leads-harnesses" },
      { name: "Travel carriers", slug: "travel-carriers" },
      { name: "Car safety", slug: "car-safety" },
    ],
  },
  {
    name: "Habitat & aquatics",
    slug: "habitat-aquatics",
    icon: "waves",
    children: [
      { name: "Terrarium heating & lighting", slug: "terrarium-heating" },
      { name: "Substrate & bedding", slug: "substrate-bedding" },
      { name: "Aquarium filtration", slug: "aquarium-filtration" },
    ],
  },
  {
    name: "Litter & cleaning",
    slug: "litter-cleaning",
    icon: "spray",
    children: [
      { name: "Litter & trays", slug: "litter-trays" },
      { name: "Waste bags", slug: "waste-bags" },
      { name: "Stain & odour", slug: "stain-odour" },
    ],
  },
];

export interface PlanSeed {
  code: string;
  name: string;
  tagline: string;
  audience: string;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  features: string[];
  limits: Record<string, number | boolean | string>;
  position: number;
}

/**
 * Plans.
 *
 * Priced in Egyptian pounds (minor units, piastres) for the Egyptian launch.
 * A clinic's plan pays for itself at roughly 20 bookings a month through the
 * 2% commission discount alone; a breeder's at about two pet sales.
 *
 * The free tier can complete every transaction on the platform — messaging,
 * buying, booking a vet, keeping health records. Paid tiers sell capacity,
 * visibility and professional tooling. Nothing essential is behind a paywall,
 * because a marketplace that taxes its own liquidity does not grow.
 */
export const PLANS: PlanSeed[] = [
  {
    code: "free",
    name: "Free",
    tagline: "Everything you need to look after one or two pets",
    audience: "CONSUMER",
    priceMonthlyCents: 0,
    priceYearlyCents: 0,
    features: [
      "Unlimited pet profiles and health records",
      "Message any seller, breeder or clinic",
      "Buy, adopt and book vets with full escrow protection",
      "3 active listings",
      "5 breeding requests a month",
      "3 saved searches with alerts",
    ],
    limits: {
      activeListings: 3,
      breedingRequestsPerMonth: 5,
      savedSearchAlerts: 3,
      visibilityBoost: 1,
      analytics: false,
      advancedMatching: false,
      commissionDiscountBps: 0,
    },
    position: 0,
  },
  {
    code: "plus",
    name: "PetMate Plus",
    tagline: "For people actively looking or rehoming",
    audience: "CONSUMER",
    priceMonthlyCents: 9_900, // EGP 99
    priceYearlyCents: 99_000, // EGP 990: two months free
    features: [
      "10 active listings",
      "25 breeding requests a month",
      "Unlimited saved searches with instant alerts",
      "Listings ranked higher in search",
      "Wider breeding match pool",
      "Listing performance analytics",
    ],
    limits: {
      activeListings: 10,
      breedingRequestsPerMonth: 25,
      savedSearchAlerts: "unlimited",
      visibilityBoost: 1.2,
      analytics: true,
      advancedMatching: true,
      commissionDiscountBps: 0,
    },
    position: 1,
  },
  {
    code: "breeder-pro",
    name: "Breeder Pro",
    tagline: "For responsible breeders running a real programme",
    audience: "BREEDER",
    priceMonthlyCents: 49_900, // EGP 499
    priceYearlyCents: 499_000,
    features: [
      "Unlimited listings and breeding requests",
      "Full compatibility engine with the widest match pool",
      "Litter and lineage management",
      "Verified breeder badge (after review)",
      "Programme analytics and demand data",
      "1% lower commission on every sale",
      "Priority support",
    ],
    limits: {
      activeListings: "unlimited",
      breedingRequestsPerMonth: "unlimited",
      savedSearchAlerts: "unlimited",
      visibilityBoost: 1.4,
      analytics: true,
      advancedMatching: true,
      bulkTools: true,
      prioritySupport: true,
      commissionDiscountBps: 100,
    },
    position: 2,
  },
  {
    code: "seller-pro",
    name: "Seller Pro",
    tagline: "For shops selling pet products at volume",
    audience: "SELLER",
    priceMonthlyCents: 69_900, // EGP 699
    priceYearlyCents: 699_000,
    features: [
      "Unlimited products",
      "Bulk import and inventory tools",
      "Storefront analytics and conversion data",
      "Higher placement in product search",
      "1.5% lower commission on every order",
      "Priority support",
    ],
    limits: {
      activeListings: "unlimited",
      breedingRequestsPerMonth: "unlimited",
      savedSearchAlerts: "unlimited",
      visibilityBoost: 1.3,
      analytics: true,
      bulkTools: true,
      prioritySupport: true,
      commissionDiscountBps: 150,
    },
    position: 3,
  },
  {
    code: "clinic-pro",
    name: "Clinic Pro",
    tagline: "For veterinary practices taking bookings online",
    audience: "CLINIC",
    priceMonthlyCents: 149_900, // EGP 1,499
    priceYearlyCents: 1_499_000,
    features: [
      "Unlimited services and practitioners",
      "Full booking calendar with per-vet availability",
      "Write directly into patients' PetMate health records",
      "Practice analytics: revenue, no-shows, service mix",
      "Featured placement in local clinic search",
      "2% lower commission on every booking",
      "Priority support",
    ],
    limits: {
      activeListings: "unlimited",
      breedingRequestsPerMonth: "unlimited",
      savedSearchAlerts: "unlimited",
      visibilityBoost: 1.5,
      analytics: true,
      bulkTools: true,
      prioritySupport: true,
      commissionDiscountBps: 200,
    },
    position: 4,
  },
];
