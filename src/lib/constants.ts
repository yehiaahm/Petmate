/**
 * The vocabulary of the platform.
 *
 * The schema stores these as strings for SQLite/Postgres portability, so this
 * file is the single source of truth for what those strings may be. Every
 * boundary validates against these tuples via Zod, which means an invalid state
 * cannot be written even though the column type is `String`.
 */

export const SPECIES = [
  "DOG",
  "CAT",
  "BIRD",
  "RABBIT",
  "REPTILE",
  "SMALL_MAMMAL",
  "HORSE",
  "OTHER",
] as const;
export type Species = (typeof SPECIES)[number];

export const SPECIES_LABEL: Record<Species, string> = {
  DOG: "Dog",
  CAT: "Cat",
  BIRD: "Bird",
  RABBIT: "Rabbit",
  REPTILE: "Reptile",
  SMALL_MAMMAL: "Small mammal",
  HORSE: "Horse",
  OTHER: "Other",
};

export const SPECIES_PLURAL: Record<Species, string> = {
  DOG: "Dogs",
  CAT: "Cats",
  BIRD: "Birds",
  RABBIT: "Rabbits",
  REPTILE: "Reptiles",
  SMALL_MAMMAL: "Small mammals",
  HORSE: "Horses",
  OTHER: "Other pets",
};

export const SEX = ["MALE", "FEMALE", "UNKNOWN"] as const;
export type Sex = (typeof SEX)[number];

export const SIZE_CLASS = ["TOY", "SMALL", "MEDIUM", "LARGE", "GIANT"] as const;
export type SizeClass = (typeof SIZE_CLASS)[number];

// ---------------------------------------------------------------------------
// Roles and permissions
// ---------------------------------------------------------------------------

export const ROLES = [
  "USER",
  "BREEDER",
  "SELLER",
  "VET",
  "CLINIC_ADMIN",
  "COURIER",
  "MODERATOR",
  "ADMIN",
  "SUPER_ADMIN",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  USER: "Member",
  BREEDER: "Breeder",
  SELLER: "Seller",
  VET: "Veterinarian",
  CLINIC_ADMIN: "Clinic admin",
  COURIER: "Courier",
  MODERATOR: "Moderator",
  ADMIN: "Admin",
  SUPER_ADMIN: "Super admin",
};

export const USER_STATUS = [
  "ACTIVE",
  "SUSPENDED",
  "FROZEN",
  "DEACTIVATED",
  "BANNED",
] as const;
export type UserStatus = (typeof USER_STATUS)[number];

// ---------------------------------------------------------------------------
// Pets
// ---------------------------------------------------------------------------

export const PET_STATUS = [
  "ACTIVE",
  "LISTED",
  "RESERVED",
  "REHOMED",
  "DECEASED",
  "ARCHIVED",
] as const;
export type PetStatus = (typeof PET_STATUS)[number];

export const PET_AVAILABILITY = [
  "NOT_AVAILABLE",
  "FOR_SALE",
  "FOR_ADOPTION",
  "FOR_BREEDING",
] as const;
export type PetAvailability = (typeof PET_AVAILABILITY)[number];

export const VISIBILITY = ["PUBLIC", "UNLISTED", "PRIVATE"] as const;
export type Visibility = (typeof VISIBILITY)[number];

export const VERIFICATION_LEVEL = [
  "NONE",
  "OWNER_CLAIMED",
  "DOCUMENTED",
  "CLINIC_VERIFIED",
] as const;
export type VerificationLevel = (typeof VERIFICATION_LEVEL)[number];

export const VERIFICATION_LEVEL_LABEL: Record<VerificationLevel, string> = {
  NONE: "Unverified",
  OWNER_CLAIMED: "Owner claimed",
  DOCUMENTED: "Documents on file",
  CLINIC_VERIFIED: "Clinic verified",
};

export const PET_DOCUMENT_TYPE = [
  "VACCINATION_CARD",
  "PEDIGREE",
  "MICROCHIP",
  "HEALTH_CERT",
  "DNA_TEST",
  "INSURANCE",
  "OTHER",
] as const;
export type PetDocumentType = (typeof PET_DOCUMENT_TYPE)[number];

export const TEMPERAMENT_TAGS = [
  "Calm",
  "Playful",
  "Affectionate",
  "Independent",
  "Protective",
  "Energetic",
  "Gentle",
  "Curious",
  "Vocal",
  "Quiet",
  "Good with kids",
  "Good with other pets",
  "Trained",
  "Shy",
] as const;

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export const HEALTH_RECORD_TYPE = [
  "VACCINATION",
  "CHECKUP",
  "TREATMENT",
  "SURGERY",
  "MEDICATION",
  "ALLERGY",
  "WEIGHT",
  "TEST",
  "NOTE",
] as const;
export type HealthRecordType = (typeof HEALTH_RECORD_TYPE)[number];

