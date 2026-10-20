import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { permissionsFor } from "@/lib/auth/rbac";
import type { AuthContext } from "@/lib/auth/session";
import { AppError, badRequest, conflict, dependencyFailed, forbidden, notFound } from "@/lib/errors";
import { buildSearchText, normalizeSearchText } from "@/lib/search/text";
import { parseJson, redact } from "@/lib/json";
import { cuidSchema, safeParagraph, safeText } from "@/lib/validation/common";
import {
  RESOURCES,
  getResource,
  fieldOf,
  humanize,
  type FieldDef,
  type ResourceDef,
} from "./registry";

/**
 * Generic data access for the admin console.
 *
 * Everything is driven by the registry, and the registry is an allow-list:
 * a column that is not declared there is never selected, filtered, sorted on
 * or written. Every write is re-authorised here (not only in the route), runs
 * the same privilege guards as the purpose-built admin actions, and leaves an
 * audit row with the before and after value of every changed field.
 */

export type Row = Record<string, unknown>;

interface Delegate {
  findMany(args: unknown): Promise<Row[]>;
  findUnique(args: unknown): Promise<Row | null>;
  count(args: unknown): Promise<number>;
  update(args: unknown): Promise<Row>;
  delete(args: unknown): Promise<Row>;
}

function delegate(def: ResourceDef): Delegate {
  const d = (db as unknown as Record<string, Delegate | undefined>)[def.model];
  if (!d) throw notFound("That table");
  return d;
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

export interface ResourceAccess {
  read: boolean;
  write: boolean;
  purge: boolean;
  /** Editable fields this caller may change (field-level permissions applied). */
  editable: string[];
}

export function accessFor(auth: AuthContext, def: ResourceDef): ResourceAccess {
  const perms = permissionsFor(auth.user.roles);
  const read = perms.has(def.read);
  const write = read && def.write !== null && perms.has(def.write);
  return {
    read,
    write,
    purge: write && Boolean(def.hardDelete) && perms.has("admin:destructive"),
    editable: write
      ? def.fields.filter((f) => f.editable && (!f.permission || perms.has(f.permission))).map((f) => f.key)
      : [],
  };
}

/**
 * A table the caller cannot read answers exactly like one that does not
 * exist, so the console never confirms what a narrower role is missing.
 */
export function resolveResource(auth: AuthContext, key: string): ResourceDef {
  const def = getResource(key);
  if (!def || !accessFor(auth, def).read) throw notFound("That table");
  return def;
}

export function readableResources(auth: AuthContext): ResourceDef[] {
  return RESOURCES.filter((r) => accessFor(auth, r).read);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type ListView = "active" | "deleted" | "all";

export interface ListQuery {
  q?: string;
  page: number;
  limit: number;
  sort?: string;
  dir?: "asc" | "desc";
  filters?: Record<string, string>;
  view?: ListView;
}

const FILTERABLE_TYPES = new Set(["id", "ref", "text", "email", "enum", "boolean"]);
const UNSORTABLE_TYPES = new Set(["json", "textarea"]);

function buildWhere(def: ResourceDef, query: ListQuery): Row {
  const and: Row[] = [];
  const filters = query.filters ?? {};

  // Soft delete decides what the default view shows. A filter on the same
  // column wins, so "status = REMOVED" on reviews is not silently emptied.
  const sd = def.softDelete;
  if (sd && !(sd.field in filters)) {
    const view = query.view ?? "active";
    if (view === "deleted") {
      and.push(sd.value === "now" ? { [sd.field]: { not: null } } : { [sd.field]: sd.value });
    } else if (view === "active") {
      and.push(sd.value === "now" ? { [sd.field]: null } : { [sd.field]: { not: sd.value } });
    }
  }

  for (const [key, raw] of Object.entries(filters)) {
    const field = fieldOf(def, key);
    if (!field || !FILTERABLE_TYPES.has(field.type)) continue;
    const value = raw.slice(0, 120);
    if (field.type === "boolean") and.push({ [key]: value === "true" });
    else if (value === "null") and.push({ [key]: null });
    else and.push({ [key]: value });
  }

  const term = query.q?.trim().slice(0, 100);
  if (term) {
    const or: Row[] = [];
    if (/^[a-zA-Z0-9_-]{16,64}$/.test(term)) or.push({ id: term });
    for (const key of def.search) {
      const needle =
        key === "searchText" ? normalizeSearchText(term) : key === "emailNormalized" ? term.toLowerCase() : term;
      if (needle) or.push({ [key]: { contains: needle } });
    }
    for (const key of def.exact ?? []) {
      or.push({ [key]: term });
      if (term.toUpperCase() !== term) or.push({ [key]: term.toUpperCase() });
    }
    and.push({ OR: or });
  }

  return and.length ? { AND: and } : {};
}

/** The columns a list page needs: what it shows, plus what links and labels need. */
function listSelect(def: ResourceDef): Record<string, true> {
  const wanted = new Set<string>([
    "id",
    def.title,
    ...(def.subtitle ? [def.subtitle] : []),
    ...(def.status ? [def.status] : []),
    ...(def.softDelete ? [def.softDelete.field] : []),
    ...def.columns,
    "slug",
    "handle",
    "passportNo",
    "currency",
    "createdAt",
  ]);
  const select: Record<string, true> = {};
  for (const key of wanted) if (fieldOf(def, key)) select[key] = true;
  return select;
}

function fullSelect(def: ResourceDef): Record<string, true> {
  return Object.fromEntries(def.fields.map((f) => [f.key, true]));
}

/** Dates become ISO strings and JSON columns are redacted, so rows can cross to the client. */
function serialize(def: ResourceDef, row: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    const field = fieldOf(def, key);
    if (value instanceof Date) out[key] = value.toISOString();
    else if (field?.type === "json" && typeof value === "string") {
      const parsed = parseJson<unknown>(value, value);
      out[key] = typeof parsed === "string" ? parsed : JSON.stringify(redact(parsed), null, 2);
    } else out[key] = value;
  }
  return out;
}

function mapDbError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      const target = (error.meta?.target as string[] | string | undefined) ?? "value";
      const fields = Array.isArray(target) ? target.join(", ") : target;
      throw conflict(`That ${fields} is already used by another record.`);
    }
    if (error.code === "P2025") throw notFound("That record");
    if (error.code === "P2003" || error.code === "P2014") {
      throw conflict(
        "Other records still point at this one, so it cannot be removed permanently. Archive it instead, or remove what depends on it first.",
      );
    }
    if (error.code === "P2021" || error.code === "P2022") {
      throw dependencyFailed(
        "This table is not in the database yet. Run `npm run db:push` to bring the schema up to date.",
        error.message,
      );
    }
  }
  throw error;
}

