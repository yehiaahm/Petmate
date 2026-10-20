import { describe, it, expect, beforeEach } from "vitest";
import { db, makeUser, makePet, resetDatabase, subscribeUser } from "./helpers";
import { proposeTerms, agreeToTerms, recordBreedingOutcome, getBreedingRequest } from "@/lib/services/breeding.service";
import {
  startBreedingFeePayment,
  confirmBreedingFeeRelease,
  reportBreedingFeeProblem,
  autoReleaseBreedingFee,
  resolveBreedingFee,
  feeParties,
} from "@/lib/services/breeding-fee.service";
import { confirmPayment } from "@/lib/payments/service";
import { getBalance, accounts } from "@/lib/payments/ledger-core";
import { getSettings } from "@/lib/settings";
import { applyBps } from "@/lib/money";
import { PLATFORM_CURRENCY } from "@/lib/currency";

/**
 * Stud fees are the one breeding step that involves money, so every path the
 * money can take is walked here against the real ledger: into escrow, out to
 * the stud's owner less commission, and back to the payer on cancellation.
 */

const FEE = 250_000; // EGP 2,500

async function ledgerSum(): Promise<number> {
  return (await db.ledgerEntry.aggregate({ _sum: { amountCents: true } }))._sum.amountCents ?? 0;
}

/** Two owners with an accepted request: the dam's owner asked the stud's owner. */
async function acceptedPairing() {
  const damOwner = await makeUser({ name: "Dam Owner" });
  const studOwner = await makeUser({ name: "Stud Owner" });
  const dam = await makePet(damOwner.id, { sex: "FEMALE", name: "Luna" });
  const stud = await makePet(studOwner.id, { sex: "MALE", name: "Max" });
  const request = await db.breedingRequest.create({
    data: {
      initiatorPetId: dam.id,
      receiverPetId: stud.id,
      initiatorUserId: damOwner.id,
      receiverUserId: studOwner.id,
      status: "ACCEPTED",
      feeCents: FEE,
      feeType: "FEE",
    },
    select: { id: true },
  });
  return { damOwner, studOwner, requestId: request.id };
}

const terms = (feeCents = FEE, feeType: "FEE" | "FREE" | "PICK_OF_LITTER" = "FEE") => ({
  feeCents,
  currency: PLATFORM_CURRENCY,
  feeType,
  termsText: "Two matings over three days. One free return service if she does not take.",
});

async function agreedPairing(feeCents = FEE) {
  const pairing = await acceptedPairing();
  await proposeTerms(pairing.studOwner.auth, pairing.requestId, terms(feeCents));
  await agreeToTerms(pairing.studOwner.auth, pairing.requestId);
  const result = await agreeToTerms(pairing.damOwner.auth, pairing.requestId);
  return { ...pairing, agreeResult: result };
}

async function paidPairing() {
  const pairing = await agreedPairing();
  const payment = await startBreedingFeePayment(pairing.damOwner.auth, pairing.requestId);
  await confirmPayment({ intentId: payment.id, actorId: pairing.damOwner.id, viaSandbox: true });
  return { ...pairing, paymentId: payment.id };
}

const feeRow = (id: string) =>
  db.breedingRequest.findUniqueOrThrow({
    where: { id },
    select: { status: true, feeStatus: true, feeCommissionCents: true, feePayoutCents: true, feeReleaseAt: true },
  });

beforeEach(async () => {
  await resetDatabase();
});

describe("who pays a stud fee", () => {
  it("is always the female's owner, whoever sent the request", () => {
    expect(feeParties({ initiatorUserId: "a", receiverUserId: "b", initiatorPetSex: "FEMALE" })).toEqual({
      payerUserId: "a",
      payeeUserId: "b",
    });
    expect(feeParties({ initiatorUserId: "a", receiverUserId: "b", initiatorPetSex: "MALE" })).toEqual({
      payerUserId: "b",
      payeeUserId: "a",
    });
  });
});