export const HEALTH_RECORD_LABEL: Record<HealthRecordType, string> = {
  VACCINATION: "Vaccination",
  CHECKUP: "Check-up",
  TREATMENT: "Treatment",
  SURGERY: "Surgery",
  MEDICATION: "Medication",
  ALLERGY: "Allergy",
  WEIGHT: "Weight",
  TEST: "Test result",
  NOTE: "Note",
};

// ---------------------------------------------------------------------------
// Marketplace
// ---------------------------------------------------------------------------

export const LISTING_INTENT = ["SALE", "ADOPTION", "BREEDING"] as const;
export type ListingIntent = (typeof LISTING_INTENT)[number];

export const LISTING_INTENT_LABEL: Record<ListingIntent, string> = {
  SALE: "For sale",
  ADOPTION: "For adoption",
  BREEDING: "Breeding",
};

export const LISTING_STATUS = [
  "DRAFT",
  "PENDING_REVIEW",
  "ACTIVE",
  "PAUSED",
  "RESERVED",
  "COMPLETED",
  "REJECTED",
  "EXPIRED",
  "REMOVED",
] as const;
export type ListingStatus = (typeof LISTING_STATUS)[number];

/** Statuses a member of the public may see. Everything else is owner-only. */
export const PUBLIC_LISTING_STATUSES: ListingStatus[] = ["ACTIVE", "RESERVED"];

export const ADOPTION_STATUS = [
  "SUBMITTED",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
  "COMPLETED",
] as const;
export type AdoptionStatus = (typeof ADOPTION_STATUS)[number];

export const HOME_TYPE = ["APARTMENT", "HOUSE", "FARM", "OTHER"] as const;
export const EXPERIENCE_LEVEL = ["FIRST_TIME", "SOME", "EXPERIENCED"] as const;

// ---------------------------------------------------------------------------
// Breeding
// ---------------------------------------------------------------------------

export const BREEDING_REQUEST_STATUS = [
  "PENDING",
  "ACCEPTED",
  "DECLINED",
  "WITHDRAWN",
  "TERMS_PROPOSED",
  "AGREED",
  "SCHEDULED",
  "COMPLETED",
  "CANCELLED",
] as const;
export type BreedingRequestStatus = (typeof BREEDING_REQUEST_STATUS)[number];

export const BREEDING_FEE_TYPE = ["FEE", "PICK_OF_LITTER", "SPLIT", "FREE"] as const;
export type BreedingFeeType = (typeof BREEDING_FEE_TYPE)[number];

export const BREEDING_FEE_TYPE_LABEL: Record<BreedingFeeType, string> = {
  FEE: "Stud fee",
  PICK_OF_LITTER: "Pick of the litter",
  SPLIT: "Split the litter",
  FREE: "No fee",
};

// ---------------------------------------------------------------------------
// Veterinary
// ---------------------------------------------------------------------------

export const SERVICE_CATEGORY = [
  "CONSULTATION",
  "VACCINATION",
  "SURGERY",
  "DENTAL",
  "GROOMING",
  "DIAGNOSTIC",
  "EMERGENCY",
  "WELLNESS",
] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORY)[number];

export const SERVICE_CATEGORY_LABEL: Record<ServiceCategory, string> = {
  CONSULTATION: "Consultation",
  VACCINATION: "Vaccination",
  SURGERY: "Surgery",
  DENTAL: "Dental",
  GROOMING: "Grooming",
  DIAGNOSTIC: "Diagnostics",
  EMERGENCY: "Emergency",
  WELLNESS: "Wellness",
};

export const APPOINTMENT_STATUS = [
  "PENDING_PAYMENT",
  "CONFIRMED",
  "CHECKED_IN",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
  "RESCHEDULED",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUS)[number];

// ---------------------------------------------------------------------------
// Commerce
// ---------------------------------------------------------------------------

export const ORDER_STATUS = [
  "PENDING_PAYMENT",
  /** A cash-on-delivery order: placed, being fulfilled, paid at the door. */
  "CONFIRMED",
  "PAID",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
] as const;
export type OrderStatus = (typeof ORDER_STATUS)[number];

export const PAYMENT_METHOD = ["ONLINE", "COD"] as const;
export type PaymentMethod = (typeof PAYMENT_METHOD)[number];

export const FULFILLMENT_STATUS = [
  "PENDING",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "RETURNED",
] as const;

export const PET_ORDER_STATUS = [
  "PENDING_PAYMENT",
  "IN_ESCROW",
  "HANDOVER_PENDING",
  "COMPLETED",
  "CANCELLED",
  "REFUNDED",
  "DISPUTED",
] as const;
export type PetOrderStatus = (typeof PET_ORDER_STATUS)[number];

