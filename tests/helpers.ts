import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { generatePassportNumber, addMonths, addDays } from "@/lib/utils";
import { buildSearchText } from "@/lib/search/text";
import type { AuthContext } from "@/lib/auth/session";
import type { Role } from "@/lib/constants";

/**
 * Test factories.
 *
 * Every helper writes real rows through the real client, so a test exercises
 * the same constraints, defaults and cascades that production does.
 */

let counter = 0;
const unique = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export async function makeUser(
  overrides: {
    name?: string;
    roles?: Role[];
    emailVerified?: boolean;
    trustScore?: number;
    status?: string;
    city?: string;
    lat?: number;
    lng?: number;
  } = {},
): Promise<{ auth: AuthContext; id: string; email: string }> {
  const id = unique();
  const email = `test-${id}@example.test`;

  const user = await db.user.create({
    data: {
      email,
      emailNormalized: email,
      emailVerifiedAt: overrides.emailVerified === false ? null : new Date(),
      passwordHash: await hashPassword("TestPassword123!"),
      name: overrides.name ?? `Test User ${id}`,
      handle: `test-${id}`,
      status: overrides.status ?? "ACTIVE",
      trustScore: overrides.trustScore ?? 50,
      city: overrides.city ?? "Cairo",
      country: "Egypt",
      lat: overrides.lat ?? 30.0444,
      lng: overrides.lng ?? 31.2357,
      acceptedTermsAt: new Date(),
      roles: { create: (overrides.roles ?? ["USER"]).map((role) => ({ role })) },
    },
    select: {
      id: true,
      email: true,
      name: true,
      handle: true,
      avatarUrl: true,
      status: true,
      emailVerifiedAt: true,
      trustScore: true,
      currency: true,
      city: true,
      country: true,
      lat: true,
      lng: true,
      roles: { select: { role: true } },
    },
  });

  return {
    id: user.id,
    email: user.email,
    auth: {
      sessionId: `session-${id}`,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        handle: user.handle,
        avatarUrl: user.avatarUrl,
        roles: user.roles.map((r) => r.role as Role),
        status: user.status,
        emailVerified: Boolean(user.emailVerifiedAt),
        trustScore: user.trustScore,
        currency: user.currency,
        city: user.city,
        country: user.country,
        lat: user.lat,
        lng: user.lng,
      },
    },
  };
}

export async function makePet(
  ownerId: string,
  overrides: {
    name?: string;
    species?: string;
    sex?: "MALE" | "FEMALE";
    ageMonths?: number;
    isNeutered?: boolean;
    withPhoto?: boolean;
    damId?: string;
    sireId?: string;
    healthScore?: number;
    lat?: number;
    lng?: number;
  } = {},
) {
  const pet = await db.pet.create({
    data: {
      ownerId,
      name: overrides.name ?? `Pet ${unique()}`,
      species: overrides.species ?? "DOG",
      sex: overrides.sex ?? "FEMALE",
      birthDate: addMonths(new Date(), -(overrides.ageMonths ?? 24)),
      isNeutered: overrides.isNeutered ?? false,
      passportNo: generatePassportNumber(),
      damId: overrides.damId ?? null,
      sireId: overrides.sireId ?? null,
      healthScore: overrides.healthScore ?? 0,
      city: "Cairo",
      country: "Egypt",
      lat: overrides.lat ?? 30.0444,
      lng: overrides.lng ?? 31.2357,
      ...(overrides.withPhoto !== false
        ? {
            photos: {
              create: { url: "https://example.test/photo.jpg", position: 0, isPrimary: true },
            },
          }
        : {}),
    },
    select: { id: true, name: true, species: true, sex: true, ownerId: true },
  });

  return pet;
}

export async function makeListing(
  sellerId: string,
  petId: string,
  overrides: { intent?: "SALE" | "ADOPTION" | "BREEDING"; priceCents?: number; status?: string } = {},
) {
  const title = `Listing ${unique()}`;

  return db.listing.create({
    data: {
      petId,
      sellerId,
      intent: overrides.intent ?? "SALE",
      title,
      slug: `listing-${unique()}`,
      description: "A description that is comfortably long enough to pass validation everywhere.",
      priceCents: overrides.priceCents ?? 50_000,
      status: overrides.status ?? "ACTIVE",
      moderationStatus: "APPROVED",
      publishedAt: new Date(),
      expiresAt: addDays(new Date(), 30),
      city: "Cairo",
      country: "Egypt",
      lat: 30.0444,
      lng: 31.2357,
      searchText: buildSearchText(title, "description"),
    },
    select: { id: true, slug: true, priceCents: true, currency: true, petId: true, sellerId: true },
  });
}

