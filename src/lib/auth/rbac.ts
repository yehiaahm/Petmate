import "server-only";
import { db } from "@/lib/db";
import type { Role } from "@/lib/constants";
import { forbidden, notFound, unauthenticated } from "@/lib/errors";
import { getAuth, type AuthContext, type SessionUser } from "./session";

/**
 * Authorization.
 *
 * Two layers, and both are mandatory:
 *
 *   * ROLE checks  — "can this kind of account do this kind of thing"
 *   * OWNERSHIP    — "does this specific row belong to this specific caller"
 *
 * A role check alone is how IDOR bugs happen: every admin is a seller of
 * nothing in particular, and every seller can reach `/api/listings/:id`. So
 * each `assertOwns*` helper below re-reads the row and compares the owner
 * column server-side. No handler takes an owner id from the request body.
 */

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export const PERMISSIONS = [
  "listing:create",
  "listing:moderate",
  "pet:create",
  "breeding:request",
  "clinic:manage",
  "clinic:records",
  "shop:manage",
  "delivery:fulfil",
  "admin:read",
  "admin:users",
  "admin:moderation",
  "admin:finance",
  "admin:settings",
  "admin:destructive",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  USER: ["listing:create", "pet:create", "breeding:request"],
  BREEDER: ["listing:create", "pet:create", "breeding:request"],
  SELLER: ["listing:create", "pet:create", "shop:manage"],
  VET: ["clinic:records", "pet:create"],
  CLINIC_ADMIN: ["clinic:manage", "clinic:records"],
  COURIER: ["delivery:fulfil"],
  MODERATOR: ["admin:read", "admin:moderation", "listing:moderate"],
  ADMIN: [
    "admin:read",
    "admin:users",
    "admin:moderation",
    "admin:finance",
    "admin:settings",
    "listing:moderate",
    "clinic:manage",
    "shop:manage",
  ],
  SUPER_ADMIN: [...PERMISSIONS],
};

export function permissionsFor(roles: Role[]): Set<Permission> {
  const out = new Set<Permission>();
  // Everyone gets the baseline USER grants, even an account created as a clinic.
  for (const p of ROLE_PERMISSIONS.USER) out.add(p);
  for (const role of roles) {
    for (const p of ROLE_PERMISSIONS[role] ?? []) out.add(p);
  }
  return out;
}

export function can(user: SessionUser | null, permission: Permission): boolean {
  if (!user) return false;
  return permissionsFor(user.roles).has(permission);
}

export function hasRole(user: SessionUser | null, ...roles: Role[]): boolean {
  if (!user) return false;
  return roles.some((r) => user.roles.includes(r));
}

export const isStaff = (user: SessionUser | null) =>
  hasRole(user, "MODERATOR", "ADMIN", "SUPER_ADMIN");

// ---------------------------------------------------------------------------
// Assertions — these throw, and the API wrapper turns them into responses
// ---------------------------------------------------------------------------

export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) throw unauthenticated();
  return auth;
}

/** Authenticated *and* allowed to perform write operations. */
export async function requireActive(): Promise<AuthContext> {
  const auth = await requireAuth();
  if (auth.user.status === "SUSPENDED") {
    throw forbidden("Your account is suspended. Open a support ticket to appeal.");
  }
  if (auth.user.status === "FROZEN") {
    throw forbidden("Your account is temporarily frozen while we review recent activity.");
  }
  return auth;
}

/**
 * For actions that create financial or public exposure. An unverified email is
 * the single cheapest signal that an account is disposable.
 */
export async function requireVerifiedEmail(): Promise<AuthContext> {
  const auth = await requireActive();
  if (!auth.user.emailVerified) {
    throw forbidden("Please confirm your email address before continuing.");
  }
  return auth;
}

export async function requirePermission(permission: Permission): Promise<AuthContext> {
  const auth = await requireActive();
  if (!permissionsFor(auth.user.roles).has(permission)) {
    throw forbidden("You do not have permission to do that.", `missing ${permission}`);
  }
  return auth;
}

export async function requireRole(...roles: Role[]): Promise<AuthContext> {
  const auth = await requireActive();
  if (!roles.some((r) => auth.user.roles.includes(r))) {
    throw forbidden("You do not have permission to do that.", `missing role ${roles.join("|")}`);
  }
  return auth;
}

export async function requireStaff(): Promise<AuthContext> {
  return requireRole("MODERATOR", "ADMIN", "SUPER_ADMIN");
}

