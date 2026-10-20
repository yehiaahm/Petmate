import { describe, it, expect, beforeEach } from "vitest";
import { db, makeUser, makePet, makeListing, makeClinicWithService, resetDatabase } from "./helpers";
import {
  accessFor,
  exportCsv,
  purgeRecord,
  resolveResource,
  restoreRecord,
  softDeleteRecord,
  updateRecord,
} from "@/lib/admin/data.service";
import { getResource, type ResourceDef } from "@/lib/admin/registry";
import { addDays } from "@/lib/utils";

/**
 * The admin data service is the only thing between a staff click and a raw
 * table write, so these tests go through it exactly as the API route does and
 * then read the database directly to prove what did (and did not) change.
 */

function table(key: string): ResourceDef {
  const def = getResource(key);
  if (!def) throw new Error(`No admin resource "${key}" in the registry`);
  return def;
}

const users = () => table("users");
const listings = () => table("listings");
const sessions = () => table("sessions");

let tokenCounter = 0;
async function makeSession(userId: string) {
  return db.session.create({
    data: {
      userId,
      tokenHash: `test-token-${Date.now()}-${tokenCounter++}`,
      expiresAt: addDays(new Date(), 30),
    },
    select: { id: true },
  });
}

async function auditRows(action: string, entityId?: string) {
  return db.auditLog.findMany({
    where: { action, ...(entityId ? { entityId } : {}) },
    orderBy: { createdAt: "asc" },
  });
}

