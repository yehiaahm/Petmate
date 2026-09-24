import { describe, it, expect, beforeEach } from "vitest";
import {
  db,
  makeUser,
  makePet,
  makeShopWithProduct,
  makeClinicWithService,
  resetDatabase,
} from "./helpers";
import { addToCart, createOrder, cancelOrder } from "@/lib/services/commerce.service";
import { bookAppointment, getAvailability, cancelAppointment } from "@/lib/services/vet.service";
import { enqueueJob, claimJobs, completeJob } from "@/lib/jobs/queue";
import { addDays } from "@/lib/utils";

/**
 * Concurrency.
 *
 * These are the bugs that never appear in manual testing and always appear on
 * launch day: two buyers taking the last unit, two people booking the last
 * slot, two workers running the same job. Each is defended by a database
 * constraint or a conditional update rather than by application-level checking,
 * and these tests prove the defence actually fires.
 */

/** Next weekday at 10:00 UTC, comfortably inside the seeded clinic hours. */
function nextSlot(daysAhead = 2): Date {
  const date = addDays(new Date(), daysAhead);
  date.setUTCHours(10, 0, 0, 0);
  return date;
}

describe("inventory races", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("only sells the last unit once when two buyers check out together", async () => {
    const seller = await makeUser({ roles: ["USER", "SELLER"] });
    const buyerA = await makeUser();
    const buyerB = await makeUser();

    // Exactly one unit in stock.
    const { variantId } = await makeShopWithProduct(seller.id, { stock: 1, priceCents: 5_000 });

    await addToCart(buyerA.auth, { variantId, quantity: 1 });
    await addToCart(buyerB.auth, { variantId, quantity: 1 });

    const shipping = {
      shippingName: "Racer",
      shippingLine1: "1 Test Street",
      shippingCity: "Cairo",
      shippingCountry: "Egypt",
    };

    const results = await Promise.allSettled([
      createOrder(buyerA.auth, shipping),
      createOrder(buyerB.auth, shipping),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // Stock must not go negative — that is the whole point of the guard.
    const variant = await db.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });
    expect(variant.stock).toBe(0);

    const orders = await db.order.count();
    expect(orders).toBe(1);
  });

  it("returns stock when an unpaid order is cancelled", async () => {
    const seller = await makeUser({ roles: ["USER", "SELLER"] });
    const buyer = await makeUser();
    const { variantId } = await makeShopWithProduct(seller.id, { stock: 3, priceCents: 1_000 });

    await addToCart(buyer.auth, { variantId, quantity: 2 });
    const order = await createOrder(buyer.auth, {
      shippingName: "Buyer",
      shippingLine1: "1 Test Street",
      shippingCity: "Cairo",
      shippingCountry: "Egypt",
    });

    const reserved = await db.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });
    expect(reserved.stock).toBe(1);

    await cancelOrder({ orderId: order.id, reason: "timeout", actorId: "system" });

    const restored = await db.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });
    expect(restored.stock).toBe(3);
  });

  it("cancels an order only once", async () => {
    const seller = await makeUser({ roles: ["USER", "SELLER"] });
    const buyer = await makeUser();
    const { variantId } = await makeShopWithProduct(seller.id, { stock: 5, priceCents: 1_000 });

    await addToCart(buyer.auth, { variantId, quantity: 1 });
    const order = await createOrder(buyer.auth, {
      shippingName: "Buyer",
      shippingLine1: "1 Test Street",
      shippingCity: "Cairo",
      shippingCountry: "Egypt",
    });

    const first = await cancelOrder({ orderId: order.id, reason: "a", actorId: "system" });
    const second = await cancelOrder({ orderId: order.id, reason: "b", actorId: "system" });

    expect(first).toBe(true);
    // A second cancellation must not restock a second time.
    expect(second).toBe(false);

    const variant = await db.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });
    expect(variant.stock).toBe(5);
  });

  it("refuses to add more to the cart than exists", async () => {
    const seller = await makeUser({ roles: ["USER", "SELLER"] });
    const buyer = await makeUser();
    const { variantId } = await makeShopWithProduct(seller.id, { stock: 2 });

    await addToCart(buyer.auth, { variantId, quantity: 2 });
    await expect(addToCart(buyer.auth, { variantId, quantity: 1 })).rejects.toThrow(/left in stock/i);
  });

  it("stops a seller buying from their own shop", async () => {
    const seller = await makeUser({ roles: ["USER", "SELLER"] });
    const { variantId } = await makeShopWithProduct(seller.id, { stock: 5 });

    await expect(addToCart(seller.auth, { variantId, quantity: 1 })).rejects.toThrow(
      /your own shop/i,
    );
  });
});

