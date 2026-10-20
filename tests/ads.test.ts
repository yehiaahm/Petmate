import { describe, it, expect, beforeEach } from "vitest";
import { db, makeUser, resetDatabase } from "./helpers";
import {
  createAdCampaign,
  reviewAdCampaign,
  selectAd,
  recordImpression,
  recordClick,
  completeCampaign,
  settleFinishedCampaigns,
  cancelDraft,
  setCampaignPaused,
  adSpend,
  impressionsForBudget,
} from "@/lib/services/ad.service";
import { confirmPayment } from "@/lib/payments/service";
import { getBalance, accounts } from "@/lib/payments/ledger-core";
import { getSettings } from "@/lib/settings";
import { startOfZonedDay, endOfZonedDay, zonedToday } from "@/lib/timezone";
import { addDays } from "@/lib/utils";

/**
 * Advertising takes money up front and bills it back impression by impression,
 * so the tests follow the money: charged in full, billed at the bought price,
 * never above the budget, and the rest returned when the campaign ends.
 */

async function ledgerSum(): Promise<number> {
  return (await db.ledgerEntry.aggregate({ _sum: { amountCents: true } }))._sum.amountCents ?? 0;
}

const day = (offset: number) => zonedToday(undefined, addDays(new Date(), offset));

const campaign = (overrides: Record<string, unknown> = {}) => ({
  name: "Spring grooming offer",
  slot: "HOME_HERO" as const,
  headline: "20% off grooming in Maadi this month",
  destinationUrl: "https://groomers.example/offer",
  budgetCents: 100_000,
  startDate: day(0),
  endDate: day(14),
  ...overrides,
});

async function paidCampaign(overrides: Record<string, unknown> = {}) {
  const advertiser = await makeUser({ name: "Advertiser" });
  const { campaign: created, payment } = await createAdCampaign(advertiser.auth, campaign(overrides), "key-12345678");
  await confirmPayment({ intentId: payment.id, actorId: advertiser.id, viaSandbox: true });
  return { advertiser, campaignId: created.id, paymentId: payment.id };
}

async function runningCampaign(overrides: Record<string, unknown> = {}) {
  const paid = await paidCampaign(overrides);
  const admin = await makeUser({ roles: ["ADMIN"] });
  await reviewAdCampaign(admin.auth, paid.campaignId, "APPROVE", "Meets the policy.");
  return { ...paid, admin };
}

beforeEach(async () => {
  await resetDatabase();
});

describe("pricing arithmetic", () => {
  it("bills per thousand and never above the budget", () => {
    expect(adSpend(1000, 6000, 1_000_000)).toBe(6000);
    expect(adSpend(1, 6000, 1_000_000)).toBe(6);
    expect(adSpend(999, 1, 1_000_000)).toBe(0);
    expect(adSpend(10_000_000, 6000, 50_000)).toBe(50_000);
    expect(impressionsForBudget(60_000, 6000)).toBe(10_000);
  });

  it("reads campaign dates as whole days in Cairo", () => {
    // Cairo is ahead of UTC, so its midnight is the previous evening in UTC.
    const start = startOfZonedDay("2026-01-15", "Africa/Cairo");
    expect(start.toISOString()).toBe("2026-01-14T22:00:00.000Z");
    expect(endOfZonedDay("2026-01-15", "Africa/Cairo").toISOString()).toBe("2026-01-15T22:00:00.000Z");
    // Summer time (UTC+3).
    expect(startOfZonedDay("2026-07-15", "Africa/Cairo").toISOString()).toBe("2026-07-14T21:00:00.000Z");
  });
});

