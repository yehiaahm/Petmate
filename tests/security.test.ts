import { describe, it, expect, beforeEach } from "vitest";
import {
  db,
  makeUser,
  makePet,
  makeListing,
  makeClinicWithService,
  resetDatabase,
} from "./helpers";
import { hashPassword, verifyPassword, assessPassword, needsRehash } from "@/lib/auth/password";
import { assertOwnsPet, assertOwnsListing, assertClinicAccess, assertPetHealthAccess, permissionsFor } from "@/lib/auth/rbac";
import { updatePet } from "@/lib/services/pet.service";
import { updateListing, closeListing } from "@/lib/services/listing.service";
import { addHealthRecord, getHealthTimeline } from "@/lib/services/health.service";
import { sendMessage, getOrCreateConversation, listMessages } from "@/lib/services/chat.service";
import { suspendUser } from "@/lib/services/safety.service";
import { decideApplication } from "@/lib/services/adoption.service";
import { externalUrlSchema, safeRedirect, safeText } from "@/lib/validation/common";

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("scrypt$")).toBe(true);
    // The plaintext must not be recoverable from the stored value.
    expect(hash).not.toContain("correct horse");

    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong password entirely", hash)).toBe(false);
  });

  it("produces a different hash for the same password", async () => {
    const a = await hashPassword("same password here");
    const b = await hashPassword("same password here");
    // Distinct salts, so a rainbow table over the hash column is useless.
    expect(a).not.toBe(b);
    expect(await verifyPassword("same password here", a)).toBe(true);
    expect(await verifyPassword("same password here", b)).toBe(true);
  });

  it("rejects a tampered or malformed hash instead of throwing", async () => {
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
    expect(await verifyPassword("anything", "scrypt$1$1$1$aaa$bbb")).toBe(false);
    // Absurd cost parameters would be a CPU denial of service.
    expect(await verifyPassword("anything", "scrypt$99999999$99$99$aaa$bbb")).toBe(false);
  });

  it("enforces the strength policy", () => {
    expect(assessPassword("password").ok).toBe(false);
    expect(assessPassword("short").ok).toBe(false);
    expect(assessPassword("aaaaaaaaaaaaaa").ok).toBe(false);
    expect(assessPassword("alexmorgan2024", ["Alex Morgan"]).ok).toBe(false);
    expect(assessPassword("a genuinely long passphrase").ok).toBe(true);
  });

  it("flags a hash that predates the current parameters", () => {
    expect(needsRehash("scrypt$16384$8$1$salt$hash")).toBe(true);
    expect(needsRehash("bcrypt$whatever")).toBe(true);
  });
});