export type RefLabels = Record<string, Record<string, string>>;

/** One query per referenced table, so a page of 50 rows costs a handful of lookups, not 50. */
async function resolveRefs(def: ResourceDef, rows: Row[], keys: string[]): Promise<RefLabels> {
  const wanted = new Map<string, Set<string>>();
  for (const key of keys) {
    const field = fieldOf(def, key);
    if (field?.type !== "ref" || !field.ref) continue;
    const ids = wanted.get(field.ref) ?? new Set<string>();
    for (const row of rows) {
      const value = row[key];
      if (typeof value === "string" && value) ids.add(value);
    }
    wanted.set(field.ref, ids);
  }

  const labels: RefLabels = {};
  await Promise.all(
    [...wanted.entries()].map(async ([resourceKey, ids]) => {
      const target = getResource(resourceKey);
      if (!target || ids.size === 0) return;
      const select: Record<string, true> = { id: true, [target.title]: true };
      if (target.subtitle) select[target.subtitle] = true;
      try {
        const found = await delegate(target).findMany({ where: { id: { in: [...ids] } }, select });
        labels[resourceKey] = Object.fromEntries(found.map((r) => [r.id as string, labelFor(target, r)]));
      } catch {
        // A missing table must not take the whole page down with it.
      }
    }),
  );
  return labels;
}

export function labelFor(def: ResourceDef, row: Row): string {
  const title = row[def.title];
  if (def.title !== "id" && typeof title === "string" && title.trim()) return title.slice(0, 80);
  const subtitle = def.subtitle ? row[def.subtitle] : null;
  const short = String(row.id ?? "").slice(-6);
  return typeof subtitle === "string" && subtitle ? `${humanize(subtitle)} · ${short}` : `${def.label} ${short}`;
}

