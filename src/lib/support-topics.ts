/**
 * Support topic vocabulary.
 *
 * Deliberately in its own module with no imports: both the server service and
 * client components need these labels, and pulling them from the service would
 * drag `server-only`, Prisma and the session module into the browser bundle.
 */

export const SUPPORT_TOPICS = [
  "ACCOUNT",
  "PAYMENT",
  "LISTING",
  "SAFETY",
  "CLINIC",
  "TECHNICAL",
  "OTHER",
] as const;

export type SupportTopic = (typeof SUPPORT_TOPICS)[number];

export const SUPPORT_TOPIC_LABEL: Record<SupportTopic, string> = {
  ACCOUNT: "Account & sign-in",
  PAYMENT: "Payments, escrow & refunds",
  LISTING: "Listings & orders",
  SAFETY: "Trust, safety & animal welfare",
  CLINIC: "Clinic or shop partner",
  TECHNICAL: "Something is broken",
  OTHER: "Something else",
};

export const SUPPORT_STATUS_LABEL: Record<string, string> = {
  OPEN: "With support",
  AWAITING_USER: "Waiting on you",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};