describe("buying a campaign", () => {
  it("fixes the price when bought and waits for review once paid", async () => {
    const { campaignId } = await paidCampaign();
    const settings = await getSettings();
    const row = await db.adCampaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(row.status).toBe("PENDING_REVIEW");
    expect(row.cpmCents).toBe(settings.adCpmHomeCents);
    expect(await getBalance(accounts.platformRevenue())).toBe(100_000);
    expect(await ledgerSum()).toBe(0);
    // Nothing is served until a person approves it.
    expect(await selectAd("HOME_HERO")).toBeNull();
  });

  it("refuses a budget below the minimum, a past start and an unsafe link", async () => {
    const advertiser = await makeUser();
    await expect(createAdCampaign(advertiser.auth, campaign({ budgetCents: 100 }), "k-00000001")).rejects.toThrow(/smallest budget/);
    await expect(createAdCampaign(advertiser.auth, campaign({ startDate: day(-3) }), "k-00000002")).rejects.toThrow(/past/);
    await expect(
      createAdCampaign(advertiser.auth, campaign({ destinationUrl: "javascript:alert(1)" }), "k-00000003"),
    ).rejects.toThrow(/highlighted fields/);
    await expect(
      createAdCampaign(advertiser.auth, campaign({ destinationUrl: "//evil.example" }), "k-00000004"),
    ).rejects.toThrow(/highlighted fields/);
    await expect(createAdCampaign(advertiser.auth, campaign({ endDate: day(120) }), "k-00000005")).rejects.toThrow(
      /highlighted fields/,
    );
  });

  it("refunds a rejected campaign in full", async () => {
    const { campaignId, paymentId } = await paidCampaign();
    const admin = await makeUser({ roles: ["ADMIN"] });
    await reviewAdCampaign(admin.auth, campaignId, "REJECT", "Health claims are not allowed.");
    const intent = await db.paymentIntent.findUniqueOrThrow({ where: { id: paymentId } });
    expect(intent.status).toBe("REFUNDED");
    expect(await getBalance(accounts.platformRevenue())).toBe(0);
    await expect(reviewAdCampaign(admin.auth, campaignId, "APPROVE", "Changed my mind.")).rejects.toThrow(/already been reviewed/);
  });

  it("refunds a payment for a draft that was discarded", async () => {
    const advertiser = await makeUser();
    const { campaign: created, payment } = await createAdCampaign(advertiser.auth, campaign(), "key-abcdefgh");
    await cancelDraft(advertiser.auth, created.id);
    await confirmPayment({ intentId: payment.id, actorId: advertiser.id, viaSandbox: true });
    expect((await db.paymentIntent.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("REFUNDED");
    expect((await db.adCampaign.findUniqueOrThrow({ where: { id: created.id } })).status).toBe("CANCELLED");
    expect(await ledgerSum()).toBe(0);
  });
});

describe("serving and billing", () => {
  it("serves an approved campaign and counts a visitor once", async () => {
    const { campaignId } = await runningCampaign();
    const served = await selectAd("HOME_HERO");
    expect(served?.id).toBe(campaignId);
    expect(served?.external).toBe(true);
    expect(await selectAd("SEARCH_INLINE")).toBeNull();

    expect((await recordImpression(campaignId, "visitor-a", "10.0.0.1")).counted).toBe(true);
    expect((await recordImpression(campaignId, "visitor-a", "10.0.0.1")).counted).toBe(false);
    expect((await recordImpression(campaignId, "visitor-b", "10.0.0.1")).counted).toBe(true);

    const row = await db.adCampaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(row.impressions).toBe(2);
    expect(row.spentCents).toBe(adSpend(2, row.cpmCents, row.budgetCents));

    expect(await recordClick(campaignId, "visitor-a")).toBe("https://groomers.example/offer");
    expect(await recordClick(campaignId, "visitor-a")).toBe("https://groomers.example/offer");
    expect((await db.adCampaign.findUniqueOrThrow({ where: { id: campaignId } })).clicks).toBe(1);
  });

  it("does not serve or bill a paused campaign", async () => {
    const { campaignId, advertiser } = await runningCampaign();
    await setCampaignPaused(advertiser.auth, campaignId, true);
    expect(await selectAd("HOME_HERO")).toBeNull();
    expect((await recordImpression(campaignId, "visitor-a", null)).counted).toBe(false);
    await setCampaignPaused(advertiser.auth, campaignId, false);
    expect((await selectAd("HOME_HERO"))?.id).toBe(campaignId);
  });

  it("gives no destination for a campaign that never ran", async () => {
    const { campaignId } = await paidCampaign();
    expect(await recordClick(campaignId, "visitor-a")).toBeNull();
  });

  it("closes itself once the budget is delivered", async () => {
    const settings = await getSettings();
    const { campaignId, advertiser } = await runningCampaign({ budgetCents: settings.adMinBudgetCents });
    const row = await db.adCampaign.findUniqueOrThrow({ where: { id: campaignId } });
    const needed = Math.ceil((row.budgetCents * 1000) / row.cpmCents);
    // Deliver all but the last impression directly, then the last through the real path.
    await db.adCampaign.update({ where: { id: campaignId }, data: { impressions: needed - 1 } });
    await recordImpression(campaignId, "last-visitor", null);

    const done = await db.adCampaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(done.status).toBe("COMPLETED");
    expect(done.spentCents).toBe(done.budgetCents);
    expect(done.returnedCents).toBe(0);
    expect(await getBalance(accounts.userAvailable(advertiser.id))).toBe(0);
  });
});

describe("ending a campaign", () => {
  it("returns what was not delivered to the advertiser's wallet, once", async () => {
    const { campaignId, advertiser } = await runningCampaign();
    await db.adCampaign.update({ where: { id: campaignId }, data: { impressions: 5000 } });
    const row = await db.adCampaign.findUniqueOrThrow({ where: { id: campaignId } });
    const spent = adSpend(5000, row.cpmCents, row.budgetCents);

    const first = await completeCampaign(campaignId, "ENDED_BY_ADVERTISER", advertiser.id);
    expect(first.returnedCents).toBe(row.budgetCents - spent);
    const second = await completeCampaign(campaignId, "END_DATE");
    expect(second.returnedCents).toBe(0);

    expect(await getBalance(accounts.userAvailable(advertiser.id))).toBe(row.budgetCents - spent);
    expect(await getBalance(accounts.platformRevenue())).toBe(spent);
    expect(await ledgerSum()).toBe(0);
  });

  it("is closed by the job after its end date", async () => {
    const { campaignId } = await runningCampaign();
    await db.adCampaign.update({ where: { id: campaignId }, data: { endAt: new Date(Date.now() - 1000) } });
    expect(await settleFinishedCampaigns()).toBe(1);
    expect((await db.adCampaign.findUniqueOrThrow({ where: { id: campaignId } })).status).toBe("COMPLETED");
    expect(await selectAd("HOME_HERO")).toBeNull();
  });
});

describe("pacing", () => {
  it("serves the campaign furthest behind its schedule", async () => {
    const a = await runningCampaign({ name: "Campaign A" });
    const b = await runningCampaign({ name: "Campaign B" });
    // A has already spent a large share of its budget; B has spent nothing.
    await db.adCampaign.update({ where: { id: a.campaignId }, data: { spentCents: 60_000 } });
    for (let i = 0; i < 5; i++) {
      expect((await selectAd("HOME_HERO"))?.id).toBe(b.campaignId);
    }
  });
});