export async function listRecords(def: ResourceDef, query: ListQuery) {
  const d = delegate(def);
  const where = buildWhere(def, query);

  const sortField = query.sort && fieldOf(def, query.sort);
  const orderBy =
    sortField && !UNSORTABLE_TYPES.has(sortField.type)
      ? [{ [sortField.key]: query.dir === "asc" ? "asc" : "desc" }, { id: "desc" }]
      : [{ [def.sort.field]: def.sort.dir }, { id: "desc" }];

  try {
    const [rows, total] = await Promise.all([
      d.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: listSelect(def),
      }),
      d.count({ where }),
    ]);
    const refs = await resolveRefs(def, rows, def.columns);
    return {
      rows: rows.map((r) => serialize(def, r)),
      refs,
      total,
      page: query.page,
      pages: Math.max(1, Math.ceil(total / query.limit)),
    };
  } catch (error) {
    mapDbError(error);
  }
}

export async function countRecords(def: ResourceDef, view: ListView = "active"): Promise<number | null> {
  try {
    return await delegate(def).count({ where: buildWhere(def, { page: 1, limit: 1, view }) });
  } catch {
    return null;
  }
}

export async function getRecord(auth: AuthContext, def: ResourceDef, id: string) {
  const d = delegate(def);
  let row: Row | null;
  try {
    row = await d.findUnique({ where: { id }, select: fullSelect(def) });
  } catch (error) {
    mapDbError(error);
  }
  if (!row) throw notFound(`That ${def.label.toLowerCase()}`);

  const refs = await resolveRefs(
    def,
    [row],
    def.fields.filter((f) => f.type === "ref").map((f) => f.key),
  );

  const children = await Promise.all(
    (def.children ?? []).map(async (child) => {
      const target = getResource(child.resource);
      if (!target || !accessFor(auth, target).read) return null;
      try {
        const where = { [child.field]: id };
        const [count, latest] = await Promise.all([
          delegate(target).count({ where }),
          delegate(target).findMany({
            where,
            orderBy: [{ [target.sort.field]: target.sort.dir }],
            take: 5,
            select: listSelect(target),
          }),
        ]);
        return {
          resource: target.key,
          field: child.field,
          label: child.label,
          count,
          rows: latest.map((r) => ({
            id: r.id as string,
            label: labelFor(target, r),
            status: target.status ? ((r[target.status] as string | null) ?? null) : null,
            createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : null,
          })),
        };
      } catch {
        return null;
      }
    }),
  );

  const history = await db.auditLog.findMany({
    where: { entityType: def.entityType, entityId: id },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      action: true,
      summary: true,
      metadata: true,
      createdAt: true,
      actor: { select: { id: true, name: true, handle: true } },
    },
  });

  return {
    row: serialize(def, row),
    refs,
    children: children.filter((c): c is NonNullable<typeof c> => c !== null),
    history: history.map((h) => ({
      id: h.id,
      action: h.action,
      summary: h.summary,
      changes: changesFrom(h.metadata),
      createdAt: h.createdAt.toISOString(),
      actor: h.actor,
    })),
  };
}

