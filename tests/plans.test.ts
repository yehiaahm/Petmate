import { describe, it, expect, beforeEach } from "vitest";
import {
  db,
  makeUser,
  makePet,
  makeListing,
  makeShopWithProduct,
  makeClinicWithService,
  resetDatabase,
  subscribeUser,
} from "./helpers";
import {
  clampVisibilityBoost,
  getVisibilityBoosts,
  MAX_VISIBILITY_BOOST,
} from "@/lib/billing/entitlements";
import { rankScore, searchListings } from "@/lib/services/search.service";
import { productRankScore, searchProducts } from "@/lib/services/commerce.service";
import { bookAppointment, getAvailability, clinicRankScore, searchClinics } from "@/lib/services/vet.service";
import {
  createSupportTicket,
  initialTicketPriority,
  listSupportQueue,
} from "@/lib/services/support.service";
import { getSettings } from "@/lib/settings";
import { applyBps } from "@/lib/money";
import { addDays } from "@/lib/utils";

/**
 * Every line on the pricing page that describes a paid benefit has a test
 * here, because a plan that charges for something the code does not do is a
 * refund request waiting to happen.
 */

describe("visibility boost", () => {
  it("is clamped so a bad plan row cannot bury organic results", () => {
    expect(clampVisibilityBoost(14)).toBe(MAX_VISIBILITY_BOOST);
    expect(clampVisibilityBoost(0.2)).toBe(1);
    expect(clampVisibilityBoost("1.4")).toBe(1);
    expect(clampVisibilityBoost(Number.NaN)).toBe(1);
    expect(clampVisibilityBoost(1.3)).toBe(1.3);
  });

  it("multiplies the listing score rather than overriding quality", () => {
    const base = {
      featured: false,
      publishedAt: new Date(),
      healthScore: 80,
      verificationLevel: "DOCUMENTED",
      sellerTrust: 70,
      favoriteCount: 3,
      distanceKm: null,
      relevance: 0,
      now: new Date(),
    };
    const free = rankScore(base);
    const boosted = rankScore({ ...base, planBoost: 1.4 });
    expect(boosted).toBeCloseTo(free * 1.4, 6);

    // A boosted listing with nothing going for it still loses to a strong one.
    const weakBoosted = rankScore({
      ...base,
      healthScore: 0,
      verificationLevel: "NONE",
      sellerTrust: 0,
      favoriteCount: 0,
      publishedAt: addDays(new Date(), -60),
      planBoost: MAX_VISIBILITY_BOOST,
    });
    expect(weakBoosted).toBeLessThan(free);
  });

  it("applies the same rule to products and clinics", () => {
    const product = {
      soldCount: 20,
      ratingAvgBps: 450,
      ratingCount: 12,
      inStock: true,
      verifiedShop: true,
      relevance: 0,
    };
    expect(productRankScore({ ...product, planBoost: 1.3 })).toBeCloseTo(productRankScore(product) * 1.3, 6);
    expect(productRankScore({ ...product, inStock: false })).toBeLessThan(productRankScore(product));

    const clinic = { verified: true, ratingAvgBps: 470, ratingCount: 30, bookingCount: 100, distanceKm: 3 };
    expect(clinicRankScore({ ...clinic, planBoost: 1.5 })).toBeCloseTo(clinicRankScore(clinic) * 1.5, 6);
  });

  describe("against the database", () => {
    beforeEach(async () => {
      await resetDatabase();
    });

    it("reads every seller's boost in one pass and keeps the best live plan", async () => {
      const a = await makeUser();
      const b = await makeUser();
      const c = await makeUser();
      await subscribeUser(a.id, { visibilityBoost: 1.2 });
      await subscribeUser(a.id, { visibilityBoost: 1.4 });
      await subscribeUser(b.id, { visibilityBoost: 99 });

      // An expired plan buys nothing.
      const expired = await subscribeUser(c.id, { visibilityBoost: 1.4 });
      await db.subscription.updateMany({
        where: { userId: c.id, planId: expired },
        data: { currentPeriodEnd: addDays(new Date(), -1) },
      });

      const boosts = await getVisibilityBoosts([a.id, b.id, c.id]);
      expect(boosts.get(a.id)).toBe(1.4);
      expect(boosts.get(b.id)).toBe(MAX_VISIBILITY_BOOST);
      expect(boosts.has(c.id)).toBe(false);
    });

    it("ranks an identical listing higher when its seller pays for visibility", async () => {
      const free = await makeUser({ trustScore: 50 });
      const paid = await makeUser({ trustScore: 50 });
      await subscribeUser(paid.id, { visibilityBoost: 1.4 });

      const freeListing = await makeListing(free.id, (await makePet(free.id, { healthScore: 60 })).id);
      const paidListing = await makeListing(paid.id, (await makePet(paid.id, { healthScore: 60 })).id);

      const results = await searchListings({ intent: "SALE", sort: "relevance" });
      const ids = results.items.map((l) => l.id);
      expect(ids.indexOf(paidListing.id)).toBeLessThan(ids.indexOf(freeListing.id));

      // A price sort is what the buyer asked for; the plan does not reorder it.
      const byPrice = await searchListings({ intent: "SALE", sort: "price_asc" });
      expect(byPrice.items.map((l) => l.id).sort()).toEqual([freeListing.id, paidListing.id].sort());
    });

    it("ranks a Seller Pro shop's product higher in the default product order", async () => {
      const free = await makeUser();
      const paid = await makeUser();
      await subscribeUser(paid.id, { visibilityBoost: 1.3 });

      const freeShop = await makeShopWithProduct(free.id);
      const paidShop = await makeShopWithProduct(paid.id);

      const results = await searchProducts({});
      const ids = results.items.map((p) => p.id);
      expect(ids.indexOf(paidShop.productId)).toBeLessThan(ids.indexOf(freeShop.productId));
      // The owner id is used for ranking only and never leaves the service.
      expect(results.items[0]!.shop).not.toHaveProperty("ownerUserId");
    });

    it("labels and lifts a Clinic Pro practice in clinic search", async () => {
      const free = await makeUser();
      const paid = await makeUser();
      await subscribeUser(paid.id, { visibilityBoost: 1.5 });

      const freeClinic = await makeClinicWithService(free.id);
      const paidClinic = await makeClinicWithService(paid.id);

      const results = await searchClinics({});
      expect(results.items[0]!.id).toBe(paidClinic.clinicId);
      expect(results.items.find((c) => c.id === paidClinic.clinicId)!.featured).toBe(true);
      expect(results.items.find((c) => c.id === freeClinic.clinicId)!.featured).toBe(false);
      expect(results.items[0]).not.toHaveProperty("ownerUserId");
    });
  });
});

