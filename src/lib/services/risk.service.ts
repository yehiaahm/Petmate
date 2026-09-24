import "server-only";
import { db } from "@/lib/db";
import { normalizeSearchText } from "@/lib/search/text";

/**
 * Risk signals.
 *
 * Deterministic heuristics, not a model, and the code says so. Each rule exists
 * because it maps to a real scam pattern on pet classifieds:
 *
 *   * a brand-new account listing an expensive animal — the classic advance-fee
 *     scam, where the "deposit" is the whole point
 *   * a price far below the market for the breed — bait for an off-platform
 *     payment
 *   * contact details in the description — the seller trying to move the
 *     conversation somewhere with no escrow and no recourse
 *   * many listings created in minutes — a listing farm
 *
 * A score does not block anything by itself. It routes a listing to human
 * review, which is the only honest thing to do with a heuristic.
 */

export interface RiskAssessment {
  score: number;
  reasons: string[];
  primaryType: string;
}

const CONTACT_PATTERNS: { pattern: RegExp; reason: string; weight: number }[] = [
  {
    pattern: /\b(?:\+?\d[\d\s().-]{7,}\d)\b/,
    reason: "Phone number in the description",
    weight: 25,
  },
  {
    pattern: /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/,
    reason: "Email address in the description",
    weight: 25,
  },
  {
    pattern: /\b(whats\s?app|telegram|wechat|viber|signal|instagram|snapchat|dm\s+me)\b/i,
    reason: "Asks to move the conversation off-platform",
    weight: 30,
  },
  {
    pattern: /\b(western\s?union|money\s?gram|gift\s?card|crypto|bitcoin|usdt|zelle|cash\s?app)\b/i,
    reason: "Mentions an untraceable payment method",
    weight: 45,
  },
  {
    pattern: /\b(shipping\s+agent|pet\s+courier\s+fee|delivery\s+deposit|customs\s+fee)\b/i,
    reason: "Mentions an upfront shipping or customs fee",
    weight: 40,
  },
  {
    pattern: /\b(free\s+to\s+good\s+home|just\s+pay\s+shipping)\b/i,
    reason: "Classic advance-fee framing",
    weight: 35,
  },
];

export async function scoreListingRisk(params: {
  sellerId: string;
  priceCents: number;
  species: string;
  title: string;
  description: string;
}): Promise<RiskAssessment> {
  const reasons: string[] = [];
  let score = 0;
  let primaryType = "LISTING_REVIEW";

  const text = `${params.title} ${params.description}`;

  for (const rule of CONTACT_PATTERNS) {
    if (rule.pattern.test(text)) {
      score += rule.weight;
      reasons.push(rule.reason);
      primaryType = "OFF_PLATFORM_CONTACT";
    }
  }

  const seller = await db.user.findUnique({
    where: { id: params.sellerId },
    select: { createdAt: true, trustScore: true, emailVerifiedAt: true, completedSales: true },
  });

  if (seller) {
    const accountAgeDays = (Date.now() - seller.createdAt.getTime()) / 86_400_000;

    if (accountAgeDays < 2 && params.priceCents > 100_000) {
      score += 35;
      reasons.push("New account listing a high-value pet");
      primaryType = "NEW_ACCOUNT_HIGH_VALUE";
    } else if (accountAgeDays < 7 && params.priceCents > 300_000) {
      score += 25;
      reasons.push("Recent account listing a high-value pet");
      primaryType = "NEW_ACCOUNT_HIGH_VALUE";
    }

    if (!seller.emailVerifiedAt) {
      score += 15;
      reasons.push("Email address not confirmed");
    }

    if (seller.trustScore < 10 && seller.completedSales === 0) {
      score += 10;
      reasons.push("No trust history");
    }
  }

  // A listing farm: many listings in a very short window.
  const recentListings = await db.listing.count({
    where: { sellerId: params.sellerId, createdAt: { gte: new Date(Date.now() - 3_600_000) } },
  });
  if (recentListings >= 5) {
    score += 30;
    reasons.push(`${recentListings} listings created in the last hour`);
    primaryType = "RAPID_LISTING";
  }

  // Price far below the going rate for the species is bait.
  if (params.priceCents > 0) {
    const median = await medianPriceForSpecies(params.species);
    if (median && params.priceCents < median * 0.2 && median > 20_000) {
      score += 25;
      reasons.push("Priced far below similar listings");
      primaryType = "PRICE_ANOMALY";
    }
  }

  const normalized = normalizeSearchText(params.description);
  if (normalized.length < 60) {
    score += 10;
    reasons.push("Very short description");
  }

  return { score: Math.min(100, score), reasons, primaryType };
}

async function medianPriceForSpecies(species: string): Promise<number | null> {
  const rows = await db.listing.findMany({
    where: {
      status: "ACTIVE",
      intent: "SALE",
      priceCents: { gt: 0 },
      pet: { species },
    },
    select: { priceCents: true },
    orderBy: { priceCents: "asc" },
    take: 500,
  });

  if (rows.length < 8) return null;
  const mid = Math.floor(rows.length / 2);
  return rows.length % 2 === 0
    ? Math.round(((rows[mid - 1]?.priceCents ?? 0) + (rows[mid]?.priceCents ?? 0)) / 2)
    : (rows[mid]?.priceCents ?? null);
}

/**
 * Message-level check. Applied as the message is sent so the warning reaches
 * the recipient in context, which is where it actually changes behaviour.
 */
export function scoreMessageRisk(body: string): { flagged: boolean; reason: string | null } {
  const rules: [RegExp, string][] = [
    [/\b(western\s?union|money\s?gram|gift\s?card|bitcoin|crypto|usdt)\b/i, "untraceable payment method"],
    [/\b(pay(?:ment)?\s+(?:outside|off)\s+(?:the\s+)?(?:app|site|platform))\b/i, "payment outside PetMate"],
    [/\b(send\s+(?:the\s+)?deposit\s+(?:first|now|today))\b/i, "upfront deposit request"],
    [/\b(shipping\s+(?:agent|company)\s+will\s+contact)\b/i, "third-party shipping agent"],
  ];

  for (const [pattern, reason] of rules) {
    if (pattern.test(body)) return { flagged: true, reason };
  }
  return { flagged: false, reason: null };
}

export async function recordRiskEvent(params: {
  userId?: string;
  type: string;
  score: number;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  await db.riskEvent.create({
    data: {
      userId: params.userId ?? null,
      type: params.type,
      score: params.score,
      entityType: params.entityType ?? null,
      entityId: params.entityId ?? null,
      details: params.details ? JSON.stringify(params.details) : null,
    },
  });
}
