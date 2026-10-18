import { describe, it, expect, beforeEach } from "vitest";
import { db, makeUser, makePet, makeCareProvider, resetDatabase } from "./helpers";
import {
  parseCalendarDate,
  refundForCancellation,
  stayNights,
  transportLegCents,
} from "@/lib/care/pricing";
import {
  bookCare,
  cancelCareBooking,
  completeTransport,
  expireUnpaidCareBooking,
  getTrainingSlots,
  startTransport,
} from "@/lib/services/care-booking.service";
import { handoverCode } from "@/lib/care/handover-code";
import { createPayment, confirmPayment } from "@/lib/payments/service";
import { assertLedgerBalanced, getBalance, accounts } from "@/lib/payments/ledger-core";
import type { AuthContext } from "@/lib/auth/session";

/**
 * Pet care: hotel stays, training programmes, pickup and drop-off.
 *
 * The rules that decide money and capacity are tested twice: as pure
 * arithmetic, and through real bookings against the real schema, so the
 * unique indexes that stop overbooking are shown to fire.
 */

const day = (offset: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

async function pay(auth: AuthContext, booking: { id: string; totalCents: number; currency: string }) {
  const payment = await createPayment({
    userId: auth.user.id,
    purpose: "CARE_BOOKING",
    referenceType: "CARE_BOOKING",
    referenceId: booking.id,
    amountCents: booking.totalCents,
    currency: booking.currency,
    description: "test",
    idempotencyKey: `test:${booking.id}`,
    returnUrl: "http://localhost:3000",
  });
  await confirmPayment({ intentId: payment.id });
  return payment;
}

describe("care arithmetic", () => {
  it("counts the nights of a stay, not the days", () => {
    const nights = stayNights(parseCalendarDate("2026-10-20")!, parseCalendarDate("2026-10-23")!);
    expect(nights.map((n) => n.toISOString().slice(0, 10))).toEqual(["2026-10-20", "2026-10-21", "2026-10-22"]);
  });

  it("refuses calendar dates that do not exist", () => {
    expect(parseCalendarDate("2026-02-31")).toBeNull();
    expect(parseCalendarDate("20-10-2026")).toBeNull();
    expect(parseCalendarDate("2026-02-28")).not.toBeNull();
  });

  it("rounds transport distance up so a quote never undercharges", () => {
    // 3.21 km rounds to 3.3 km: 5000 + 3.3 * 500.
    expect(transportLegCents({ baseCents: 5_000, perKmCents: 500, distanceKm: 3.21 })).toBe(6_650);
  });

  it("applies each cancellation policy at its boundaries", () => {
    const refund = (policy: "FLEXIBLE" | "MODERATE" | "STRICT", hours: number) =>
      refundForCancellation({ policy, hoursUntilStart: hours, paidCents: 10_000, cancelledByProvider: false });

    expect(refund("FLEXIBLE", 24)).toBe(10_000);
    expect(refund("FLEXIBLE", 23.9)).toBe(0);
    expect(refund("MODERATE", 72)).toBe(10_000);
    expect(refund("MODERATE", 48)).toBe(5_000);
    expect(refund("MODERATE", 10)).toBe(0);
    expect(refund("STRICT", 168)).toBe(5_000);
    expect(refund("STRICT", 100)).toBe(0);
  });

  it("always refunds in full when the provider cancels", () => {
    expect(
      refundForCancellation({ policy: "STRICT", hoursUntilStart: 1, paidCents: 12_345, cancelledByProvider: true }),
    ).toBe(12_345);
  });
});

describe("pet hotel capacity", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("gives the last room to exactly one of two simultaneous bookings", async () => {
    const owner = await makeUser({ roles: ["USER", "CARE_PROVIDER"] });
    const a = await makeUser();
    const b = await makeUser();
    const { providerId, unitId } = await makeCareProvider(owner.id, { capacity: 1 });
    const petA = await makePet(a.id);
    const petB = await makePet(b.id);

    const stay = { kind: "BOARDING" as const, providerId, unitId, checkIn: day(5), checkOut: day(8), pickup: false, dropoff: false };
    const results = await Promise.allSettled([
      bookCare(a.auth, { ...stay, petId: petA.id }),
      bookCare(b.auth, { ...stay, petId: petB.id }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    // Three nights, one room: three rows, never six.
    expect(await db.boardingNight.count({ where: { unitId } })).toBe(3);
  });

  it("fills every room of a type before refusing", async () => {
    const owner = await makeUser({ roles: ["USER", "CARE_PROVIDER"] });
    const { providerId, unitId } = await makeCareProvider(owner.id, { capacity: 2 });
    const stay = { kind: "BOARDING" as const, providerId, unitId, checkIn: day(5), checkOut: day(7), pickup: false, dropoff: false };

    for (let i = 0; i < 2; i++) {
      const customer = await makeUser();
      const pet = await makePet(customer.id);
      await bookCare(customer.auth, { ...stay, petId: pet.id });
    }

    const late = await makeUser();
    const latePet = await makePet(late.id);
    await expect(bookCare(late.auth, { ...stay, petId: latePet.id })).rejects.toThrow(/fully booked/i);
  });

  it("releases the room when an unpaid booking expires", async () => {
    const owner = await makeUser({ roles: ["USER", "CARE_PROVIDER"] });
    const customer = await makeUser();
    const { providerId, unitId } = await makeCareProvider(owner.id);
    const pet = await makePet(customer.id);

    const booking = await bookCare(customer.auth, {
      kind: "BOARDING", providerId, unitId, petId: pet.id, checkIn: day(5), checkOut: day(6), pickup: false, dropoff: false,
    });
    expect(await expireUnpaidCareBooking(booking.id)).toBe(true);
    expect(await db.boardingNight.count({ where: { unitId } })).toBe(0);
    // Running the job twice is harmless.
    expect(await expireUnpaidCareBooking(booking.id)).toBe(false);
  });

  it("refuses a pet without a current vaccination when the hotel requires one", async () => {
    const owner = await makeUser({ roles: ["USER", "CARE_PROVIDER"] });
    const customer = await makeUser();
    const { providerId, unitId } = await makeCareProvider(owner.id, { requiresVaccination: true });
    const pet = await makePet(customer.id);

    await expect(
      bookCare(customer.auth, {
        kind: "BOARDING", providerId, unitId, petId: pet.id, checkIn: day(5), checkOut: day(6), pickup: false, dropoff: false,
      }),
    ).rejects.toThrow(/vaccination/i);
  });

  it("refuses pickup beyond the provider's radius", async () => {
    const owner = await makeUser({ roles: ["USER", "CARE_PROVIDER"] });
    const customer = await makeUser();
    const { providerId, unitId } = await makeCareProvider(owner.id);
    const pet = await makePet(customer.id);

    await expect(
      bookCare(customer.auth, {
        kind: "BOARDING", providerId, unitId, petId: pet.id, checkIn: day(5), checkOut: day(6),
        pickup: true, dropoff: false,
        // Alexandria, about 180 km from the Cairo provider.
        address: "Corniche, Alexandria", lat: 31.2001, lng: 29.9187,
      }),
    ).rejects.toThrow(/covers up to 20 km/i);
  });

  it("does not let a business book itself", async () => {
    const owner = await makeUser({ roles: ["USER", "CARE_PROVIDER"] });
    const { providerId, unitId } = await makeCareProvider(owner.id);
    const pet = await makePet(owner.id);

    await expect(
      bookCare(owner.auth, {
        kind: "BOARDING", providerId, unitId, petId: pet.id, checkIn: day(5), checkOut: day(6), pickup: false, dropoff: false,
      }),
    ).rejects.toThrow(/your own business/i);
  });
});

describe("care money", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("holds the provider's earnings as pending and keeps the book balanced", async () => {
    const owner = await makeUser({ roles: ["USER", "CARE_PROVIDER"] });
    const customer = await makeUser();
    const { providerId, unitId } = await makeCareProvider(owner.id);
    const pet = await makePet(customer.id);

    const booking = await bookCare(customer.auth, {
      kind: "BOARDING", providerId, unitId, petId: pet.id, checkIn: day(10), checkOut: day(12), pickup: false, dropoff: false,
    });
    await pay(customer.auth, booking);

    const row = await db.careBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.status).toBe("CONFIRMED");
    expect(row.totalCents).toBe(20_000);

    const pending = await getBalance(accounts.providerPending(providerId, "USD"));
    expect(pending).toBe(row.totalCents - row.commissionCents);
    expect((await assertLedgerBalanced()).ok).toBe(true);
  });

  it("refunds half inside the moderate window and lets the provider keep its share of the rest", async () => {
    const owner = await makeUser({ roles: ["USER", "CARE_PROVIDER"] });
    const customer = await makeUser();
    const { providerId, unitId } = await makeCareProvider(owner.id, { cancellationPolicy: "MODERATE" });
    const pet = await makePet(customer.id);

    // Check-in 09:00 UTC two days out: between 24 and 72 hours away.
    const booking = await bookCare(customer.auth, {
      kind: "BOARDING", providerId, unitId, petId: pet.id, checkIn: day(2), checkOut: day(4), pickup: false, dropoff: false,
    });
    await pay(customer.auth, booking);

    const { refundCents } = await cancelCareBooking(customer.auth, booking.id, "Plans changed");
    expect(refundCents).toBe(10_000);

    const row = await db.careBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.status).toBe("CANCELLED");
    expect(row.refundedCents).toBe(10_000);

    const earnings = row.totalCents - row.commissionCents;
    expect(await getBalance(accounts.providerPending(providerId, "USD"))).toBe(0);
    expect(await getBalance(accounts.providerAvailable(providerId, "USD"))).toBe(earnings - earnings / 2);
    expect(await db.boardingNight.count({ where: { unitId } })).toBe(0);
    expect((await assertLedgerBalanced()).ok).toBe(true);
  });

  it("books PetMate's own hotel entirely to platform revenue", async () => {
    const admin = await makeUser({ roles: ["USER", "ADMIN"] });
    const customer = await makeUser();
    const { providerId, unitId } = await makeCareProvider(admin.id, { official: true });
    const pet = await makePet(customer.id);

    const booking = await bookCare(customer.auth, {
      kind: "BOARDING", providerId, unitId, petId: pet.id, checkIn: day(10), checkOut: day(11), pickup: false, dropoff: false,
    });
    await pay(customer.auth, booking);

    const row = await db.careBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.commissionCents).toBe(row.totalCents);
    expect(await getBalance(accounts.providerPending(providerId, "USD"))).toBe(0);
    expect((await assertLedgerBalanced()).ok).toBe(true);
  });
});

