import "server-only";
import { db, type DbClient } from "@/lib/db";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import type { AuthContext } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { formatMoney } from "@/lib/money";
import { clientEnv } from "@/lib/env";
import { PLATFORM_CURRENCY } from "@/lib/currency";
import { readableCode } from "@/lib/utils";
import { accounts, postTransaction } from "@/lib/payments/ledger-core";
import { issueWelcomeCoupon } from "./coupon.service";
import { notify } from "./notification.service";

/**
 * Invite a friend.
 *
 * The new member gets a personal first-order discount straight away. The
 * member who invited them is paid (wallet credit) only once that first order
 * has been delivered and has stayed un-refunded for two weeks, and only if the
 * new account has a verified phone — a number can verify one account, which
 * is what makes a farm of fake invitees expensive. Both are paid for by
 * PetMate from the promotions account.
 */

export const REFERRAL_COOKIE = "pm_ref";
export const REFERRAL_COOKIE_DAYS = 30;
const QUALIFY_AFTER_DAYS = 14;

/** A member's invite code, created the first time they ask for it. */
export async function ensureReferralCode(userId: string): Promise<string> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { referralCode: true } });
  if (user.referralCode) return user.referralCode;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = readableCode(7);
    const { count } = await db.user.updateMany({ where: { id: userId, referralCode: null }, data: { referralCode: code } });
    if (count === 1) return code;
    const current = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { referralCode: true } });
    if (current.referralCode) return current.referralCode;
  }
  throw new Error("could not allocate a referral code");
}

export const isReferralCode = (value: string | null | undefined): value is string =>
  typeof value === "string" && /^[A-Z0-9]{5,12}$/.test(value);

/**
 * Records who invited a brand-new account. Called once, right after the
 * account is created, with the code from the invite cookie. Silently does
 * nothing for an unknown code, a self-invite or a closed inviter: a bad
 * cookie must never stop someone signing up.
 */
export async function recordReferral(refereeId: string, code: string | null | undefined, client: DbClient = db) {
  if (!isReferralCode(code)) return null;
  const settings = await getSettings();
  if (!settings.referralEnabled) return null;

  const referrer = await client.user.findUnique({
    where: { referralCode: code },
    select: { id: true, status: true, deletedAt: true },
  });
  if (!referrer || referrer.id === refereeId || referrer.deletedAt || referrer.status === "BANNED") return null;

  try {
    await client.referral.create({ data: { referrerId: referrer.id, refereeId } });
  } catch (e) {
    // Unique on refereeId: an account is only ever referred once.
    logger.warn("referral not recorded", { refereeId, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
  const welcome = await issueWelcomeCoupon(client, refereeId);
  return { referrerId: referrer.id, welcomeCode: welcome.code };
}

/**
 * Run by the `referrals.qualify` job. Pays inviters whose invitee's first
 * qualifying order has been delivered long enough ago to be past the point
 * where it is likely to be refunded.
 */
export async function qualifyReferrals(now = new Date()): Promise<number> {
  const settings = await getSettings();
  if (!settings.referralEnabled) return 0;
  const cutoff = new Date(now.getTime() - QUALIFY_AFTER_DAYS * 86_400_000);

  const pending = await db.referral.findMany({
    where: { status: "PENDING", createdAt: { lt: now } },
    select: { id: true, referrerId: true, refereeId: true },
    take: 200,
  });

  let rewarded = 0;
  for (const referral of pending) {
    const referee = await db.user.findUnique({
      where: { id: referral.refereeId },
      select: { phoneVerifiedAt: true, status: true, deletedAt: true },
    });
    if (!referee || referee.deletedAt || referee.status === "BANNED") {
      await db.referral.updateMany({ where: { id: referral.id, status: "PENDING" }, data: { status: "VOID", voidReason: "account closed" } });
      continue;
    }
    if (!referee.phoneVerifiedAt) continue;

    const order = await db.order.findFirst({
      where: {
        buyerId: referral.refereeId,
        status: "DELIVERED",
        subtotalCents: { gte: settings.referralMinOrderCents },
        placedAt: { lt: cutoff },
      },
      orderBy: { placedAt: "asc" },
      select: { id: true, orderNumber: true },
    });
    if (!order) continue;

    const recent = await db.referral.count({
      where: { referrerId: referral.referrerId, status: "REWARDED", rewardedAt: { gt: new Date(now.getTime() - 30 * 86_400_000) } },
    });
    if (recent >= settings.referralMonthlyCap) continue; // tried again next run, once the window moves

    const reward = settings.referralRewardCents;
    const paid = await db.$transaction(async (tx) => {
      const claimed = await tx.referral.updateMany({
        where: { id: referral.id, status: "PENDING" },
        data: { status: "REWARDED", rewardCents: reward, qualifyingOrder: order.id, rewardedAt: now },
      });
      if (claimed.count === 0) return false;
      if (reward > 0) {
        await postTransaction(
          {
            kind: "ADJUSTMENT",
            description: `Referral reward for order ${order.orderNumber}`,
            currency: PLATFORM_CURRENCY,
            referenceType: "REFERRAL",
            referenceId: referral.id,
            entries: [
              { account: accounts.platformPromotions(PLATFORM_CURRENCY), amountCents: -reward },
              { account: accounts.userAvailable(referral.referrerId, PLATFORM_CURRENCY), amountCents: reward },
            ],
          },
          tx,
        );
      }
      await audit(
        { action: "referral.rewarded", entityType: "REFERRAL", entityId: referral.id, actorId: referral.referrerId, summary: String(reward) },
        tx,
      );
      return true;
    });
    if (!paid) continue;

    rewarded++;
    await notify({
      userId: referral.referrerId,
      category: "PAYMENT",
      type: "referral.rewarded",
      title: `${formatMoney(reward, PLATFORM_CURRENCY)} added to your wallet`,
      body: "Someone you invited to PetMate has had their first order delivered. Thank you for spreading the word.",
      url: "/dashboard/referrals",
    });
  }
  return rewarded;
}

export async function getReferralDashboard(auth: AuthContext) {
  const [code, settings, referrals] = await Promise.all([
    ensureReferralCode(auth.user.id),
    getSettings(),
    db.referral.findMany({
      where: { referrerId: auth.user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, status: true, rewardCents: true, createdAt: true, rewardedAt: true, refereeId: true },
    }),
  ]);
  const names = new Map(
    (
      await db.user.findMany({
        where: { id: { in: referrals.map((r) => r.refereeId) } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );

  return {
    code,
    link: `${clientEnv.NEXT_PUBLIC_APP_URL}/r/${code}`,
    enabled: settings.referralEnabled,
    rewardCents: settings.referralRewardCents,
    welcomeBps: settings.referralWelcomeBps,
    welcomeMaxCents: settings.referralWelcomeMaxCents,
    minOrderCents: settings.referralMinOrderCents,
    earnedCents: referrals.reduce((a, r) => a + (r.status === "REWARDED" ? r.rewardCents : 0), 0),
    referrals: referrals.map((r) => ({
      id: r.id,
      status: r.status,
      rewardCents: r.rewardCents,
      createdAt: r.createdAt,
      rewardedAt: r.rewardedAt,
      // First name only: the inviter knows who they invited; nobody else needs more.
      name: (names.get(r.refereeId) ?? "").split(/\s+/)[0] || "—",
    })),
  };
}