function changesFrom(metadata: string | null): { field: string; from: string; to: string }[] {
  const parsed = parseJson<{ changes?: Record<string, { from: unknown; to: unknown }> }>(metadata, {});
  if (!parsed.changes || typeof parsed.changes !== "object") return [];
  return Object.entries(parsed.changes).map(([field, change]) => ({
    field,
    from: displayValue(change?.from),
    to: displayValue(change?.to),
  }));
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value.length > 80 ? `${value.slice(0, 79)}…` : value;
  return String(value);
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

const MONEY_MAX = 10_000_000_000;

function fieldSchema(field: FieldDef): z.ZodType {
  const nullable = Boolean(field.nullable);
  let schema: z.ZodType;

  switch (field.type) {
    case "text":
      schema = safeText(field.max ?? 200, field.min ?? 1);
      break;
    case "textarea":
      schema = safeParagraph(field.max ?? 5000, field.min ?? 1);
      break;
    case "email":
      schema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.").max(254));
      break;
    case "url":
      schema = z
        .string()
        .trim()
        .max(500)
        .refine((v) => /^https?:\/\/\S+$/i.test(v) || /^\/[^\s/]/.test(v), "Use a full https:// link or a site path.");
      break;
    case "int":
    case "bps":
    case "money":
      schema = z
        .number()
        .int("Use a whole number.")
        .min(field.min ?? -MONEY_MAX)
        .max(field.max ?? MONEY_MAX);
      break;
    case "float":
      schema = z
        .number()
        .finite()
        .min(field.min ?? -1e9)
        .max(field.max ?? 1e9);
      break;
    case "boolean":
      schema = z.boolean();
      break;
    case "enum":
      schema = z.enum((field.options ?? []) as [string, ...string[]]);
      break;
    case "datetime":
      schema = z
        .string()
        .refine((v) => !Number.isNaN(Date.parse(v)), "Enter a valid date.")
        .transform((v) => new Date(v));
      break;
    case "json":
      schema = z
        .string()
        .max(20_000)
        .refine((v) => {
          try {
            JSON.parse(v);
            return true;
          } catch {
            return false;
          }
        }, "This must be valid JSON.")
        .transform((v) => JSON.stringify(JSON.parse(v)));
      break;
    case "ref":
    case "id":
      schema = cuidSchema;
      break;
  }

  if (!nullable) return schema;
  return z.preprocess((v) => (v === "" ? null : v), schema.nullable());
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    const ta = a instanceof Date ? a.getTime() : a == null ? null : new Date(a as string).getTime();
    const tb = b instanceof Date ? b.getTime() : b == null ? null : new Date(b as string).getTime();
    return ta === tb;
  }
  return (a ?? null) === (b ?? null);
}

function auditValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.length > 300) return `${value.slice(0, 299)}…`;
  return value;
}

/**
 * Privilege guards. A moderator cannot touch an admin, an admin cannot touch a
 * super admin, and nobody can lock themselves out from the console.
 */
async function guardTarget(
  auth: AuthContext,
  def: ResourceDef,
  id: string,
  op: "edit" | "delete" | "purge",
  patch: Row = {},
) {
  const userId =
    def.key === "users"
      ? id
      : def.key === "sessions"
        ? ((await db.session.findUnique({ where: { id }, select: { userId: true } }))?.userId ?? null)
        : null;
  if (!userId) return;

  if (def.key === "users" && userId === auth.user.id) {
    if (op !== "edit") throw badRequest("You cannot delete your own account from the console.");
    if ("status" in patch) throw badRequest("You cannot change the status of your own account.");
  }

  const target = await db.userRole.findMany({ where: { userId }, select: { role: true } });
  const roles = target.map((r) => r.role);
  const actorIsSuper = auth.user.roles.includes("SUPER_ADMIN");
  const actorIsAdmin = actorIsSuper || auth.user.roles.includes("ADMIN");

  const blocked =
    (roles.includes("SUPER_ADMIN") && !actorIsSuper && userId !== auth.user.id) ||
    (roles.includes("ADMIN") && !actorIsAdmin);

  if (blocked) {
    await audit({
      action: "admin.impersonation_denied",
      actorId: auth.user.id,
      entityType: def.entityType,
      entityId: id,
      summary: `Attempted to ${op} a higher-privileged account`,
    });
    throw forbidden("You cannot change that account.");
  }
}

function assertWrite(auth: AuthContext, def: ResourceDef): void {
  if (!accessFor(auth, def).write) {
    throw forbidden(def.write === null ? `${def.plural} are read-only.` : "You do not have permission to change this.");
  }
}