describe("admin data: updateRecord", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects fields outside the caller's editable list, including ones the registry never exposes", async () => {
    const admin = await makeUser({ roles: ["USER", "ADMIN"] });
    const target = await makeUser();
    const before = await db.user.findUniqueOrThrow({ where: { id: target.id }, select: { passwordHash: true } });

    // Not in the registry at all: the allow-list must not let it through.
    await expect(
      updateRecord(admin.auth, users(), target.id, { passwordHash: "scrypt$attacker" }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: [expect.objectContaining({ field: "passwordHash" })],
    });

    // Listed in the registry, but only for display.
    await expect(
      updateRecord(admin.auth, users(), target.id, { completedSales: 999 }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    // One bad key spoils the whole patch; the valid half is not applied either.
    await expect(
      updateRecord(admin.auth, users(), target.id, { name: "Half Applied", passwordHash: "x" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const after = await db.user.findUniqueOrThrow({
      where: { id: target.id },
      select: { passwordHash: true, name: true, completedSales: true },
    });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.name).not.toBe("Half Applied");
    expect(after.completedSales).toBe(0);
  });

  it("applies field-level permissions on top of table access", async () => {
    const moderator = await makeUser({ roles: ["USER", "MODERATOR"] });
    const admin = await makeUser({ roles: ["USER", "ADMIN"] });
    const owner = await makeUser({ roles: ["USER", "CLINIC_ADMIN"] });
    const { clinicId } = await makeClinicWithService(owner.id);

    // Moderators may edit clinics, but the commission override is a finance call.
    expect(accessFor(moderator.auth, table("clinics")).editable).not.toContain("commissionBps");
    await expect(
      updateRecord(moderator.auth, table("clinics"), clinicId, { commissionBps: 100 }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await expect(
      updateRecord(admin.auth, table("clinics"), clinicId, { commissionBps: 100 }),
    ).resolves.toEqual({ changed: ["commissionBps"] });
  });

  it("rejects out-of-range values without writing anything", async () => {
    const admin = await makeUser({ roles: ["USER", "ADMIN"] });
    const target = await makeUser({ trustScore: 40 });

    await expect(
      updateRecord(admin.auth, users(), target.id, { trustScore: 500 }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: [expect.objectContaining({ field: "trustScore" })],
    });
    await expect(
      updateRecord(admin.auth, users(), target.id, { trustScore: 12.5 }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      updateRecord(admin.auth, users(), target.id, { status: "GOD_MODE" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const after = await db.user.findUniqueOrThrow({ where: { id: target.id }, select: { trustScore: true, status: true } });
    expect(after).toEqual({ trustScore: 40, status: "ACTIVE" });
    expect(await auditRows("admin.record_updated", target.id)).toHaveLength(0);
  });

  it("writes an audit row with the before and after value of every changed field", async () => {
    const admin = await makeUser({ roles: ["USER", "ADMIN"] });
    const target = await makeUser({ name: "Original Name", trustScore: 50 });

    const result = await updateRecord(
      admin.auth,
      users(),
      target.id,
      // `name` changes, `trustScore` changes, `city` is sent unchanged.
      { name: "Renamed Member", trustScore: 75, city: "Cairo" },
      { ip: "203.0.113.7", userAgent: "vitest" },
    );
    expect(result.changed.sort()).toEqual(["name", "trustScore"]);

    const row = await db.user.findUniqueOrThrow({ where: { id: target.id }, select: { name: true, trustScore: true } });
    expect(row).toEqual({ name: "Renamed Member", trustScore: 75 });

    const logs = await auditRows("admin.record_updated", target.id);
    expect(logs).toHaveLength(1);
    const log = logs[0]!;
    expect(log.actorId).toBe(admin.id);
    expect(log.entityType).toBe("USER");
    expect(log.ip).toBe("203.0.113.7");

    const metadata = JSON.parse(log.metadata ?? "{}");
    expect(metadata.resource).toBe("users");
    expect(metadata.changes).toEqual({
      name: { from: "Original Name", to: "Renamed Member" },
      trustScore: { from: 50, to: 75 },
    });
  });

  it("returns changed: [] for a no-op edit and leaves no audit row", async () => {
    const admin = await makeUser({ roles: ["USER", "ADMIN"] });
    const target = await makeUser({ name: "Same Name", trustScore: 50 });

    await expect(
      updateRecord(admin.auth, users(), target.id, { name: "Same Name", trustScore: 50 }),
    ).resolves.toEqual({ changed: [] });

    expect(await auditRows("admin.record_updated", target.id)).toHaveLength(0);
  });

  it("keeps emailNormalized in step when the email is edited", async () => {
    const admin = await makeUser({ roles: ["USER", "ADMIN"] });
    const target = await makeUser();

    await updateRecord(admin.auth, users(), target.id, { email: "  Renamed.Member@Example.TEST " });

    const row = await db.user.findUniqueOrThrow({
      where: { id: target.id },
      select: { email: true, emailNormalized: true },
    });
    expect(row.email).toBe("renamed.member@example.test");
    expect(row.emailNormalized).toBe("renamed.member@example.test");
  });

  it("maps a duplicate email to CONFLICT", async () => {
    const admin = await makeUser({ roles: ["USER", "ADMIN"] });
    const taken = await makeUser();
    const target = await makeUser();

    await expect(
      updateRecord(admin.auth, users(), target.id, { email: taken.email }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("revokes live sessions when an account is suspended", async () => {
    const admin = await makeUser({ roles: ["USER", "ADMIN"] });
    const target = await makeUser();
    await makeSession(target.id);

    await updateRecord(admin.auth, users(), target.id, { status: "SUSPENDED" });

    expect(await db.session.count({ where: { userId: target.id, revokedAt: null } })).toBe(0);
  });
});

describe("admin data: read-only tables", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it.each(["payments", "ledger", "invoices", "audit-logs"])(
    "refuses every write to %s, even for a super admin",
    async (key) => {
      const superAdmin = await makeUser({ roles: ["USER", "SUPER_ADMIN"] });
      const def = table(key);

      expect(def.write).toBeNull();
      expect(accessFor(superAdmin.auth, def)).toMatchObject({ read: true, write: false, purge: false, editable: [] });

      // The write check comes first, so the id never needs to exist.
      await expect(
        updateRecord(superAdmin.auth, def, "any-record-id", { status: "SUCCEEDED" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(softDeleteRecord(superAdmin.auth, def, "any-record-id")).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(purgeRecord(superAdmin.auth, def, "any-record-id")).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    },
  );
});

describe("admin data: privilege guards", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("stops a moderator from editing or archiving a super admin", async () => {
    const moderator = await makeUser({ roles: ["USER", "MODERATOR"] });
    const superAdmin = await makeUser({ roles: ["USER", "SUPER_ADMIN"], name: "Root Account" });

    await expect(
      updateRecord(moderator.auth, users(), superAdmin.id, { name: "Owned" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(softDeleteRecord(moderator.auth, users(), superAdmin.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const row = await db.user.findUniqueOrThrow({ where: { id: superAdmin.id }, select: { name: true, deletedAt: true } });
    expect(row).toEqual({ name: "Root Account", deletedAt: null });
  });

  it("stops an admin from editing, archiving or signing out a super admin, and audits the attempt", async () => {
    const admin = await makeUser({ roles: ["USER", "ADMIN"] });
    const superAdmin = await makeUser({ roles: ["USER", "SUPER_ADMIN"], name: "Root Account" });
    const session = await makeSession(superAdmin.id);

    await expect(
      updateRecord(admin.auth, users(), superAdmin.id, { name: "Owned" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      updateRecord(admin.auth, users(), superAdmin.id, { status: "BANNED" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(softDeleteRecord(admin.auth, users(), superAdmin.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // The same guard follows the account into its sessions.
    await expect(softDeleteRecord(admin.auth, sessions(), session.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const row = await db.user.findUniqueOrThrow({
      where: { id: superAdmin.id },
      select: { name: true, status: true, deletedAt: true },
    });
    expect(row).toEqual({ name: "Root Account", status: "ACTIVE", deletedAt: null });
    const live = await db.session.findUniqueOrThrow({ where: { id: session.id }, select: { revokedAt: true } });
    expect(live.revokedAt).toBeNull();

    const denied = await auditRows("admin.impersonation_denied");
    expect(denied).toHaveLength(4);
    expect(denied.every((d) => d.actorId === admin.id)).toBe(true);
  });

  it("lets a super admin manage another super admin", async () => {
    const actor = await makeUser({ roles: ["USER", "SUPER_ADMIN"] });
    const peer = await makeUser({ roles: ["USER", "SUPER_ADMIN"] });

    await expect(
      updateRecord(actor.auth, users(), peer.id, { name: "Peer Renamed" }),
    ).resolves.toEqual({ changed: ["name"] });
  });

  it("does not let anyone archive or purge their own account", async () => {
    const admin = await makeUser({ roles: ["USER", "ADMIN"] });
    const superAdmin = await makeUser({ roles: ["USER", "SUPER_ADMIN"] });

    await expect(softDeleteRecord(admin.auth, users(), admin.id)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(softDeleteRecord(superAdmin.auth, users(), superAdmin.id)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(purgeRecord(superAdmin.auth, users(), superAdmin.id)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });

    const rows = await db.user.findMany({
      where: { id: { in: [admin.id, superAdmin.id] } },
      select: { deletedAt: true, status: true },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.deletedAt === null && r.status === "ACTIVE")).toBe(true);
  });

  it("does not let anyone change the status of their own account", async () => {
    const admin = await makeUser({ roles: ["USER", "ADMIN"] });
    const superAdmin = await makeUser({ roles: ["USER", "SUPER_ADMIN"] });

    await expect(
      updateRecord(admin.auth, users(), admin.id, { status: "SUSPENDED" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      updateRecord(superAdmin.auth, users(), superAdmin.id, { status: "DEACTIVATED" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // Other fields of one's own account stay editable.
    await expect(
      updateRecord(admin.auth, users(), admin.id, { name: "Self Edited" }),
    ).resolves.toEqual({ changed: ["name"] });

    const rows = await db.user.findMany({ where: { id: { in: [admin.id, superAdmin.id] } }, select: { status: true } });
    expect(rows.map((r) => r.status)).toEqual(["ACTIVE", "ACTIVE"]);
  });
});

describe("admin data: archive and restore", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("archives a listing by stamping deletedAt and restores it by clearing it", async () => {
    const moderator = await makeUser({ roles: ["USER", "MODERATOR"] });
    const seller = await makeUser();
    const pet = await makePet(seller.id);
    const listing = await makeListing(seller.id, pet.id);

    await softDeleteRecord(moderator.auth, listings(), listing.id);
    const archived = await db.listing.findUniqueOrThrow({ where: { id: listing.id }, select: { deletedAt: true } });
    expect(archived.deletedAt).toBeInstanceOf(Date);
    expect(await auditRows("admin.record_deleted", listing.id)).toHaveLength(1);

    await restoreRecord(moderator.auth, listings(), listing.id);
    const restored = await db.listing.findUniqueOrThrow({ where: { id: listing.id }, select: { deletedAt: true } });
    expect(restored.deletedAt).toBeNull();
    expect(await auditRows("admin.record_restored", listing.id)).toHaveLength(1);
  });

  it("archiving a member deactivates them, signs them out and takes their live listings down", async () => {
    const admin = await makeUser({ roles: ["USER", "ADMIN"] });
    const target = await makeUser();
    const bystander = await makeUser();

    await makeSession(target.id);
    await makeSession(target.id);
    const bystanderSession = await makeSession(bystander.id);

    const active = await makeListing(target.id, (await makePet(target.id)).id, { status: "ACTIVE" });
    const paused = await makeListing(target.id, (await makePet(target.id)).id, { status: "PAUSED" });
    const sold = await makeListing(target.id, (await makePet(target.id)).id, { status: "COMPLETED" });
    const other = await makeListing(bystander.id, (await makePet(bystander.id)).id, { status: "ACTIVE" });

    await softDeleteRecord(admin.auth, users(), target.id);

    const user = await db.user.findUniqueOrThrow({
      where: { id: target.id },
      select: { status: true, deletedAt: true },
    });
    expect(user.status).toBe("DEACTIVATED");
    expect(user.deletedAt).toBeInstanceOf(Date);

    expect(await db.session.count({ where: { userId: target.id, revokedAt: null } })).toBe(0);
    const untouched = await db.session.findUniqueOrThrow({ where: { id: bystanderSession.id }, select: { revokedAt: true } });
    expect(untouched.revokedAt).toBeNull();

    const statusOf = async (id: string) =>
      (await db.listing.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
    expect(await statusOf(active.id)).toBe("REMOVED");
    expect(await statusOf(paused.id)).toBe("REMOVED");
    // History is not rewritten, and nobody else's listings move.
    expect(await statusOf(sold.id)).toBe("COMPLETED");
    expect(await statusOf(other.id)).toBe("ACTIVE");

    await restoreRecord(admin.auth, users(), target.id);
    const back = await db.user.findUniqueOrThrow({ where: { id: target.id }, select: { status: true, deletedAt: true } });
    expect(back).toEqual({ status: "ACTIVE", deletedAt: null });
  });

  it("revokes a session on delete and refuses to bring it back", async () => {
    const admin = await makeUser({ roles: ["USER", "ADMIN"] });
    const target = await makeUser();
    const session = await makeSession(target.id);

    await softDeleteRecord(admin.auth, sessions(), session.id);
    const revoked = await db.session.findUniqueOrThrow({ where: { id: session.id }, select: { revokedAt: true } });
    expect(revoked.revokedAt).toBeInstanceOf(Date);

    await expect(restoreRecord(admin.auth, sessions(), session.id)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const still = await db.session.findUniqueOrThrow({ where: { id: session.id }, select: { revokedAt: true } });
    expect(still.revokedAt).toEqual(revoked.revokedAt);
  });
});

describe("admin data: purgeRecord", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("needs admin:destructive, which only a super admin has", async () => {
    const admin = await makeUser({ roles: ["USER", "ADMIN"] });
    const superAdmin = await makeUser({ roles: ["USER", "SUPER_ADMIN"] });
    const seller = await makeUser();
    const listing = await makeListing(seller.id, (await makePet(seller.id)).id);

    expect(accessFor(admin.auth, listings()).purge).toBe(false);
    await expect(purgeRecord(admin.auth, listings(), listing.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.listing.count({ where: { id: listing.id } })).toBe(1);

    await purgeRecord(superAdmin.auth, listings(), listing.id);
    expect(await db.listing.count({ where: { id: listing.id } })).toBe(0);

    const logs = await auditRows("admin.record_purged", listing.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.actorId).toBe(superAdmin.id);
  });

  it("refuses tables that only allow archiving, even for a super admin", async () => {
    const superAdmin = await makeUser({ roles: ["USER", "SUPER_ADMIN"] });
    const target = await makeUser();
    const session = await makeSession(target.id);

    expect(sessions().hardDelete).toBeFalsy();
    await expect(purgeRecord(superAdmin.auth, sessions(), session.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.session.count({ where: { id: session.id } })).toBe(1);
  });

  it("maps a delete blocked by a foreign key to CONFLICT", async () => {
    const superAdmin = await makeUser({ roles: ["USER", "SUPER_ADMIN"] });
    const previousOwner = await makeUser();
    const newOwner = await makeUser();
    const pet = await makePet(newOwner.id);

    // Ownership history references the member without a cascade, on purpose.
    await db.petTransfer.create({
      data: {
        petId: pet.id,
        fromUserId: previousOwner.id,
        toUserId: newOwner.id,
        reason: "GIFT",
        status: "ACCEPTED",
      },
    });

    await expect(purgeRecord(superAdmin.auth, users(), previousOwner.id)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await db.user.count({ where: { id: previousOwner.id } })).toBe(1);
    expect(await auditRows("admin.record_purged", previousOwner.id)).toHaveLength(0);
  });
});

describe("admin data: resolveResource", () => {
  it("answers an unknown table and an unreadable one the same way", async () => {
    await resetDatabase();
    const moderator = await makeUser({ roles: ["USER", "MODERATOR"] });
    const member = await makeUser();

    const errorFrom = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return error;
      }
      return null;
    };

    const unknown = errorFrom(() => resolveResource(moderator.auth, "no-such-table"));
    expect(unknown).toMatchObject({ code: "NOT_FOUND" });
    // Moderators lack admin:users and admin:finance, and must not learn that those tables exist.
    expect(errorFrom(() => resolveResource(moderator.auth, "users"))).toMatchObject({
      code: "NOT_FOUND",
      message: (unknown as Error).message,
    });
    expect(errorFrom(() => resolveResource(moderator.auth, "payments"))).toMatchObject({ code: "NOT_FOUND" });
    // A plain member reads nothing at all.
    expect(errorFrom(() => resolveResource(member.auth, "listings"))).toMatchObject({ code: "NOT_FOUND" });

    expect(resolveResource(moderator.auth, "listings").key).toBe("listings");
  });
});

describe("admin data: exportCsv", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("neutralises cells a spreadsheet would execute", async () => {
    const admin = await makeUser({ roles: ["USER", "ADMIN"], name: "Plain Admin" });
    for (const name of ["=HYPERLINK(evil)", "+cmd|calc", "-2+3", "@SUM(A1)", "=A1,B1"]) {
      await makeUser({ name });
    }

    const { csv, count } = await exportCsv(admin.auth, users(), {});
    expect(count).toBe(6);
    // A BOM, so Excel reads UTF-8 names correctly.
    expect(csv.charCodeAt(0)).toBe(0xfeff);

    expect(csv).toContain(",'=HYPERLINK(evil),");
    expect(csv).toContain(",'+cmd|calc,");
    expect(csv).toContain(",'-2+3,");
    expect(csv).toContain(",'@SUM(A1),");
    // Prefixed first, then quoted because of the comma.
    expect(csv).toContain(`,"'=A1,B1",`);
    // Nothing reaches a cell boundary unescaped.
    expect(csv).not.toMatch(/(^|,)"?[=+\-@]/m);
    // Ordinary values are left alone.
    expect(csv).toContain(",Plain Admin,");

    const logs = await auditRows("admin.data_exported");
    expect(logs).toHaveLength(1);
    expect(logs[0]!.actorId).toBe(admin.id);
  });

  it("never exports columns the registry does not list", async () => {
    const admin = await makeUser({ roles: ["USER", "ADMIN"] });
    const { csv } = await exportCsv(admin.auth, users(), {});
    const header = csv.slice(1).split("\r\n")[0]!;

    expect(header).toContain("Email");
    expect(header.toLowerCase()).not.toContain("password");
    expect(csv).not.toContain("scrypt$");
  });
});