describe("ownership enforcement", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("hides another user's pet behind a 404, not a 403", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const pet = await makePet(owner.id);

    // A 403 would confirm the id exists, which is an enumeration oracle.
    await expect(assertOwnsPet(pet.id, stranger.auth)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    await expect(
      updatePet(stranger.auth, pet.id, { name: "Hijacked" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const unchanged = await db.pet.findUniqueOrThrow({
      where: { id: pet.id },
      select: { name: true, ownerId: true },
    });
    expect(unchanged.name).toBe(pet.name);
    expect(unchanged.ownerId).toBe(owner.id);
  });

  it("stops a stranger editing or closing a listing", async () => {
    const seller = await makeUser();
    const stranger = await makeUser();
    const pet = await makePet(seller.id);
    const listing = await makeListing(seller.id, pet.id, { priceCents: 100_000 });

    await expect(assertOwnsListing(listing.id, stranger.auth)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      updateListing(stranger.auth, listing.id, { priceCents: 1 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(closeListing(stranger.auth, listing.id, "REMOVED")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const unchanged = await db.listing.findUniqueOrThrow({
      where: { id: listing.id },
      select: { priceCents: true, status: true },
    });
    expect(unchanged.priceCents).toBe(100_000);
    expect(unchanged.status).toBe("ACTIVE");
  });

  it("keeps health records private from strangers", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const pet = await makePet(owner.id);

    await addHealthRecord(owner.auth, {
      petId: pet.id,
      type: "VACCINATION",
      title: "Rabies",
      occurredAt: new Date("2025-01-15"),
    });

    await expect(assertPetHealthAccess(pet.id, stranger.auth)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(getHealthTimeline(pet.id, stranger.auth)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    // The owner can read it.
    const timeline = await getHealthTimeline(pet.id, owner.auth);
    expect(timeline.records).toHaveLength(1);
  });

  it("marks an owner-written record as OWNER even when a clinic id is claimed", async () => {
    const owner = await makeUser();
    const clinicOwner = await makeUser({ roles: ["USER", "CLINIC_ADMIN"] });
    const { clinicId } = await makeClinicWithService(clinicOwner.id);
    const pet = await makePet(owner.id);

    // The owner does not belong to that clinic, so the claim must be ignored.
    const record = await addHealthRecord(owner.auth, {
      petId: pet.id,
      type: "VACCINATION",
      title: "Claimed clinic record",
      occurredAt: new Date("2025-02-01"),
      clinicId,
    });

    const stored = await db.healthRecord.findUniqueOrThrow({
      where: { id: record.id },
      select: { source: true, clinicId: true, verifiedAt: true },
    });
    expect(stored.source).toBe("OWNER");
    expect(stored.clinicId).toBeNull();
    expect(stored.verifiedAt).toBeNull();
  });

  it("stops a non-member reaching a clinic", async () => {
    const clinicOwner = await makeUser({ roles: ["USER", "CLINIC_ADMIN"] });
    const stranger = await makeUser();
    const { clinicId } = await makeClinicWithService(clinicOwner.id);

    await expect(assertClinicAccess(clinicId, stranger.auth)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(assertClinicAccess(clinicId, clinicOwner.auth, "OWNER")).resolves.toBeTruthy();
  });

  it("only lets the listing owner decide an adoption application", async () => {
    const rescue = await makeUser();
    const applicant = await makeUser();
    const stranger = await makeUser();
    const pet = await makePet(rescue.id);
    const listing = await makeListing(rescue.id, pet.id, { intent: "ADOPTION" });

    const application = await db.adoptionApplication.create({
      data: {
        listingId: listing.id,
        applicantId: applicant.id,
        motivation: "A long enough motivation to satisfy the validator comfortably.",
        agreedToTerms: true,
        hoursAloneDaily: 3,
      },
      select: { id: true },
    });

    await expect(
      decideApplication(stranger.auth, application.id, "APPROVED"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Even the applicant cannot approve their own application.
    await expect(
      decideApplication(applicant.auth, application.id, "APPROVED"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(decideApplication(rescue.auth, application.id, "APPROVED")).resolves.toBeUndefined();
  });
});

describe("conversation access", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("refuses a non-participant, even with a valid conversation id", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const outsider = await makeUser();

    const conversation = await getOrCreateConversation({
      type: "DIRECT",
      participantIds: [a.id, b.id],
      createdById: a.id,
    });

    await sendMessage(a.auth, { conversationId: conversation.id, body: "Private message" });

    await expect(listMessages(outsider.auth, conversation.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      sendMessage(outsider.auth, { conversationId: conversation.id, body: "Let me in" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // The real participant still reads it.
    const messages = await listMessages(b.auth, conversation.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.body).toBe("Private message");
  });

  it("blocks messaging in both directions once either side blocks", async () => {
    const a = await makeUser();
    const b = await makeUser();

    const conversation = await getOrCreateConversation({
      type: "DIRECT",
      participantIds: [a.id, b.id],
      createdById: a.id,
    });

    await db.block.create({ data: { blockerId: b.id, blockedId: a.id } });

    await expect(
      sendMessage(a.auth, { conversationId: conversation.id, body: "Hello again" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Same refusal from the other direction, so neither side can infer a block.
    await expect(
      sendMessage(b.auth, { conversationId: conversation.id, body: "Hello back" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("flags a message that pushes payment off-platform", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const conversation = await getOrCreateConversation({
      type: "DIRECT",
      participantIds: [a.id, b.id],
      createdById: a.id,
    });

    const message = await sendMessage(a.auth, {
      conversationId: conversation.id,
      body: "Just send the deposit first by western union and I will hold her for you",
    });

    expect(message.flagged).toBe(true);

    const risk = await db.riskEvent.findFirst({
      where: { entityId: message.id },
      select: { type: true, score: true },
    });
    expect(risk?.type).toBe("OFF_PLATFORM_CONTACT");
  });
});

describe("privilege escalation", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("gives roles only the permissions they should have", () => {
    const user = permissionsFor(["USER"]);
    expect(user.has("listing:create")).toBe(true);
    expect(user.has("admin:users")).toBe(false);
    expect(user.has("admin:finance")).toBe(false);

    const moderator = permissionsFor(["MODERATOR"]);
    expect(moderator.has("admin:moderation")).toBe(true);
    // A moderator must not be able to grant roles or move money.
    expect(moderator.has("admin:users")).toBe(false);
    expect(moderator.has("admin:finance")).toBe(false);

    const superAdmin = permissionsFor(["SUPER_ADMIN"]);
    expect(superAdmin.has("admin:destructive")).toBe(true);
  });

  it("stops a moderator suspending an admin", async () => {
    const moderator = await makeUser({ roles: ["USER", "MODERATOR"] });
    const admin = await makeUser({ roles: ["USER", "ADMIN"] });

    await expect(
      suspendUser(moderator.auth, admin.id, "attempted takeover"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const stillActive = await db.user.findUniqueOrThrow({
      where: { id: admin.id },
      select: { status: true },
    });
    expect(stillActive.status).toBe("ACTIVE");

    // The attempt is recorded, because a failed escalation is a security event.
    const audit = await db.auditLog.findFirst({
      where: { action: "admin.impersonation_denied", entityId: admin.id },
    });
    expect(audit).not.toBeNull();
  });

  it("revokes sessions and pauses listings when an account is suspended", async () => {
    const admin = await makeUser({ roles: ["USER", "ADMIN"] });
    const offender = await makeUser();
    const pet = await makePet(offender.id);
    const listing = await makeListing(offender.id, pet.id);

    await db.session.create({
      data: {
        userId: offender.id,
        tokenHash: `hash-${Date.now()}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    await suspendUser(admin.auth, offender.id, "fraudulent listings", 30);

    const suspended = await db.user.findUniqueOrThrow({
      where: { id: offender.id },
      select: { status: true, statusUntil: true },
    });
    expect(suspended.status).toBe("SUSPENDED");
    expect(suspended.statusUntil).not.toBeNull();

    // A suspension that leaves live sessions is theatre.
    const live = await db.session.count({
      where: { userId: offender.id, revokedAt: null },
    });
    expect(live).toBe(0);

    const paused = await db.listing.findUniqueOrThrow({
      where: { id: listing.id },
      select: { status: true },
    });
    expect(paused.status).toBe("PAUSED");
  });
});

describe("input validation", () => {
  it("blocks private and non-http URLs", () => {
    const blocked = [
      "http://localhost/admin",
      "http://127.0.0.1:8080",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5",
      "http://192.168.1.1",
      "http://172.16.0.1",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "http://[::1]/",
    ];
    for (const url of blocked) {
      expect(externalUrlSchema.safeParse(url).success, url).toBe(false);
    }

    expect(externalUrlSchema.safeParse("https://example.com/page").success).toBe(true);
  });

  it("only allows same-origin redirect targets", () => {
    expect(safeRedirect("/dashboard")).toBe("/dashboard");
    // Protocol-relative URLs are the classic open-redirect bypass.
    expect(safeRedirect("//evil.example.com")).toBe("/dashboard");
    expect(safeRedirect("https://evil.example.com")).toBe("/dashboard");
    expect(safeRedirect("/\\evil.example.com")).toBe("/dashboard");
    expect(safeRedirect(null)).toBe("/dashboard");
  });

  it("strips control characters from text input", () => {
    const schema = safeText(100);
    const withNull = `hello${String.fromCharCode(0)}world`;
    expect(schema.safeParse(withNull).success).toBe(false);

    // Ordinary text, including accents and emoji, must pass.
    expect(schema.safeParse("Café  Münchener").success).toBe(true);
    const collapsed = schema.parse("  spaced    out  ");
    expect(collapsed).toBe("spaced out");
  });
});