export const DELIVERY_STATUS = [
  "PENDING",
  "ASSIGNED",
  "PICKED_UP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "FAILED",
  "RETURNED",
  "CANCELLED",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUS)[number];

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export const PAYMENT_PURPOSE = [
  "PET_PURCHASE",
  "PRODUCT_ORDER",
  "APPOINTMENT",
  "SUBSCRIPTION",
  "FEATURED_LISTING",
  "AD_CAMPAIGN",
  "WALLET_TOPUP",
] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSE)[number];

export const PAYMENT_STATUS = [
  "REQUIRES_PAYMENT",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[number];

export const LEDGER_ACCOUNT_KIND = [
  "AVAILABLE",
  "PENDING",
  /** Requested payouts: debited from AVAILABLE, not yet sent to the bank. */
  "PAYABLE",
  "REVENUE",
  "FEES",
  "ESCROW",
  "GATEWAY",
] as const;
export type LedgerAccountKind = (typeof LEDGER_ACCOUNT_KIND)[number];

export const LEDGER_OWNER_TYPE = [
  "USER",
  "SHOP",
  "CLINIC",
  "PLATFORM",
  "ESCROW",
  "EXTERNAL",
] as const;
export type LedgerOwnerType = (typeof LEDGER_OWNER_TYPE)[number];

export const SUBSCRIPTION_STATUS = [
  "ACTIVE",
  "PAST_DUE",
  "CANCELLED",
  "EXPIRED",
  "TRIALING",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS)[number];

export const PLAN_AUDIENCE = ["CONSUMER", "BREEDER", "SELLER", "CLINIC"] as const;
export type PlanAudience = (typeof PLAN_AUDIENCE)[number];

// ---------------------------------------------------------------------------
// Trust & safety
// ---------------------------------------------------------------------------

export const REPORT_REASON = [
  "FRAUD",
  "ANIMAL_WELFARE",
  "MISLEADING",
  "PROHIBITED",
  "SPAM",
  "HARASSMENT",
  "COUNTERFEIT",
  "OTHER",
] as const;
export type ReportReason = (typeof REPORT_REASON)[number];

export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  FRAUD: "Scam or fraud",
  ANIMAL_WELFARE: "Animal welfare concern",
  MISLEADING: "Misleading information",
  PROHIBITED: "Prohibited animal or item",
  SPAM: "Spam",
  HARASSMENT: "Harassment or abuse",
  COUNTERFEIT: "Counterfeit product",
  OTHER: "Something else",
};

export const VERIFICATION_TYPE = [
  "IDENTITY",
  "ADDRESS",
  "BREEDER",
  "CLINIC_LICENSE",
  "BUSINESS",
  "PET_DOCUMENTS",
  "HEALTH",
] as const;
export type VerificationType = (typeof VERIFICATION_TYPE)[number];

export const DISPUTE_REASON = [
  "NOT_AS_DESCRIBED",
  "NOT_DELIVERED",
  "HEALTH_ISSUE",
  "FRAUD",
  "DAMAGED",
  "OTHER",
] as const;
export type DisputeReason = (typeof DISPUTE_REASON)[number];

export const DISPUTE_REASON_LABEL: Record<DisputeReason, string> = {
  NOT_AS_DESCRIBED: "Not as described",
  NOT_DELIVERED: "Never received",
  HEALTH_ISSUE: "Undisclosed health problem",
  FRAUD: "Fraud",
  DAMAGED: "Arrived damaged",
  OTHER: "Something else",
};

export const DISPUTE_STATUS = [
  "OPEN",
  "AWAITING_RESPONSE",
  "IN_REVIEW",
  "RESOLVED_BUYER",
  "RESOLVED_SELLER",
  "RESOLVED_SPLIT",
  "WITHDRAWN",
] as const;
export type DisputeStatus = (typeof DISPUTE_STATUS)[number];

export const DISPUTE_STATUS_LABEL: Record<DisputeStatus, string> = {
  OPEN: "Open",
  AWAITING_RESPONSE: "Awaiting a response",
  IN_REVIEW: "Under review",
  RESOLVED_BUYER: "Resolved for the buyer",
  RESOLVED_SELLER: "Resolved for the seller",
  RESOLVED_SPLIT: "Resolved — split",
  WITHDRAWN: "Withdrawn",
};

/**
 * Trust signal weights. Positive earns trust, negative removes it.
 * Exposed on the profile so a score is always explainable.
 */