describe("agreeing paid terms", () => {
  it("makes the fee due from the dam's owner", async () => {
    const { requestId, damOwner, studOwner, agreeResult } = await agreedPairing();
    expect(agreeResult).toEqual({ bothAgreed: true, feeDue: true });

    const request = await db.breedingRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(request.status).toBe("AGREED");
    expect(request.feeStatus).toBe("DUE");
    expect(request.feePayerUserId).toBe(damOwner.id);
    expect(request.feePayeeUserId).toBe(studOwner.id);
  });

  it("leaves unpaid arrangements alone", async () => {
    const { requestId, studOwner, damOwner } = await acceptedPairing();
    await proposeTerms(studOwner.auth, requestId, terms(0, "PICK_OF_LITTER"));
    await agreeToTerms(studOwner.auth, requestId);
    const result = await agreeToTerms(damOwner.auth, requestId);
    expect(result.feeDue).toBe(false);
    expect((await feeRow(requestId)).feeStatus).toBe("NONE");

    // And the breeding can be recorded without any payment.
    await recordBreedingOutcome(damOwner.auth, requestId, { outcome: "SUCCESSFUL" });
    expect((await feeRow(requestId)).status).toBe("COMPLETED");
  });

  it("refuses to record the breeding until the fee is paid", async () => {
    const { requestId, studOwner } = await agreedPairing();
    await expect(recordBreedingOutcome(studOwner.auth, requestId, { outcome: "SUCCESSFUL" })).rejects.toThrow(
      /has to be paid through PetMate/,
    );
    expect((await feeRow(requestId)).status).toBe("AGREED");
  });

  it("lets only the payer pay, and only while it is due", async () => {
    const { requestId, studOwner } = await agreedPairing();
    await expect(startBreedingFeePayment(studOwner.auth, requestId)).rejects.toThrow(/Only the owner paying/);

    const stranger = await makeUser();
    await expect(startBreedingFeePayment(stranger.auth, requestId)).rejects.toThrow(/could not be found/);
  });

  it("cancelling an unpaid breeding just stops the fee being owed", async () => {
    const { requestId, damOwner } = await agreedPairing();
    await recordBreedingOutcome(damOwner.auth, requestId, { outcome: "CANCELLED" });
    const row = await feeRow(requestId);
    expect(row.status).toBe("CANCELLED");
    expect(row.feeStatus).toBe("NONE");
    expect(await ledgerSum()).toBe(0);
  });
});

describe("paying the fee", () => {
  it("holds the whole fee in escrow and fixes the commission split", async () => {
    const { requestId, damOwner } = await paidPairing();
    const settings = await getSettings();
    const commission = applyBps(FEE, settings.commissionBreedingBps);

    const row = await feeRow(requestId);
    expect(row.feeStatus).toBe("HELD");
    expect(row.feeCommissionCents).toBe(commission);
    expect(row.feePayoutCents).toBe(FEE - commission);
    expect(await getBalance(accounts.escrow())).toBe(FEE);
    expect(await ledgerSum()).toBe(0);

    const invoice = await db.invoice.findFirst({ where: { userId: damOwner.id } });
    expect(invoice?.totalCents).toBe(FEE);
  });

  it("returns the same checkout for the same agreement", async () => {
    const { requestId, damOwner } = await agreedPairing();
    const first = await startBreedingFeePayment(damOwner.auth, requestId);
    const second = await startBreedingFeePayment(damOwner.auth, requestId);
    expect(second.id).toBe(first.id);
    expect(first.amountCents).toBe(FEE);
  });

  it("takes the stud owner's plan discount off the commission, not the payer's", async () => {
    const pairing = await acceptedPairing();
    await subscribeUser(pairing.studOwner.id, { commissionDiscountBps: 200 });
    await subscribeUser(pairing.damOwner.id, { commissionDiscountBps: 400 });
    await proposeTerms(pairing.studOwner.auth, pairing.requestId, terms());
    await agreeToTerms(pairing.studOwner.auth, pairing.requestId);
    await agreeToTerms(pairing.damOwner.auth, pairing.requestId);
    await startBreedingFeePayment(pairing.damOwner.auth, pairing.requestId);

    const settings = await getSettings();
    const expected = applyBps(FEE, Math.max(0, settings.commissionBreedingBps - 200));
    expect((await feeRow(pairing.requestId)).feeCommissionCents).toBe(expected);
  });

  it("refunds a payment that lands after the breeding was called off", async () => {
    const { requestId, damOwner } = await agreedPairing();
    const payment = await startBreedingFeePayment(damOwner.auth, requestId);
    await recordBreedingOutcome(damOwner.auth, requestId, { outcome: "CANCELLED" });

    await confirmPayment({ intentId: payment.id, actorId: damOwner.id, viaSandbox: true });

    const intent = await db.paymentIntent.findUniqueOrThrow({ where: { id: payment.id } });
    expect(intent.status).toBe("REFUNDED");
    expect((await feeRow(requestId)).feeStatus).toBe("NONE");
    expect(await getBalance(accounts.escrow())).toBe(0);
    expect(await getBalance(accounts.platformRevenue())).toBe(0);
    expect(await ledgerSum()).toBe(0);
  });
});