describe("pickup handover", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("completes a pickup only with the owner's code, and locks after repeated guesses", async () => {
    const owner = await makeUser({ roles: ["USER", "CARE_PROVIDER"] });
    const customer = await makeUser();
    const { providerId, unitId } = await makeCareProvider(owner.id);
    const pet = await makePet(customer.id);

    // Starts tomorrow so the leg is due; the provider is 0 km away.
    const booking = await bookCare(customer.auth, {
      kind: "BOARDING", providerId, unitId, petId: pet.id, checkIn: day(1), checkOut: day(3),
      pickup: true, dropoff: true, address: "5 Tahrir Square", lat: 30.0444, lng: 31.2357,
    });
    expect(booking.totalCents).toBe(20_000 + 2 * 5_000);
    await pay(customer.auth, booking);

    // Bring the leg due now, whatever the hour the suite runs at.
    const pickup = await db.careTransport.findFirstOrThrow({ where: { bookingId: booking.id, direction: "PICKUP" } });
    await db.careTransport.update({ where: { id: pickup.id }, data: { scheduledAt: new Date() } });
    await startTransport(owner.auth, pickup.id, "Karim");

    await expect(completeTransport(owner.auth, pickup.id, "000000")).rejects.toThrow(/not correct/i);

    const live = await db.careTransport.findUniqueOrThrow({ where: { id: pickup.id } });
    const code = handoverCode(live.id, live.otpIssuedAt!);
    await completeTransport(owner.auth, pickup.id, code);

    const row = await db.careBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.status).toBe("IN_CARE");
  });
});