export const TRUST_WEIGHTS = {
  EMAIL_VERIFIED: 8,
  PHONE_VERIFIED: 6,
  ID_VERIFIED: 20,
  ADDRESS_VERIFIED: 6,
  BREEDER_VERIFIED: 15,
  CLINIC_VERIFIED: 15,
  PROFILE_COMPLETE: 5,
  FIRST_PET_ADDED: 3,
  PET_DOCUMENTED: 4,
  SALE_COMPLETED: 5,
  PURCHASE_COMPLETED: 2,
  APPOINTMENT_COMPLETED: 2,
  REVIEW_RECEIVED_POSITIVE: 3,
  REVIEW_RECEIVED_NEGATIVE: -6,
  ACCOUNT_AGE_90D: 5,
  DISPUTE_LOST: -20,
  REPORT_UPHELD: -25,
  LISTING_REJECTED: -8,
  PAYMENT_FAILED_REPEATEDLY: -5,
} as const;
export type TrustSignalKind = keyof typeof TRUST_WEIGHTS;

export const TRUST_SIGNAL_LABEL: Record<TrustSignalKind, string> = {
  EMAIL_VERIFIED: "Email verified",
  PHONE_VERIFIED: "Phone verified",
  ID_VERIFIED: "Government ID verified",
  ADDRESS_VERIFIED: "Address verified",
  BREEDER_VERIFIED: "Verified breeder",
  CLINIC_VERIFIED: "Verified clinic",
  PROFILE_COMPLETE: "Complete profile",
  FIRST_PET_ADDED: "Pet profile created",
  PET_DOCUMENTED: "Pet documents uploaded",
  SALE_COMPLETED: "Completed sale",
  PURCHASE_COMPLETED: "Completed purchase",
  APPOINTMENT_COMPLETED: "Completed vet appointment",
  REVIEW_RECEIVED_POSITIVE: "Positive review",
  REVIEW_RECEIVED_NEGATIVE: "Negative review",
  ACCOUNT_AGE_90D: "Established account",
  DISPUTE_LOST: "Lost a dispute",
  REPORT_UPHELD: "Upheld report",
  LISTING_REJECTED: "Rejected listing",
  PAYMENT_FAILED_REPEATEDLY: "Repeated payment failures",
};

export type TrustTier = "NEW" | "BRONZE" | "SILVER" | "GOLD" | "PLATINUM";

export function trustTier(score: number): TrustTier {
  if (score >= 80) return "PLATINUM";
  if (score >= 60) return "GOLD";
  if (score >= 40) return "SILVER";
  if (score >= 20) return "BRONZE";
  return "NEW";
}

export const TRUST_TIER_LABEL: Record<TrustTier, string> = {
  NEW: "New member",
  BRONZE: "Bronze",
  SILVER: "Silver",
  GOLD: "Gold",
  PLATINUM: "Platinum",
};

// ---------------------------------------------------------------------------
// Messaging & notifications
// ---------------------------------------------------------------------------

export const CONVERSATION_TYPE = [
  "DIRECT",
  "LISTING",
  "BREEDING",
  "ORDER",
  "APPOINTMENT",
  "ADOPTION",
  "SUPPORT",
  "DISPUTE",
] as const;
export type ConversationType = (typeof CONVERSATION_TYPE)[number];

export const NOTIFICATION_CATEGORY = [
  "MESSAGE",
  "LISTING",
  "ORDER",
  "PAYMENT",
  "APPOINTMENT",
  "BREEDING",
  "ADOPTION",
  "HEALTH",
  "DELIVERY",
  "SECURITY",
  "SYSTEM",
  "MARKETING",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORY)[number];

export const NOTIFICATION_CATEGORY_LABEL: Record<NotificationCategory, string> = {
  MESSAGE: "Messages",
  LISTING: "My listings",
  ORDER: "Orders",
  PAYMENT: "Payments",
  APPOINTMENT: "Appointments",
  BREEDING: "Breeding",
  ADOPTION: "Adoption",
  HEALTH: "Pet health",
  DELIVERY: "Delivery",
  SECURITY: "Security",
  SYSTEM: "Platform updates",
  MARKETING: "Tips and offers",
};

/** Security notifications are not optional; the user cannot turn them off. */
export const MANDATORY_NOTIFICATION_CATEGORIES: NotificationCategory[] = ["SECURITY"];

// ---------------------------------------------------------------------------
// Shared limits
// ---------------------------------------------------------------------------

export const LIMITS = {
  nameMax: 80,
  titleMax: 120,
  descriptionMax: 5000,
  messageMax: 4000,
  bioMax: 600,
  photosPerPet: 12,
  imagesPerProduct: 8,
  maxUploadBytes: 8 * 1024 * 1024,
  maxDocumentBytes: 15 * 1024 * 1024,
  pageSizeDefault: 24,
  pageSizeMax: 60,
  /** Prices above this need review; guards against a tampered or fat-fingered price. */
  maxPriceCents: 5_000_000_00,
} as const;

export const CURRENCIES = ["USD", "EUR", "GBP", "AED", "EGP", "SAR"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const CURRENCY_SYMBOL: Record<Currency, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  AED: "AED ",
  EGP: "EGP ",
  SAR: "SAR ",
};