describe("releasing the fee", () => {
  it("pays the stud's owner at once when the payer records the breeding", async () => {
    const { requestId, damOwner, studOwner } = await paidPairing();
    await recordBreedingOutcome(damOwner.auth, requestId, { outcome: "SUCCESSFUL" });

    const row = await feeRow(requestId);
    expect(row.feeStatus).toBe("RELEASED");
    expect(await getBalance(accounts.userAvailable(studOwner.id))).toBe(row.feePayoutCents);
    expect(await getBalance(accounts.platformRevenue())).toBe(row.feeCommissionCents);
    expect(await getBalance(accounts.escrow())).toBe(0);
    expect(await ledgerSum()).toBe(0);
  });

  it("gives the payer a review window when the stud's owner records it", async () => {
    const { requestId, damOwner, studOwner } = await paidPairing();
    await recordBreedingOutcome(studOwner.auth, requestId, { outcome: "UNSUCCESSFUL" });

    const row = await feeRow(requestId);
    expect(row.status).toBe("COMPLETED");
    expect(row.feeStatus).toBe("HELD");
    expect(row.feeReleaseAt!.getTime()).toBeGreaterThan(Date.now());
    expect(await db.job.count({ where: { type: "breeding.releaseFee" } })).toBe(1);

    // The job does nothing before the window closes...
    expect(await autoReleaseBreedingFee(requestId)).toBe("not due");
    expect(await getBalance(accounts.userAvailable(studOwner.id))).toBe(0);

    // ...and pays out once it has.
    await db.breedingRequest.update({ where: { id: requestId }, data: { feeReleaseAt: new Date(Date.now() - 1000) } });
    expect(await autoReleaseBreedingFee(requestId)).toBe("released");
    expect(await getBalance(accounts.userAvailable(studOwner.id))).toBe(row.feePayoutCents);

    // Running it again, or the payer confirming late, moves nothing twice.
    expect(await autoReleaseBreedingFee(requestId)).toBe("not due");
    await expect(confirmBreedingFeeRelease(damOwner.auth, requestId)).rejects.toThrow(/cannot be released/);
    expect(await getBalance(accounts.userAvailable(studOwner.id))).toBe(row.feePayoutCents);
    expect(await ledgerSum()).toBe(0);
  });

  it("lets the payer release early", async () => {
    const { requestId, damOwner, studOwner } = await paidPairing();
    await recordBreedingOutcome(studOwner.auth, requestId, { outcome: "SUCCESSFUL" });
    await expect(confirmBreedingFeeRelease(studOwner.auth, requestId)).rejects.toThrow(/Only the owner who paid/);
    await confirmBreedingFeeRelease(damOwner.auth, requestId);
    expect((await feeRow(requestId)).feeStatus).toBe("RELEASED");
  });
});