describe("commission discounts", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function bookFirstSlot(clinicOwnerId: string) {
    const clinic = await makeClinicWithService(clinicOwnerId);
    const owner = await makeUser();
    const pet = await makePet(owner.id);

    const slots = await getAvailability({
      clinicId: clinic.clinicId,
      serviceId: clinic.serviceId,
      from: addDays(new Date(), 1),
      days: 3,
      vetId: clinic.vetId,
    });
    expect(slots.length).toBeGreaterThan(0);

    const appointment = await bookAppointment(owner.auth, {
      clinicId: clinic.clinicId,
      serviceId: clinic.serviceId,
      vetId: clinic.vetId,
      petId: pet.id,
      startAt: slots[0]!.startAt,
    });

    return db.appointment.findUniqueOrThrow({
      where: { id: appointment.id },
      select: { priceCents: true, commissionCents: true },
    });
  }

  it("charges a free clinic the standard booking commission", async () => {
    const clinicOwner = await makeUser();
    const booked = await bookFirstSlot(clinicOwner.id);
    const settings = await getSettings();
    expect(booked.commissionCents).toBe(applyBps(booked.priceCents, settings.commissionAppointmentBps));
  });

  it("gives a Clinic Pro practice the lower commission its plan advertises", async () => {
    const clinicOwner = await makeUser();
    await subscribeUser(clinicOwner.id, { commissionDiscountBps: 200 });
    const booked = await bookFirstSlot(clinicOwner.id);
    const settings = await getSettings();
    expect(booked.commissionCents).toBe(
      applyBps(booked.priceCents, Math.max(0, settings.commissionAppointmentBps - 200)),
    );
  });
});

describe("priority support", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("opens a subscriber's everyday ticket at high priority", () => {
    expect(initialTicketPriority("ACCOUNT", false)).toBe("NORMAL");
    expect(initialTicketPriority("ACCOUNT", true)).toBe("HIGH");
    expect(initialTicketPriority("SAFETY", false)).toBe("HIGH");
  });

  it("reads a priority subscriber's plan when they open a ticket", async () => {
    const subscriber = await makeUser();
    await subscribeUser(subscriber.id, { prioritySupport: true });
    const regular = await makeUser();

    const message = "A message that is comfortably longer than the minimum length.";
    const subscriberTicket = await createSupportTicket(
      { name: "Sub Scriber", email: subscriber.email, topic: "ACCOUNT", subject: "Cannot edit profile", message },
      { userId: subscriber.id },
    );
    const regularTicket = await createSupportTicket(
      { name: "Reg Ular", email: regular.email, topic: "ACCOUNT", subject: "Cannot edit profile", message },
      { userId: regular.id },
    );

    const priorities = await db.supportTicket.findMany({
      where: { id: { in: [subscriberTicket.id, regularTicket.id] } },
      select: { id: true, priority: true },
    });
    expect(priorities.find((t) => t.id === subscriberTicket.id)!.priority).toBe("HIGH");
    expect(priorities.find((t) => t.id === regularTicket.id)!.priority).toBe("NORMAL");
  });

  it("puts urgent tickets first, which an alphabetical sort would put last", async () => {
    const make = (priority: string, minutesAgo: number) =>
      db.supportTicket.create({
        data: {
          reference: `SUP-${priority}-${minutesAgo}`,
          email: "someone@example.test",
          name: "Someone",
          topic: "OTHER",
          subject: priority,
          priority,
          lastReplyAt: new Date(Date.now() - minutesAgo * 60_000),
        },
      });

    await make("LOW", 500);
    await make("NORMAL", 400);
    await make("HIGH", 10);
    await make("URGENT", 1);
    await make("HIGH", 300);

    const queue = await listSupportQueue();
    expect(queue.map((t) => t.priority)).toEqual(["URGENT", "HIGH", "HIGH", "NORMAL", "LOW"]);
    // Within a level, the ticket that has waited longest comes first.
    expect(queue[1]!.reference).toBe("SUP-HIGH-300");
  });
});