describe("training diary", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("only offers starts where every session of the programme fits", async () => {
    const owner = await makeUser({ roles: ["USER", "CARE_PROVIDER"] });
    const { providerId, programId } = await makeCareProvider(owner.id);

    const slots = await getTrainingSlots({ providerId, programId, days: 7 });
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(slot.sessions).toHaveLength(3);
      expect(slot.sessions[1]!.startAt.getTime() - slot.sessions[0]!.startAt.getTime()).toBe(7 * 86_400_000);
    }
  });

  it("gives one trainer's hour to exactly one of two simultaneous bookings", async () => {
    const owner = await makeUser({ roles: ["USER", "CARE_PROVIDER"] });
    const a = await makeUser();
    const b = await makeUser();
    const { providerId, programId } = await makeCareProvider(owner.id, { trainerCount: 1 });
    const petA = await makePet(a.id);
    const petB = await makePet(b.id);

    const [slot] = await getTrainingSlots({ providerId, programId, from: new Date(Date.now() + 2 * 86_400_000), days: 3 });
    const results = await Promise.allSettled([
      bookCare(a.auth, { kind: "TRAINING", providerId, programId, petId: petA.id, startAt: slot!.startAt, roundTrip: false }),
      bookCare(b.auth, { kind: "TRAINING", providerId, programId, petId: petB.id, startAt: slot!.startAt, roundTrip: false }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.trainingSession.count({ where: { providerId } })).toBe(3);

    // And that hour is no longer offered.
    const after = await getTrainingSlots({ providerId, programId, from: slot!.startAt, days: 1 });
    expect(after.some((s) => s.startAt.getTime() === slot!.startAt.getTime())).toBe(false);
  });
});