describe("appointment double booking", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("gives the last slot to exactly one of two simultaneous bookings", async () => {
    const clinicOwner = await makeUser({ roles: ["USER", "CLINIC_ADMIN", "VET"] });
    const customerA = await makeUser();
    const customerB = await makeUser();
    const { clinicId, vetId, serviceId } = await makeClinicWithService(clinicOwner.id);

    const petA = await makePet(customerA.id);
    const petB = await makePet(customerB.id);
    const startAt = nextSlot();

    const results = await Promise.allSettled([
      bookAppointment(customerA.auth, {
        clinicId,
        serviceId,
        vetId,
        petId: petA.id,
        startAt,
      }),
      bookAppointment(customerB.auth, {
        clinicId,
        serviceId,
        vetId,
        petId: petB.id,
        startAt,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);

    // The unique index is what guarantees this, not an application check.
    const booked = await db.appointment.count({ where: { vetId, startAt } });
    expect(booked).toBe(1);
  });

  it("refuses a time the clinic does not actually offer", async () => {
    const clinicOwner = await makeUser({ roles: ["USER", "CLINIC_ADMIN", "VET"] });
    const customer = await makeUser();
    const { clinicId, vetId, serviceId } = await makeClinicWithService(clinicOwner.id);
    const pet = await makePet(customer.id);

    // 03:00 is outside the 09:00-17:00 hours, even though it is a valid date.
    const middleOfNight = addDays(new Date(), 2);
    middleOfNight.setUTCHours(3, 0, 0, 0);

    await expect(
      bookAppointment(customer.auth, {
        clinicId,
        serviceId,
        vetId,
        petId: pet.id,
        startAt: middleOfNight,
      }),
    ).rejects.toThrow(/no longer available|pick another slot/i);
  });

  it("refuses a booking inside the clinic's notice period", async () => {
    const clinicOwner = await makeUser({ roles: ["USER", "CLINIC_ADMIN", "VET"] });
    const customer = await makeUser();
    const { clinicId, vetId, serviceId } = await makeClinicWithService(clinicOwner.id);
    const pet = await makePet(customer.id);

    const inTenMinutes = new Date(Date.now() + 10 * 60_000);

    await expect(
      bookAppointment(customer.auth, {
        clinicId,
        serviceId,
        vetId,
        petId: pet.id,
        startAt: inTenMinutes,
      }),
    ).rejects.toThrow(/notice|no longer available/i);
  });

  it("removes a booked slot from availability and returns it on cancellation", async () => {
    const clinicOwner = await makeUser({ roles: ["USER", "CLINIC_ADMIN", "VET"] });
    const customer = await makeUser();
    const { clinicId, vetId, serviceId } = await makeClinicWithService(clinicOwner.id);
    const pet = await makePet(customer.id);
    const startAt = nextSlot();

    const before = await getAvailability({ clinicId, serviceId, from: startAt, days: 1 });
    expect(before.some((s) => s.startAt.getTime() === startAt.getTime())).toBe(true);

    const appointment = await bookAppointment(customer.auth, {
      clinicId,
      serviceId,
      vetId,
      petId: pet.id,
      startAt,
    });

    const during = await getAvailability({ clinicId, serviceId, from: startAt, days: 1 });
    expect(during.some((s) => s.startAt.getTime() === startAt.getTime())).toBe(false);

    await cancelAppointment(customer.auth, appointment.id, "changed my mind");

    const after = await getAvailability({ clinicId, serviceId, from: startAt, days: 1 });
    expect(after.some((s) => s.startAt.getTime() === startAt.getTime())).toBe(true);
  });

  it("does not let someone book an appointment for a pet they do not own", async () => {
    const clinicOwner = await makeUser({ roles: ["USER", "CLINIC_ADMIN", "VET"] });
    const owner = await makeUser();
    const stranger = await makeUser();
    const { clinicId, vetId, serviceId } = await makeClinicWithService(clinicOwner.id);
    const pet = await makePet(owner.id);

    await expect(
      bookAppointment(stranger.auth, {
        clinicId,
        serviceId,
        vetId,
        petId: pet.id,
        startAt: nextSlot(3),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("job queue", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("hands a job to exactly one worker", async () => {
    await enqueueJob({ type: "email.process", payload: {} });

    const [workerA, workerB] = await Promise.all([
      claimJobs("worker-a", 5),
      claimJobs("worker-b", 5),
    ]);

    const total = workerA.length + workerB.length;
    expect(total).toBe(1);
  });

  it("deduplicates on a unique key", async () => {
    await enqueueJob({ type: "health.reminders", uniqueKey: "same-key" });
    await enqueueJob({ type: "health.reminders", uniqueKey: "same-key" });
    await enqueueJob({ type: "health.reminders", uniqueKey: "same-key" });

    expect(await db.job.count({ where: { uniqueKey: "same-key" } })).toBe(1);
  });

  it("does not claim a job scheduled for the future", async () => {
    await enqueueJob({
      type: "escrow.autoRelease",
      payload: { petOrderId: "x" },
      runAt: addDays(new Date(), 7),
    });

    const claimed = await claimJobs("worker", 5);
    expect(claimed).toHaveLength(0);
  });

  it("marks a completed job so it is never run twice", async () => {
    await enqueueJob({ type: "email.process" });

    const [job] = await claimJobs("worker", 1);
    expect(job).toBeDefined();

    await completeJob(job!.id);

    const again = await claimJobs("worker", 5);
    expect(again).toHaveLength(0);

    const stored = await db.job.findUniqueOrThrow({
      where: { id: job!.id },
      select: { status: true, completedAt: true },
    });
    expect(stored.status).toBe("COMPLETED");
    expect(stored.completedAt).not.toBeNull();
  });
});