describe("cancelling and disputes", () => {
  it("refunds the payer in full when the stud's owner cancels", async () => {
    const { requestId, studOwner, paymentId } = await paidPairing();
    await recordBreedingOutcome(studOwner.auth, requestId, { outcome: "CANCELLED" });

    expect((await feeRow(requestId)).feeStatus).toBe("REFUNDED");
    const intent = await db.paymentIntent.findUniqueOrThrow({ where: { id: paymentId } });
    expect(intent.status).toBe("REFUNDED");
    expect(intent.refundedCents).toBe(FEE);
    expect(await getBalance(accounts.escrow())).toBe(0);
    expect(await getBalance(accounts.platformRevenue())).toBe(0);
    expect(await ledgerSum()).toBe(0);
  });

  it("does not let the payer cancel a paid breeding and take the fee back", async () => {
    const { requestId, damOwner } = await paidPairing();
    await expect(recordBreedingOutcome(damOwner.auth, requestId, { outcome: "CANCELLED" })).rejects.toThrow(
      /Ask the other owner to cancel/,
    );
    expect((await feeRow(requestId)).feeStatus).toBe("HELD");
  });

  it("freezes a reported fee until staff decide, and pays out on their word", async () => {
    const { requestId, damOwner, studOwner } = await paidPairing();
    await recordBreedingOutcome(studOwner.auth, requestId, { outcome: "SUCCESSFUL" });

    await expect(
      reportBreedingFeeProblem(studOwner.auth, requestId, "This is not my fee to report at all."),
    ).rejects.toThrow(/Only the owner who paid/);

    const { ticket } = await reportBreedingFeeProblem(
      damOwner.auth,
      requestId,
      "The mating never took place; the stud was not brought to the meeting.",
    );
    expect(ticket).toMatch(/^SUP-/);
    const support = await db.supportTicket.findFirstOrThrow({ where: { reference: ticket } });
    expect(support.topic).toBe("PAYMENT");
    expect(support.priority).toBe("HIGH");

    // The review window passing does not pay a disputed fee.
    await db.breedingRequest.update({ where: { id: requestId }, data: { feeReleaseAt: new Date(Date.now() - 1000) } });
    expect(await autoReleaseBreedingFee(requestId)).toBe("not due");
    expect((await feeRow(requestId)).feeStatus).toBe("FROZEN");

    const admin = await makeUser({ roles: ["ADMIN"] });
    await resolveBreedingFee(admin.auth, requestId, "RELEASE", "Photos of the mating provided.");
    const row = await feeRow(requestId);
    expect(row.feeStatus).toBe("RELEASED");
    expect(await getBalance(accounts.userAvailable(studOwner.id))).toBe(row.feePayoutCents);
    await expect(resolveBreedingFee(admin.auth, requestId, "REFUND", "Changed my mind.")).rejects.toThrow(
      /already been settled/,
    );
    expect(await ledgerSum()).toBe(0);
  });

  it("refunds a reported fee when staff find for the payer", async () => {
    const { requestId, damOwner, studOwner } = await paidPairing();
    await reportBreedingFeeProblem(damOwner.auth, requestId, "The stud owner stopped replying after I paid.");
    const admin = await makeUser({ roles: ["ADMIN"] });
    const result = await resolveBreedingFee(admin.auth, requestId, "REFUND", "No evidence the mating happened.");
    expect(result.feeStatus).toBe("REFUNDED");
    expect(await getBalance(accounts.userAvailable(studOwner.id))).toBe(0);
    expect(await getBalance(accounts.escrow())).toBe(0);
    expect(await ledgerSum()).toBe(0);
  });
});

describe("the request page view", () => {
  it("shows each owner their own side, and only to the two of them", async () => {
    const { requestId, damOwner, studOwner } = await agreedPairing();
    const forPayer = await getBreedingRequest(damOwner.auth, requestId);
    expect(forPayer.iPayFee).toBe(true);
    expect(forPayer.myPet.name).toBe("Luna");

    const forStud = await getBreedingRequest(studOwner.auth, requestId);
    expect(forStud.iReceiveFee).toBe(true);
    expect(forStud.payoutCents + forStud.commissionCents).toBe(FEE);

    const stranger = await makeUser();
    await expect(getBreedingRequest(stranger.auth, requestId)).rejects.toThrow(/could not be found/);
  });
});