export async function makeShopWithProduct(
  ownerUserId: string,
  overrides: { stock?: number; priceCents?: number } = {},
) {
  const shop = await db.shop.create({
    data: {
      ownerUserId,
      name: `Shop ${unique()}`,
      slug: `shop-${unique()}`,
      email: `shop-${unique()}@example.test`,
      country: "Egypt",
      status: "ACTIVE",
      flatShippingCents: 500,
    },
    select: { id: true },
  });

  const product = await db.product.create({
    data: {
      shopId: shop.id,
      title: `Product ${unique()}`,
      slug: `product-${unique()}`,
      description: "A product description long enough for validation.",
      priceCents: overrides.priceCents ?? 2_000,
      stock: overrides.stock ?? 10,
      status: "ACTIVE",
      publishedAt: new Date(),
      variants: {
        create: {
          name: "Default",
          priceCents: overrides.priceCents ?? 2_000,
          stock: overrides.stock ?? 10,
          isDefault: true,
        },
      },
    },
    select: { id: true, variants: { select: { id: true } } },
  });

  return { shopId: shop.id, productId: product.id, variantId: product.variants[0]!.id };
}

export async function makeClinicWithService(ownerUserId: string) {
  const clinic = await db.clinic.create({
    data: {
      ownerUserId,
      name: `Clinic ${unique()}`,
      slug: `clinic-${unique()}`,
      email: `clinic-${unique()}@example.test`,
      addressLine: "1 Test Street",
      city: "Cairo",
      country: "Egypt",
      status: "ACTIVE",
      verifiedAt: new Date(),
      bookingLeadHours: 1,
      cancellationHours: 24,
      members: { create: { userId: ownerUserId, role: "OWNER" } },
      // Open every day, 09:00-17:00, so slot maths is predictable.
      hours: {
        create: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          startMinute: 9 * 60,
          endMinute: 17 * 60,
          slotMinutes: 30,
        })),
      },
    },
    select: { id: true },
  });

  const vet = await db.vet.create({
    data: { userId: ownerUserId, clinicId: clinic.id, acceptingNew: true },
    select: { id: true },
  });

  const service = await db.service.create({
    data: {
      clinicId: clinic.id,
      name: "Consultation",
      category: "CONSULTATION",
      durationMinutes: 30,
      priceCents: 10_000,
    },
    select: { id: true, priceCents: true, durationMinutes: true },
  });

  return { clinicId: clinic.id, vetId: vet.id, serviceId: service.id, service };
}

/**
 * Puts a user on a paid plan with the given limits. Plans are reference data
 * and survive `resetDatabase`, so each call upserts its own plan code.
 */
export async function subscribeUser(
  userId: string,
  limits: Record<string, number | boolean | string>,
  code = `test-plan-${unique()}`,
) {
  const plan = await db.plan.upsert({
    where: { code },
    create: {
      code,
      name: `Plan ${code}`,
      audience: "CONSUMER",
      priceMonthlyCents: 10_000,
      features: "[]",
      limits: JSON.stringify(limits),
    },
    update: { limits: JSON.stringify(limits) },
    select: { id: true },
  });

  await db.subscription.create({
    data: {
      userId,
      planId: plan.id,
      status: "ACTIVE",
      currentPeriodStart: new Date(),
      currentPeriodEnd: addDays(new Date(), 30),
    },
  });
  return plan.id;
}

/** Wipes every table between suites, in FK-safe order. */
export async function resetDatabase() {
  const tables = [
    "LedgerEntry", "LedgerTransaction", "LedgerAccount", "Refund", "Invoice",
    "DeliveryEvent", "Delivery", "CodCollection", "CouponRedemption", "Coupon", "Referral", "OrderItem", "Order", "PetOrder", "CartItem",
    "ProductVariant", "ProductImage", "Product", "Shop",
    "Appointment", "Service", "ClinicHours", "AvailabilityException", "Vet", "ClinicMember", "Clinic",
    "SupportMessage", "SupportTicket", "DisputeMessage", "Dispute", "Report", "Verification", "TrustSignal", "RiskEvent", "Block",
    "Message", "ConversationParticipant", "Conversation",
    "Notification", "NotificationPreference", "EmailMessage", "OutboundMessage",
    "AdoptionApplication", "ListingQuestion", "ListingView", "Favorite", "SavedSearch", "Listing",
    "BreedingMatch", "BreedingRequest", "BreedingProfilePreferredBreed", "BreedingProfile", "Litter",
    "HealthReminder", "HealthRecord", "PetDocument", "PetPhoto", "PetTransfer", "Pet",
    "Review", "Reaction", "Comment", "Post", "GroupMember", "Group",
    "Subscription", "PaymentIntent", "Payout", "FeaturedPlacement", "AdCampaign",
    "FileObject", "Job", "AnalyticsEvent", "SearchQueryLog", "RateLimitCounter",
    "IdempotencyKey", "AuditLog", "LoginAttempt", "VerificationToken", "OAuthAccount", "TwoFactorBackupCode", "Session", "UserRole",
    "RecentlyViewed", "User",
  ];

  for (const table of tables) {
    await db.$executeRawUnsafe(`DELETE FROM "${table}"`).catch(() => undefined);
  }
}

export { db };