export async function requireAdmin(): Promise<AuthContext> {
  return requireRole("ADMIN", "SUPER_ADMIN");
}

// ---------------------------------------------------------------------------
// Ownership — the row is always re-read here, never trusted from input
// ---------------------------------------------------------------------------

/**
 * A missing row and a row owned by someone else both raise 404, not 403.
 * Answering 403 would confirm the id exists, which is an enumeration oracle.
 */
function denyAsMissing(what: string): never {
  throw notFound(what);
}

export async function assertOwnsPet(petId: string, auth: AuthContext) {
  const pet = await db.pet.findFirst({
    where: { id: petId, deletedAt: null },
    select: { id: true, ownerId: true, name: true },
  });
  if (!pet) denyAsMissing("That pet");
  if (pet.ownerId !== auth.user.id && !isStaff(auth.user)) denyAsMissing("That pet");
  return pet;
}

export async function assertOwnsListing(listingId: string, auth: AuthContext) {
  const listing = await db.listing.findFirst({
    where: { id: listingId, deletedAt: null },
    select: { id: true, sellerId: true, petId: true, status: true, intent: true, slug: true },
  });
  if (!listing) denyAsMissing("That listing");
  if (listing.sellerId !== auth.user.id && !isStaff(auth.user)) denyAsMissing("That listing");
  return listing;
}

export async function assertOwnsShop(shopId: string, auth: AuthContext) {
  const shop = await db.shop.findFirst({
    where: { id: shopId, deletedAt: null },
    select: { id: true, ownerUserId: true, status: true, name: true, commissionBps: true },
  });
  if (!shop) denyAsMissing("That shop");
  if (shop.ownerUserId !== auth.user.id && !isStaff(auth.user)) denyAsMissing("That shop");
  return shop;
}

/**
 * Clinic access is membership-based, not ownership-based: a clinic has staff.
 * `minRole` walks the clinic's own hierarchy.
 */
export async function assertClinicAccess(
  clinicId: string,
  auth: AuthContext,
  minRole: "STAFF" | "VET" | "ADMIN" | "OWNER" = "STAFF",
) {
  const clinic = await db.clinic.findFirst({
    where: { id: clinicId, deletedAt: null },
    select: {
      id: true,
      ownerUserId: true,
      name: true,
      status: true,
      commissionBps: true,
      members: { where: { userId: auth.user.id }, select: { role: true } },
    },
  });
  if (!clinic) denyAsMissing("That clinic");

  if (isStaff(auth.user)) return clinic;

  const rank = { STAFF: 0, VET: 1, ADMIN: 2, OWNER: 3 } as const;
  const membership = clinic.members[0]?.role as keyof typeof rank | undefined;
  const effective = clinic.ownerUserId === auth.user.id ? "OWNER" : membership;

  if (!effective || rank[effective] < rank[minRole]) denyAsMissing("That clinic");
  return clinic;
}

export async function assertOwnsOrder(orderId: string, auth: AuthContext) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, buyerId: true, status: true, orderNumber: true, totalCents: true },
  });
  if (!order) denyAsMissing("That order");
  if (order.buyerId !== auth.user.id && !isStaff(auth.user)) denyAsMissing("That order");
  return order;
}

/** A conversation is readable only by a participant who has not left it. */
export async function assertConversationAccess(conversationId: string, auth: AuthContext) {
  const participant = await db.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId: auth.user.id } },
    select: { id: true, leftAt: true, conversationId: true, lastReadAt: true },
  });
  if (!participant || participant.leftAt) denyAsMissing("That conversation");
  return participant;
}

/**
 * Health records are the most sensitive data on the platform. Readable by the
 * pet's owner, by clinic staff who have actually treated the animal, and by a
 * buyer only while a transaction is live — never by the public.
 */
export async function assertPetHealthAccess(petId: string, auth: AuthContext) {
  const pet = await db.pet.findFirst({
    where: { id: petId, deletedAt: null },
    select: { id: true, ownerId: true, name: true },
  });
  if (!pet) denyAsMissing("That pet");

  if (pet.ownerId === auth.user.id || isStaff(auth.user)) {
    return { pet, access: "FULL" as const };
  }

  const treatedHere = await db.appointment.findFirst({
    where: {
      petId,
      clinic: {
        OR: [
          { ownerUserId: auth.user.id },
          { members: { some: { userId: auth.user.id } } },
        ],
      },
    },
    select: { id: true },
  });
  if (treatedHere) return { pet, access: "CLINICAL" as const };

  denyAsMissing("That pet");
}