export async function updateRecord(
  auth: AuthContext,
  def: ResourceDef,
  id: string,
  input: Record<string, unknown>,
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  assertWrite(auth, def);
  const access = accessFor(auth, def);

  const unknown = Object.keys(input).filter((k) => !access.editable.includes(k));
  if (unknown.length) {
    throw new AppError("VALIDATION_ERROR", "Some of those fields cannot be changed.", {
      fields: unknown.map((field) => ({ field, message: "This field is read-only for you." })),
    });
  }

  const shape: Record<string, z.ZodType> = {};
  for (const key of Object.keys(input)) shape[key] = fieldSchema(fieldOf(def, key)!);
  const parsed = z.object(shape).safeParse(input);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", "Please check the highlighted fields.", {
      fields: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
  }

  const patch = parsed.data as Row;
  const keys = Object.keys(patch);
  if (!keys.length) throw badRequest("Nothing to change.");

  const d = delegate(def);
  const before = await d
    .findUnique({ where: { id }, select: { id: true, ...Object.fromEntries(keys.map((k) => [k, true])) } })
    .catch(mapDbError);
  if (!before) throw notFound(`That ${def.label.toLowerCase()}`);

  const changed = keys.filter((k) => !sameValue(before[k], patch[k]));
  if (!changed.length) return { changed: [] as string[] };
  const data: Row = Object.fromEntries(changed.map((k) => [k, patch[k]]));

  await guardTarget(auth, def, id, "edit", data);

  // Columns derived from the ones being edited.
  if (def.key === "users") {
    if (typeof data.email === "string") data.emailNormalized = data.email;
    if (typeof data.handle === "string") data.handle = data.handle.toLowerCase();
  }
  if (def.key === "listings" && data.status === "ACTIVE") {
    const current = await db.listing.findUnique({ where: { id }, select: { publishedAt: true } });
    if (!current?.publishedAt) data.publishedAt = new Date();
  }

  try {
    await d.update({ where: { id }, data, select: { id: true } });
  } catch (error) {
    mapDbError(error);
  }

  await refreshDerived(def, id, changed);

  if (def.key === "users" && typeof data.status === "string" && data.status !== "ACTIVE") {
    // A suspended or banned account must not keep a live session.
    await db.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  await audit({
    action: "admin.record_updated",
    actorId: auth.user.id,
    entityType: def.entityType,
    entityId: id,
    summary: `${def.label}: ${changed.map((k) => fieldOf(def, k)?.label ?? k).join(", ")}`,
    metadata: {
      resource: def.key,
      changes: Object.fromEntries(
        changed.map((k) => [k, { from: auditValue(before[k]), to: auditValue(data[k]) }]),
      ),
    },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return { changed };
}

/** Keeps search haystacks in step with the fields they are built from. */
async function refreshDerived(def: ResourceDef, id: string, changed: string[]) {
  const touches = (...keys: string[]) => keys.some((k) => changed.includes(k));

  if (def.key === "listings" && touches("title", "description", "city", "region", "country")) {
    const l = await db.listing.findUnique({
      where: { id },
      select: {
        title: true,
        description: true,
        city: true,
        region: true,
        country: true,
        pet: { select: { name: true, species: true, breedText: true, breed: { select: { name: true } } } },
      },
    });
    if (l) {
      await db.listing.update({
        where: { id },
        data: {
          searchText: buildSearchText(
            l.title,
            l.description,
            l.pet.name,
            l.pet.species,
            l.pet.breed?.name,
            l.pet.breedText,
            l.city,
            l.region,
            l.country,
          ),
        },
      });
    }
  }

  if (def.key === "products" && touches("title", "description", "brand")) {
    const p = await db.product.findUnique({ where: { id }, select: { title: true, description: true, brand: true } });
    if (p) await db.product.update({ where: { id }, data: { searchText: buildSearchText(p.title, p.description, p.brand) } });
  }

  if (def.key === "shops" && touches("name", "description", "city", "country")) {
    const s = await db.shop.findUnique({ where: { id }, select: { name: true, description: true, city: true, country: true } });
    if (s) await db.shop.update({ where: { id }, data: { searchText: buildSearchText(s.name, s.description, s.city, s.country) } });
  }

  if (def.key === "clinics" && touches("name", "description", "city", "region", "country")) {
    const c = await db.clinic.findUnique({
      where: { id },
      select: { name: true, description: true, city: true, region: true, country: true },
    });
    if (c) {
      await db.clinic.update({
        where: { id },
        data: { searchText: buildSearchText(c.name, c.description, c.city, c.region, c.country) },
      });
    }
  }

  if (def.key === "care-providers" && touches("name", "tagline", "description", "city", "region", "country", "offersBoarding", "offersTraining")) {
    const c = await db.careProvider.findUnique({
      where: { id },
      select: {
        name: true,
        tagline: true,
        description: true,
        city: true,
        region: true,
        country: true,
        offersBoarding: true,
        offersTraining: true,
      },
    });
    if (c) {
      await db.careProvider.update({
        where: { id },
        data: {
          searchText: buildSearchText(
            c.name,
            c.tagline,
            c.description,
            c.city,
            c.region,
            c.country,
            c.offersBoarding ? "pet hotel boarding kennel cattery" : null,
            c.offersTraining ? "dog training obedience trainer" : null,
          ),
        },
      });
    }
  }
}

async function titleOf(def: ResourceDef, id: string): Promise<string> {
  const select: Record<string, true> = { id: true, [def.title]: true };
  if (def.subtitle) select[def.subtitle] = true;
  const row = await delegate(def).findUnique({ where: { id }, select }).catch(() => null);
  return row ? labelFor(def, row) : id;
}

export async function softDeleteRecord(
  auth: AuthContext,
  def: ResourceDef,
  id: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  assertWrite(auth, def);
  const sd = def.softDelete;
  if (!sd) throw badRequest(`${def.plural} can only be deleted permanently.`);
  await guardTarget(auth, def, id, "delete");

  const now = new Date();
  const data: Row =
    def.key === "users"
      ? { deletedAt: now, status: "DEACTIVATED", statusReason: "Removed by PetMate staff." }
      : { [sd.field]: sd.value === "now" ? now : sd.value };

  try {
    await delegate(def).update({ where: { id }, data, select: { id: true } });
  } catch (error) {
    mapDbError(error);
  }

  if (def.key === "users") {
    await db.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now } });
    // Their live listings go with them, as they do when a member deletes their own account.
    await db.listing.updateMany({
      where: { sellerId: id, status: { in: ["ACTIVE", "PENDING_REVIEW", "PAUSED"] }, deletedAt: null },
      data: { status: "REMOVED", statusReason: "Seller account removed." },
    });
  }

  await audit({
    action: "admin.record_deleted",
    actorId: auth.user.id,
    entityType: def.entityType,
    entityId: id,
    summary: `${def.label} archived: ${await titleOf(def, id)}`,
    metadata: { resource: def.key },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}

export async function restoreRecord(
  auth: AuthContext,
  def: ResourceDef,
  id: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  assertWrite(auth, def);
  const sd = def.softDelete;
  if (!sd || sd.restorable === false) throw badRequest(`A deleted ${def.label.toLowerCase()} cannot be restored.`);
  await guardTarget(auth, def, id, "edit");

  const data: Row =
    def.key === "users"
      ? { deletedAt: null, status: "ACTIVE", statusReason: null, statusUntil: null }
      : { [sd.field]: sd.restore };

  try {
    await delegate(def).update({ where: { id }, data, select: { id: true } });
  } catch (error) {
    mapDbError(error);
  }

  await audit({
    action: "admin.record_restored",
    actorId: auth.user.id,
    entityType: def.entityType,
    entityId: id,
    summary: `${def.label} restored: ${await titleOf(def, id)}`,
    metadata: { resource: def.key },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}

export async function purgeRecord(
  auth: AuthContext,
  def: ResourceDef,
  id: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  if (!accessFor(auth, def).purge) {
    throw forbidden(
      def.hardDelete
        ? "Permanent deletion needs the super admin role."
        : `${def.plural} cannot be deleted permanently.`,
    );
  }
  await guardTarget(auth, def, id, "purge");
  const label = await titleOf(def, id);

  try {
    await delegate(def).delete({ where: { id }, select: { id: true } });
  } catch (error) {
    mapDbError(error);
  }

  await audit({
    action: "admin.record_purged",
    actorId: auth.user.id,
    entityType: def.entityType,
    entityId: id,
    summary: `${def.label} permanently deleted: ${label}`,
    metadata: { resource: def.key },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}

export type BulkAction = "delete" | "restore" | "purge" | "set-status";

/**
 * Bulk actions run the single-record path for each id, so a bulk delete is
 * exactly as guarded and as audited as one click on one row.
 */
export async function bulkAction(
  auth: AuthContext,
  def: ResourceDef,
  action: BulkAction,
  ids: string[],
  value: string | undefined,
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  if (action === "set-status") {
    if (!def.status || !value) throw badRequest("Choose a status.");
    if (!accessFor(auth, def).editable.includes(def.status)) throw forbidden("Status is read-only here.");
  }

  const failed: { id: string; message: string }[] = [];
  let done = 0;

  for (const id of ids) {
    try {
      if (action === "delete") await softDeleteRecord(auth, def, id, meta);
      else if (action === "restore") await restoreRecord(auth, def, id, meta);
      else if (action === "purge") await purgeRecord(auth, def, id, meta);
      else await updateRecord(auth, def, id, { [def.status!]: value }, meta);
      done += 1;
    } catch (error) {
      failed.push({ id, message: error instanceof AppError ? error.message : "Something went wrong." });
      if (!(error instanceof AppError)) throw error;
    }
  }

  return { done, failed };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const EXPORT_LIMIT = 5000;

/**
 * Spreadsheet apps execute a cell that starts with = + - @, so every such cell
 * is prefixed with an apostrophe. Exported member data is the classic vector.
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export async function exportCsv(
  auth: AuthContext,
  def: ResourceDef,
  query: Omit<ListQuery, "page" | "limit">,
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  const fields = def.fields.filter((f) => f.type !== "json");
  const orderBy = [{ [def.sort.field]: def.sort.dir }, { id: "desc" }];

  let rows: Row[];
  try {
    rows = await delegate(def).findMany({
      where: buildWhere(def, { ...query, page: 1, limit: EXPORT_LIMIT }),
      orderBy,
      take: EXPORT_LIMIT,
      select: Object.fromEntries(fields.map((f) => [f.key, true])),
    });
  } catch (error) {
    mapDbError(error);
  }

  const lines = [
    fields.map((f) => csvCell(f.label)).join(","),
    ...rows.map((row) => fields.map((f) => csvCell(row[f.key])).join(",")),
  ];

  await audit({
    action: "admin.data_exported",
    actorId: auth.user.id,
    entityType: def.entityType,
    summary: `${rows.length} ${def.plural.toLowerCase()} exported`,
    metadata: { resource: def.key, q: query.q ?? null, filters: query.filters ?? {}, view: query.view ?? "active" },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  // A BOM so Excel opens UTF-8 (Arabic names included) correctly.
  return { csv: `﻿${lines.join("\r\n")}\r\n`, count: rows.length };
}

// ---------------------------------------------------------------------------
// Global search
// ---------------------------------------------------------------------------

const SEARCHABLE = [
  "users",
  "pets",
  "listings",
  "orders",
  "pet-orders",
  "payments",
  "support-tickets",
  "disputes",
  "appointments",
  "care-bookings",
  "shops",
  "products",
  "clinics",
  "care-providers",
];

export async function globalSearch(auth: AuthContext, q: string) {
  const term = q.trim();
  if (term.length < 2) return [];

  const groups = await Promise.all(
    SEARCHABLE.map(async (key) => {
      const def = getResource(key);
      if (!def || !accessFor(auth, def).read) return null;
      try {
        const result = await listRecords(def, { q: term, page: 1, limit: 4, view: "all" });
        if (!result.rows.length) return null;
        return {
          resource: def.key,
          label: def.plural,
          icon: def.icon,
          items: result.rows.map((r) => ({
            id: r.id as string,
            title: labelFor(def, r),
            subtitle: def.subtitle ? ((r[def.subtitle] as string | null) ?? null) : null,
            status: def.status ? ((r[def.status] as string | null) ?? null) : null,
          })),
        };
      } catch {
        return null;
      }
    }),
  );

  return groups.filter((g): g is NonNullable<typeof g> => g !== null);
}

/**
 * Names for the ref filters a "related records" link arrives with, so the
 * chip reads "Owner: Amina Hassan" rather than an id.
 */
export async function refFilterLabels(def: ResourceDef, filters: Record<string, string>) {
  const keys = Object.keys(filters).filter((k) => fieldOf(def, k)?.type === "ref");
  if (!keys.length) return {};
  const refs = await resolveRefs(def, [filters], keys);
  return Object.fromEntries(
    keys.map((k) => [k, refs[fieldOf(def, k)!.ref!]?.[filters[k]!] ?? filters[k]!]),
  ) as Record<string, string>;
}
