import "server-only";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { badRequest, conflict, notFound, unprocessable, upgradeRequired } from "@/lib/errors";
import { assertOwnsShop, isStaff } from "@/lib/auth/rbac";
import type { AuthContext } from "@/lib/auth/session";
import { applyBps, formatMoney, parseMoneyToCents } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { csvRecords } from "@/lib/csv";
import { PRODUCT_IMPORT_COLUMNS, MAX_IMPORT_ROWS } from "@/lib/product-import";
import { resolveCommissionBps } from "@/lib/settings";
import { generateOrderNumber, uniqueSlug } from "@/lib/utils";
import { buildSearchText, searchTextClauses, relevanceScore } from "@/lib/search/text";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getEntitlements, getVisibilityBoosts } from "@/lib/billing/entitlements";
import {
  safeText,
  safeParagraph,
  optionalText,
  cuidSchema,
  centsSchema,
  emailSchema,
  phoneSchema,
  priceCurrencySchema,
} from "@/lib/validation/common";
import { LIMITS, PAYMENT_METHOD } from "@/lib/constants";
import { PLATFORM_CURRENCY } from "@/lib/currency";

/**
 * Commerce.
 *
 * Two invariants carry the whole module:
 *
 *   1. **Prices are read from the database at checkout.** The cart holds
 *      variant ids and quantities and nothing else, so there is no price in any
 *      request that the server could be tricked into honouring.
 *   2. **Stock is decremented when the order is created, not when it is paid.**
 *      A conditional update (`stock >= quantity`) does the decrement, so two
 *      buyers racing for the last unit produce one order and one honest
 *      "just sold out". Cancelled and expired orders put the stock back.
 */

// ---------------------------------------------------------------------------
// Shops & products
// ---------------------------------------------------------------------------

export const shopSchema = z.object({
  name: safeText(120, 2),
  description: safeParagraph(3000, 0).optional(),
  email: emailSchema,
  phone: phoneSchema.optional(),
  country: safeText(60, 2),
  region: optionalText(80),
  city: optionalText(80),
  flatShippingCents: centsSchema.default(6_000), // EGP 60
  /** Null removes free shipping. */
  freeShippingThresholdCents: centsSchema.nullable().optional(),
  /** Take cash on delivery, subject to the platform's COD setting and cap. */
  acceptsCod: z.boolean().default(false),
});

export async function createShop(auth: AuthContext, raw: z.input<typeof shopSchema>) {
  // Parsed here too, so a caller that skipped the route still gets defaults.
  const input = shopSchema.parse(raw);
  const existing = await db.shop.count({ where: { ownerUserId: auth.user.id, deletedAt: null } });
  if (existing >= 3) throw conflict("You have reached the limit of shops per account.");

  return db.$transaction(async (tx) => {
    const shop = await tx.shop.create({
      data: {
        ownerUserId: auth.user.id,
        name: input.name,
        slug: uniqueSlug(input.name),
        description: input.description ?? null,
        email: input.email,
        phone: input.phone ?? null,
        country: input.country,
        region: input.region ?? null,
        city: input.city ?? null,
        flatShippingCents: input.flatShippingCents,
        freeShippingThresholdCents: input.freeShippingThresholdCents ?? null,
        acceptsCod: input.acceptsCod,
        status: "PENDING",
        searchText: buildSearchText(input.name, input.description, input.city, input.country),
      },
      select: { id: true, slug: true, name: true },
    });

    await tx.userRole.upsert({
      where: { userId_role: { userId: auth.user.id, role: "SELLER" } },
      create: { userId: auth.user.id, role: "SELLER" },
      update: {},
    });

    // A shop opens PENDING and can list nothing until someone reviews it.
    // Without this row it never reached the admin review queue, so every new
    // shop stayed pending forever. Approval (safety.service) activates it.
    await tx.verification.create({
      data: {
        subjectType: "SHOP",
        subjectId: shop.id,
        userId: auth.user.id,
        type: "BUSINESS",
        status: "PENDING",
      },
    });

    await audit(
      { action: "user.role_granted", actorId: auth.user.id, entityType: "SHOP", entityId: shop.id, summary: "Shop created" },
      tx,
    );

    return shop;
  });
}

/**
 * The details a shop owner can change themselves. Name changes re-derive the
 * search text; status and commission are staff decisions and are not here.
 */
export async function updateShop(auth: AuthContext, shopId: string, input: Partial<z.infer<typeof shopSchema>>) {
  await assertOwnsShop(shopId, auth);
  const saved = await db.shop.update({
    where: { id: shopId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.phone !== undefined ? { phone: input.phone ?? null } : {}),
      ...(input.city !== undefined ? { city: input.city ?? null } : {}),
      ...(input.region !== undefined ? { region: input.region ?? null } : {}),
      ...(input.country !== undefined ? { country: input.country } : {}),
      ...(input.flatShippingCents !== undefined ? { flatShippingCents: input.flatShippingCents } : {}),
      ...(input.freeShippingThresholdCents !== undefined
        ? { freeShippingThresholdCents: input.freeShippingThresholdCents ?? null }
        : {}),
      ...(input.acceptsCod !== undefined ? { acceptsCod: input.acceptsCod } : {}),
    },
    select: { id: true, name: true, description: true, city: true, country: true },
  });
  await db.shop.update({
    where: { id: shopId },
    data: { searchText: buildSearchText(saved.name, saved.description, saved.city, saved.country) },
  });
  return saved;
}

/** A shop and its whole catalogue, for its owner's console. */
export async function getShopConsole(auth: AuthContext, shopId: string) {
  await assertOwnsShop(shopId, auth);

  const [shop, products, pendingVerification] = await Promise.all([
    db.shop.findUniqueOrThrow({
      where: { id: shopId },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        description: true,
        email: true,
        phone: true,
        city: true,
        country: true,
        flatShippingCents: true,
        freeShippingThresholdCents: true,
        acceptsCod: true,
        verifiedAt: true,
        orderCount: true,
      },
    }),
    db.product.findMany({
      where: { shopId, deletedAt: null },
      orderBy: [{ updatedAt: "desc" }],
      take: 500,
      select: {
        id: true,
        title: true,
        slug: true,
        sku: true,
        status: true,
        priceCents: true,
        compareAtCents: true,
        currency: true,
        stock: true,
        trackInventory: true,
        lowStockAt: true,
        soldCount: true,
        category: { select: { name: true } },
        images: { orderBy: { position: "asc" }, take: 1, select: { url: true, alt: true } },
      },
    }),
    db.verification.findFirst({
      where: { subjectType: "SHOP", subjectId: shopId, status: "PENDING" },
      select: { id: true, createdAt: true },
    }),
  ]);

  return { shop, products, pendingVerification };
}

/** The product as its owner edits it, including drafts. */
export async function getProductForEdit(auth: AuthContext, productId: string) {
  const product = await db.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: {
      id: true,
      shopId: true,
      title: true,
      description: true,
      categoryId: true,
      brand: true,
      sku: true,
      priceCents: true,
      compareAtCents: true,
      stock: true,
      trackInventory: true,
      lowStockAt: true,
      weightGrams: true,
      status: true,
      images: { orderBy: { position: "asc" }, select: { url: true, alt: true } },
    },
  });
  if (!product) throw notFound("That product");
  await assertOwnsShop(product.shopId, auth);
  return product;
}

/**
 * Takes a product off sale for good. Soft-deleted, so past orders keep a
 * readable line item; a cart holding it simply stops finding it.
 */
export async function archiveProduct(auth: AuthContext, productId: string): Promise<void> {
  const product = await db.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { id: true, shopId: true, title: true },
  });
  if (!product) throw notFound("That product");
  await assertOwnsShop(product.shopId, auth);

  await db.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: productId },
      data: { deletedAt: new Date(), status: "ARCHIVED" },
    });
    await tx.cartItem.deleteMany({ where: { variant: { productId } } });
    await audit(
      { action: "product.archived", actorId: auth.user.id, entityType: "PRODUCT", entityId: productId, summary: product.title },
      tx,
    );
  });
}

export const productSchema = z.object({
  title: safeText(LIMITS.titleMax, 3),
  description: safeParagraph(LIMITS.descriptionMax, 20),
  categoryId: cuidSchema.optional(),
  brand: optionalText(80),
  sku: optionalText(60),
  priceCents: centsSchema.refine((v) => v > 0, "A product needs a price."),
  compareAtCents: centsSchema.optional(),
  currency: priceCurrencySchema,
  stock: z.number().int().min(0).max(1_000_000).default(0),
  trackInventory: z.boolean().default(true),
  lowStockAt: z.number().int().min(0).max(1000).default(5),
  weightGrams: z.number().int().min(0).max(500_000).optional(),
  attributes: z.record(z.string(), z.string()).optional(),
  images: z
    .array(
      z.object({
        // An uploaded file (a site path) or an https URL — never javascript:,
        // data: or a plain-http address that would break the page's TLS.
        url: z
          .string()
          .max(1000)
          .refine((u) => (u.startsWith("/") && !u.startsWith("//")) || u.startsWith("https://"), "That image address is not allowed."),
        alt: optionalText(160),
      }),
    )
    .max(LIMITS.imagesPerProduct)
    .optional(),
  publish: z.boolean().default(false),
});

export async function createProduct(
  auth: AuthContext,
  shopId: string,
  input: z.infer<typeof productSchema>,
) {
  const shop = await assertOwnsShop(shopId, auth);
  if (shop.status !== "ACTIVE" && !isStaff(auth.user)) {
    throw conflict("Your shop is still being reviewed. You can add products once it is approved.");
  }

  if (input.compareAtCents && input.compareAtCents <= input.priceCents) {
    throw unprocessable("The compare-at price must be above the selling price.", [
      { field: "compareAtCents", message: "Must be higher than the price." },
    ]);
  }

  return db.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: productCreateData(shopId, input),
      select: { id: true, slug: true, title: true, status: true },
    });

    return product;
  });
}

/** The row a new product is written as. Shared by single create and bulk import. */
function productCreateData(shopId: string, input: z.infer<typeof productSchema>) {
  return {
    shopId,
    categoryId: input.categoryId ?? null,
    title: input.title,
    slug: uniqueSlug(input.title),
    description: input.description,
    brand: input.brand ?? null,
    sku: input.sku ?? null,
    priceCents: input.priceCents,
    compareAtCents: input.compareAtCents ?? null,
    currency: input.currency,
    stock: input.stock,
    trackInventory: input.trackInventory,
    lowStockAt: input.lowStockAt,
    weightGrams: input.weightGrams ?? null,
    attributes: input.attributes ? JSON.stringify(input.attributes) : null,
    status: input.publish ? (input.stock > 0 || !input.trackInventory ? "ACTIVE" : "OUT_OF_STOCK") : "DRAFT",
    publishedAt: input.publish ? new Date() : null,
    searchText: buildSearchText(
      input.title,
      input.description,
      input.brand,
      Object.values(input.attributes ?? {}).join(" "),
    ),
    // Every product has exactly one default variant, so the order path
    // never has to branch on "simple vs variable product".
    variants: {
      create: {
        name: "Default",
        sku: input.sku ?? null,
        priceCents: input.priceCents,
        stock: input.stock,
        isDefault: true,
      },
    },
    ...(input.images?.length
      ? {
          images: {
            create: input.images.map((img, position) => ({
              url: img.url,
              alt: img.alt ?? null,
              position,
            })),
          },
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Bulk import
// ---------------------------------------------------------------------------

export interface ImportRowError {
  /** The spreadsheet row, counting the header as row 1, so it matches Excel. */
  row: number;
  column?: string;
  message: string;
}

export interface ImportResult {
  /** False when any row failed: an import is all or nothing. */
  applied: boolean;
  created: number;
  updated: number;
  errors: ImportRowError[];
}

const YES = new Set(["yes", "y", "true", "1", "نعم", "اه", "أيوه"]);
const NO = new Set(["no", "n", "false", "0", "لا"]);

function parseYesNo(value: string | undefined): boolean | undefined | "invalid" {
  if (value === undefined || value === "") return undefined;
  const v = value.trim().toLowerCase();
  if (YES.has(v)) return true;
  if (NO.has(v)) return false;
  return "invalid";
}

function parseWhole(value: string | undefined): number | undefined | "invalid" {
  if (value === undefined || value === "") return undefined;
  const cleaned = normalizeDigits(value).replace(/[\s,]/g, "");
  return /^\d+$/.test(cleaned) ? Number(cleaned) : "invalid";
}

function parsePrice(value: string | undefined): number | undefined | "invalid" {
  if (value === undefined || value === "") return undefined;
  const cents = parseMoneyToCents(normalizeDigits(value).replace(/,/g, ""));
  return cents === null ? "invalid" : cents;
}

/** Arabic-Indic digits and the Arabic decimal separator, as Excel in Arabic writes them. */
function normalizeDigits(value: string): string {
  return value
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\u066b/g, ".")
    .replace(/\u066c/g, ",");
}

/**
 * Imports or updates a catalogue from a CSV (see `PRODUCT_IMPORT_COLUMNS`).
 *
 * A row whose `sku` already exists in this shop updates that product — its
 * price, stock and whichever other columns are filled in — which is how a
 * shop keeps a spreadsheet as its inventory system. Any other row creates a
 * product and must pass the same validation as the single-product form.
 *
 * Every row is checked before anything is written, and one bad row applies
 * none of them: a half-imported catalogue, with the seller unsure which rows
 * made it, is worse than a clear list of what to fix.
 */
export async function importProducts(auth: AuthContext, shopId: string, csv: string): Promise<ImportResult> {
  const shop = await assertOwnsShop(shopId, auth);
  if (shop.status !== "ACTIVE" && !isStaff(auth.user)) {
    throw conflict("Your shop is still being reviewed. You can add products once it is approved.");
  }

  const entitlements = await getEntitlements(shop.ownerUserId);
  if (!entitlements.bulkTools) {
    throw upgradeRequired("Bulk import and inventory updates are part of Seller Pro.", {
      feature: "bulkTools",
    });
  }

  await enforceRateLimit("productImport", auth.user.id);

  const { headers, records } = csvRecords(csv);
  const fail = (message: string, row = 1): ImportResult => ({
    applied: false,
    created: 0,
    updated: 0,
    errors: [{ row, message }],
  });

  if (!headers.length || !records.length) return fail("The file has no rows under its header.");
  if (!headers.includes("sku") && !headers.includes("title")) {
    return fail('The header row needs a "title" column, or a "sku" column to update existing products.');
  }
  if (records.length > MAX_IMPORT_ROWS) {
    return fail(`Import up to ${MAX_IMPORT_ROWS} rows at a time; this file has ${records.length}.`);
  }
  const unknown = headers.filter((h) => h && !(PRODUCT_IMPORT_COLUMNS as readonly string[]).includes(h));
  if (unknown.length) return fail(`Unknown columns: ${unknown.join(", ")}.`);

  const [existing, categories] = await Promise.all([
    db.product.findMany({
      where: { shopId, deletedAt: null, sku: { not: null } },
      select: { id: true, sku: true, trackInventory: true, status: true },
    }),
    db.category.findMany({ select: { id: true, slug: true } }),
  ]);
  const bySku = new Map(existing.map((p) => [p.sku!.toLowerCase(), p]));
  const categoryBySlug = new Map(categories.map((c) => [c.slug, c.id]));

  type Create = { kind: "create"; input: z.infer<typeof productSchema> };
  type Update = {
    kind: "update";
    id: string;
    trackInventory: boolean;
    status: string;
    data: {
      title?: string;
      description?: string;
      brand?: string;
      categoryId?: string;
      priceCents?: number;
      compareAtCents?: number;
      stock?: number;
      weightGrams?: number;
      publish?: boolean;
    };
  };
  const ops: (Create | Update)[] = [];
  const errors: ImportRowError[] = [];
  const seenSkus = new Map<string, number>();

  records.forEach((record, index) => {
    const row = index + 2;
    const rowErrors: ImportRowError[] = [];
    const bad = (column: string, message: string) => rowErrors.push({ row, column, message });

    const sku = record.sku || undefined;
    if (sku) {
      const key = sku.toLowerCase();
      const first = seenSkus.get(key);
      if (first) bad("sku", `SKU ${sku} is already on row ${first}.`);
      else seenSkus.set(key, row);
    }

    const price = parsePrice(record.price);
    const compareAt = parsePrice(record.compare_at_price);
    const stock = parseWhole(record.stock);
    const weight = parseWhole(record.weight_grams);
    const publish = parseYesNo(record.publish);
    if (price === "invalid") bad("price", "Price must be a number, like 250 or 249.50.");
    if (compareAt === "invalid") bad("compare_at_price", "Compare-at price must be a number.");
    if (stock === "invalid") bad("stock", "Stock must be a whole number.");
    if (weight === "invalid") bad("weight_grams", "Weight must be a whole number of grams.");
    if (publish === "invalid") bad("publish", "Publish must be yes or no.");

    let categoryId: string | undefined;
    if (record.category) {
      categoryId = categoryBySlug.get(record.category.toLowerCase());
      if (!categoryId) bad("category", `There is no category "${record.category}".`);
    }

    const match = sku ? bySku.get(sku.toLowerCase()) : undefined;

    if (rowErrors.length) {
      errors.push(...rowErrors);
      return;
    }

    if (match) {
      const data: Update["data"] = {
        ...(record.title ? { title: record.title } : {}),
        ...(record.description ? { description: record.description } : {}),
        ...(record.brand ? { brand: record.brand } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(typeof price === "number" ? { priceCents: price } : {}),
        ...(typeof compareAt === "number" ? { compareAtCents: compareAt } : {}),
        ...(typeof stock === "number" ? { stock } : {}),
        ...(typeof weight === "number" ? { weightGrams: weight } : {}),
        ...(typeof publish === "boolean" ? { publish } : {}),
      };
      // Updates are checked with the same rules as the form, field by field.
      const checked = productSchema.partial().safeParse(data);
      if (!checked.success) {
        for (const issue of checked.error.issues) {
          errors.push({ row, column: String(issue.path[0] ?? ""), message: issue.message });
        }
        return;
      }
      if (data.priceCents !== undefined && data.priceCents <= 0) {
        errors.push({ row, column: "price", message: "A product needs a price." });
        return;
      }
      ops.push({ kind: "update", id: match.id, trackInventory: match.trackInventory, status: match.status, data });
      return;
    }

    const parsed = productSchema.safeParse({
      title: record.title ?? "",
      description: record.description ?? "",
      brand: record.brand || undefined,
      sku,
      categoryId,
      priceCents: typeof price === "number" ? price : 0,
      compareAtCents: typeof compareAt === "number" ? compareAt : undefined,
      stock: typeof stock === "number" ? stock : 0,
      weightGrams: typeof weight === "number" ? weight : undefined,
      publish: typeof publish === "boolean" ? publish : false,
    });
    if (!parsed.success) {
      const column = (path: PropertyKey | undefined) =>
        path === "priceCents" ? "price" : path === "compareAtCents" ? "compare_at_price" : String(path ?? "");
      for (const issue of parsed.error.issues) {
        errors.push({ row, column: column(issue.path[0]), message: issue.message });
      }
      return;
    }
    if (parsed.data.compareAtCents && parsed.data.compareAtCents <= parsed.data.priceCents) {
      errors.push({ row, column: "compare_at_price", message: "The compare-at price must be above the selling price." });
      return;
    }
    ops.push({ kind: "create", input: parsed.data });
  });

  if (errors.length) return { applied: false, created: 0, updated: 0, errors };

  let created = 0;
  let updated = 0;
  await db.$transaction(
    async (tx) => {
      for (const op of ops) {
        if (op.kind === "create") {
          await tx.product.create({ data: productCreateData(shopId, op.input), select: { id: true } });
          created++;
          continue;
        }

        const { publish, ...fields } = op.data;
        const saved = await tx.product.update({
          where: { id: op.id },
          data: {
            ...fields,
            ...(publish !== undefined
              ? { status: publish ? "ACTIVE" : "DRAFT", publishedAt: publish ? new Date() : null }
              : {}),
          },
          select: { title: true, description: true, brand: true, status: true, stock: true, trackInventory: true },
        });
        if (fields.priceCents !== undefined || fields.stock !== undefined) {
          await tx.productVariant.updateMany({
            where: { productId: op.id, isDefault: true },
            data: {
              ...(fields.priceCents !== undefined ? { priceCents: fields.priceCents } : {}),
              ...(fields.stock !== undefined ? { stock: fields.stock } : {}),
            },
          });
        }
        // Keep the published status honest about stock, as the form does.
        const status =
          saved.trackInventory && saved.status === "ACTIVE" && saved.stock <= 0
            ? "OUT_OF_STOCK"
            : saved.status === "OUT_OF_STOCK" && saved.stock > 0
              ? "ACTIVE"
              : saved.status;
        await tx.product.update({
          where: { id: op.id },
          data: { status, searchText: buildSearchText(saved.title, saved.description, saved.brand) },
        });
        updated++;
      }

      await audit(
        {
          action: "product.imported",
          actorId: auth.user.id,
          entityType: "SHOP",
          entityId: shopId,
          summary: `Imported ${created} new and ${updated} updated products`,
        },
        tx,
      );
    },
    { timeout: 60_000 },
  );

  return { applied: true, created, updated, errors: [] };
}

export async function updateProduct(
  auth: AuthContext,
  productId: string,
  input: Partial<z.infer<typeof productSchema>>,
) {
  const product = await db.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { id: true, shopId: true, trackInventory: true, status: true },
  });
  if (!product) throw notFound("That product");
  await assertOwnsShop(product.shopId, auth);

  const updated = await db.$transaction(async (tx) => {
    const saved = await tx.product.update({
      where: { id: productId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId || null } : {}),
        ...(input.brand !== undefined ? { brand: input.brand ?? null } : {}),
        ...(input.sku !== undefined ? { sku: input.sku ?? null } : {}),
        ...(input.weightGrams !== undefined ? { weightGrams: input.weightGrams ?? null } : {}),
        ...(input.priceCents !== undefined ? { priceCents: input.priceCents } : {}),
        ...(input.compareAtCents !== undefined ? { compareAtCents: input.compareAtCents ?? null } : {}),
        ...(input.stock !== undefined ? { stock: input.stock } : {}),
        ...(input.trackInventory !== undefined ? { trackInventory: input.trackInventory } : {}),
        ...(input.lowStockAt !== undefined ? { lowStockAt: input.lowStockAt } : {}),
        ...(input.publish !== undefined
          ? { status: input.publish ? "ACTIVE" : "DRAFT", publishedAt: input.publish ? new Date() : null }
          : {}),
      },
      select: { id: true, title: true, description: true, brand: true, attributes: true, status: true, stock: true, trackInventory: true },
    });

    // Photos are replaced as a set: the form sends the whole ordered list, so
    // a removal or a reorder is just the new list.
    if (input.images !== undefined) {
      await tx.productImage.deleteMany({ where: { productId } });
      if (input.images.length) {
        await tx.productImage.createMany({
          data: input.images.map((img, position) => ({ productId, url: img.url, alt: img.alt ?? null, position })),
        });
      }
    }

    // The default variant mirrors the product's own price and stock.
    if (input.priceCents !== undefined || input.stock !== undefined) {
      await tx.productVariant.updateMany({
        where: { productId, isDefault: true },
        data: {
          ...(input.priceCents !== undefined ? { priceCents: input.priceCents } : {}),
          ...(input.stock !== undefined ? { stock: input.stock } : {}),
        },
      });
    }

    if (input.title || input.description || input.brand) {
      await tx.product.update({
        where: { id: productId },
        data: {
          searchText: buildSearchText(saved.title, saved.description, saved.brand),
        },
      });
    }

    // Keep the published status honest about stock.
    if (saved.trackInventory && saved.status === "ACTIVE" && saved.stock <= 0) {
      await tx.product.update({ where: { id: productId }, data: { status: "OUT_OF_STOCK" } });
    }
    if (saved.status === "OUT_OF_STOCK" && saved.stock > 0) {
      await tx.product.update({ where: { id: productId }, data: { status: "ACTIVE" } });
    }

    return saved;
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

export async function addToCart(
  auth: AuthContext,
  input: { variantId: string; quantity: number },
) {
  if (input.quantity < 1 || input.quantity > 99) throw badRequest("Choose between 1 and 99.");

  const variant = await db.productVariant.findFirst({
    where: { id: input.variantId },
    select: {
      id: true,
      stock: true,
      product: {
        select: { id: true, status: true, trackInventory: true, shopId: true, deletedAt: true, shop: { select: { ownerUserId: true, status: true } } },
      },
    },
  });

  if (!variant || variant.product.deletedAt) throw notFound("That product");
  if (variant.product.status !== "ACTIVE") throw conflict("That product is not available right now.");
  if (variant.product.shop.status !== "ACTIVE") throw conflict("That shop is not open right now.");
  if (variant.product.shop.ownerUserId === auth.user.id) {
    throw badRequest("You cannot buy from your own shop.");
  }

  const existing = await db.cartItem.findUnique({
    where: { userId_variantId: { userId: auth.user.id, variantId: input.variantId } },
    select: { id: true, quantity: true },
  });

  const nextQuantity = (existing?.quantity ?? 0) + input.quantity;

  if (variant.product.trackInventory && nextQuantity > variant.stock) {
    throw conflict(
      variant.stock === 0 ? "That item just sold out." : `Only ${variant.stock} left in stock.`,
    );
  }

  if (existing) {
    return db.cartItem.update({
      where: { id: existing.id },
      data: { quantity: nextQuantity },
      select: { id: true, quantity: true },
    });
  }

  return db.cartItem.create({
    data: { userId: auth.user.id, variantId: input.variantId, quantity: input.quantity },
    select: { id: true, quantity: true },
  });
}

export async function updateCartItem(auth: AuthContext, itemId: string, quantity: number) {
  const item = await db.cartItem.findFirst({
    where: { id: itemId, userId: auth.user.id },
    select: { id: true, variant: { select: { stock: true, product: { select: { trackInventory: true } } } } },
  });
  if (!item) throw notFound("That cart item");

  if (quantity <= 0) {
    await db.cartItem.delete({ where: { id: itemId } });
    return { removed: true };
  }
  if (quantity > 99) throw badRequest("Choose up to 99.");
  if (item.variant.product.trackInventory && quantity > item.variant.stock) {
    throw conflict(`Only ${item.variant.stock} left in stock.`);
  }

  await db.cartItem.update({ where: { id: itemId }, data: { quantity } });
  return { removed: false };
}

export async function removeCartItem(auth: AuthContext, itemId: string) {
  // Scoped by userId, so someone else's item id matches nothing.
  await db.cartItem.deleteMany({ where: { id: itemId, userId: auth.user.id } });
}

export interface CartSummary {
  items: {
    id: string;
    variantId: string;
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
    available: boolean;
    availabilityNote: string | null;
    product: {
      id: string;
      title: string;
      slug: string;
      image: string | null;
      shopId: string;
      shopName: string;
      shopSlug: string;
    };
  }[];
  shops: { id: string; name: string; subtotalCents: number; shippingCents: number }[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  currency: string;
  hasUnavailable: boolean;
  /** Whether this basket can be paid on delivery, and if not, why. */
  cashOnDelivery: { available: boolean; reason: string | null };
}

/** Builds the cart, pricing every line from the database. */
export async function getCart(userId: string): Promise<CartSummary> {
  const items = await db.cartItem.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      quantity: true,
      variantId: true,
      variant: {
        select: {
          id: true,
          name: true,
          priceCents: true,
          stock: true,
          product: {
            select: {
              id: true,
              title: true,
              slug: true,
              status: true,
              currency: true,
              trackInventory: true,
              deletedAt: true,
              images: { orderBy: { position: "asc" }, take: 1, select: { url: true } },
              shop: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  status: true,
                  flatShippingCents: true,
                  freeShippingThresholdCents: true,
                  acceptsCod: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const lines = items.map((item) => {
    const product = item.variant.product;
    const unavailable =
      product.deletedAt !== null ||
      product.status !== "ACTIVE" ||
      product.shop.status !== "ACTIVE" ||
      (product.trackInventory && item.variant.stock < item.quantity);

    const note = product.deletedAt
      ? "No longer available"
      : product.status !== "ACTIVE"
        ? "Not currently for sale"
        : product.shop.status !== "ACTIVE"
          ? "This shop is closed"
          : product.trackInventory && item.variant.stock < item.quantity
            ? item.variant.stock === 0
              ? "Out of stock"
              : `Only ${item.variant.stock} left`
            : null;

    return {
      id: item.id,
      variantId: item.variantId,
      quantity: item.quantity,
      unitPriceCents: item.variant.priceCents,
      totalCents: item.variant.priceCents * item.quantity,
      available: !unavailable,
      availabilityNote: note,
      product: {
        id: product.id,
        title: product.title,
        slug: product.slug,
        image: product.images[0]?.url ?? null,
        shopId: product.shop.id,
        shopName: product.shop.name,
        shopSlug: product.shop.slug,
      },
      _shop: product.shop,
      _currency: product.currency,
    };
  });

  const available = lines.filter((l) => l.available);
  const shopIds = [...new Set(available.map((l) => l.product.shopId))];

  const shops = shopIds.map((shopId) => {
    const shopLines = available.filter((l) => l.product.shopId === shopId);
    const subtotal = shopLines.reduce((a, l) => a + l.totalCents, 0);
    const config = shopLines[0]!._shop;
    const freeThreshold = config.freeShippingThresholdCents;
    const shipping = freeThreshold !== null && subtotal >= freeThreshold ? 0 : config.flatShippingCents;

    return { id: shopId, name: config.name, subtotalCents: subtotal, shippingCents: shipping };
  });

  const subtotalCents = shops.reduce((a, s) => a + s.subtotalCents, 0);
  const shippingCents = shops.reduce((a, s) => a + s.shippingCents, 0);
  const totalCents = subtotalCents + shippingCents;

  return {
    items: lines.map(({ _shop, _currency, ...rest }) => rest),
    shops,
    subtotalCents,
    shippingCents,
    totalCents,
    currency: lines[0]?._currency ?? PLATFORM_CURRENCY,
    hasUnavailable: lines.some((l) => !l.available),
    cashOnDelivery: await cashOnDeliveryFor(available.map((l) => l._shop), totalCents),
  };
}

/**
 * Whether a basket may be paid on delivery. Every shop in it has to take cash,
 * because one courier collects for the whole parcel from each shop, and a
 * basket that is half card and half cash is two checkouts. The cap limits how
 * much commission a shop can owe the platform on cash it has collected.
 */
async function cashOnDeliveryFor(
  shops: { acceptsCod: boolean; name: string }[],
  totalCents: number,
): Promise<CartSummary["cashOnDelivery"]> {
  const settings = await getSettings();
  if (!settings.codEnabled) return { available: false, reason: "Cash on delivery is not available right now." };
  if (!shops.length) return { available: false, reason: null };
  const refusing = shops.find((s) => !s.acceptsCod);
  if (refusing) return { available: false, reason: `${refusing.name} does not take cash on delivery.` };
  if (totalCents > settings.codMaxOrderCents) {
    return {
      available: false,
      reason: `Cash on delivery is available for baskets up to ${formatMoney(settings.codMaxOrderCents)}.`,
    };
  }
  return { available: true, reason: null };
}

export async function cartCount(userId: string): Promise<number> {
  const result = await db.cartItem.aggregate({
    where: { userId },
    _sum: { quantity: true },
  });
  return result._sum.quantity ?? 0;
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

export const checkoutSchema = z.object({
  shippingName: safeText(120, 2),
  shippingPhone: phoneSchema.optional(),
  shippingLine1: safeText(200, 3),
  shippingLine2: optionalText(200),
  shippingCity: safeText(80),
  shippingRegion: optionalText(80),
  shippingCountry: safeText(60, 2),
  shippingPostal: optionalText(20),
  shippingNote: optionalText(300),
  paymentMethod: z.enum(PAYMENT_METHOD).default("ONLINE"),
});

/**
 * Creates the order and reserves stock. Returns the amount to charge, which the
 * payment layer then uses — the client never supplies a total.
 */
export async function createOrder(auth: AuthContext, raw: z.input<typeof checkoutSchema>) {
  const input = { ...raw, paymentMethod: raw.paymentMethod ?? "ONLINE" };
  await enforceRateLimit("checkout", auth.user.id);

  const cart = await getCart(auth.user.id);
  const available = cart.items.filter((i) => i.available);

  if (!available.length) {
    throw badRequest(
      cart.items.length ? "Nothing in your basket is available right now." : "Your basket is empty.",
    );
  }

  const cod = input.paymentMethod === "COD";
  if (cod) {
    if (!cart.cashOnDelivery.available) {
      throw conflict(cart.cashOnDelivery.reason ?? "Cash on delivery is not available right now.");
    }
    // The courier has to be able to call before turning up with a parcel that
    // is only paid for at the door.
    if (!input.shippingPhone) {
      throw unprocessable("Add a phone number so the courier can reach you.", [
        { field: "shippingPhone", message: "Needed for cash on delivery." },
      ]);
    }
  }

  // A plan's commission discount belongs to the shop's owner — Seller Pro
  // sells a lower rate on the shop's own sales. It is looked up once per owner.
  const ownerDiscounts = new Map<string, number>();
  const discountFor = async (ownerUserId: string) => {
    if (!ownerDiscounts.has(ownerUserId)) {
      ownerDiscounts.set(ownerUserId, (await getEntitlements(ownerUserId)).commissionDiscountBps);
    }
    return ownerDiscounts.get(ownerUserId)!;
  };

  const order = await db.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        orderNumber: generateOrderNumber("PM"),
        buyerId: auth.user.id,
        status: "PENDING_PAYMENT",
        paymentMethod: input.paymentMethod,
        subtotalCents: cart.subtotalCents,
        shippingCents: cart.shippingCents,
        totalCents: cart.totalCents,
        currency: cart.currency,
        shippingName: input.shippingName,
        shippingPhone: input.shippingPhone ?? null,
        shippingLine1: input.shippingLine1,
        shippingLine2: input.shippingLine2 ?? null,
        shippingCity: input.shippingCity,
        shippingRegion: input.shippingRegion ?? null,
        shippingCountry: input.shippingCountry,
        shippingPostal: input.shippingPostal ?? null,
        shippingNote: input.shippingNote ?? null,
      },
      select: { id: true, orderNumber: true, totalCents: true, currency: true },
    });

    let platformFee = 0;

    for (const line of available) {
      const variant = await tx.productVariant.findUnique({
        where: { id: line.variantId },
        select: {
          id: true,
          name: true,
          priceCents: true,
          stock: true,
          product: {
            select: {
              id: true,
              title: true,
              trackInventory: true,
              shopId: true,
              shop: { select: { commissionBps: true, ownerUserId: true } },
              images: { orderBy: { position: "asc" }, take: 1, select: { url: true } },
            },
          },
        },
      });
      if (!variant) throw conflict("An item in your basket is no longer available.");

      // Conditional decrement: the guard is in the WHERE clause, so two buyers
      // racing for the last unit cannot both succeed.
      if (variant.product.trackInventory) {
        const reserved = await tx.productVariant.updateMany({
          where: { id: variant.id, stock: { gte: line.quantity } },
          data: { stock: { decrement: line.quantity } },
        });
        if (reserved.count === 0) {
          throw conflict(`"${variant.product.title}" sold out while you were checking out.`);
        }
        await tx.product.update({
          where: { id: variant.product.id },
          data: { stock: { decrement: line.quantity } },
        });
      }

      const baseBps = await resolveCommissionBps("PRODUCT", variant.product.shop.commissionBps);
      const commissionBps = Math.max(0, baseBps - (await discountFor(variant.product.shop.ownerUserId)));

      const lineTotal = variant.priceCents * line.quantity;
      const commissionCents = applyBps(lineTotal, commissionBps);
      platformFee += commissionCents;

      await tx.orderItem.create({
        data: {
          orderId: created.id,
          shopId: variant.product.shopId,
          variantId: variant.id,
          titleSnapshot: variant.product.title,
          variantSnapshot: variant.name,
          imageSnapshot: variant.product.images[0]?.url ?? null,
          unitPriceCents: variant.priceCents,
          quantity: line.quantity,
          totalCents: lineTotal,
          commissionBps,
          commissionCents,
          sellerEarningsCents: lineTotal - commissionCents,
        },
      });
    }

    await tx.order.update({
      where: { id: created.id },
      data: { platformFeeCents: platformFee },
    });

    await tx.cartItem.deleteMany({
      where: { userId: auth.user.id, variantId: { in: available.map((l) => l.variantId) } },
    });

    await audit(
      {
        action: "order.placed",
        actorId: auth.user.id,
        entityType: "ORDER",
        entityId: created.id,
        summary: `${created.orderNumber} — ${created.totalCents} ${created.currency}`,
      },
      tx,
    );

    return created;
  });

  if (cod) {
    // Nothing to wait for: the order goes straight to the shops, and money
    // changes hands at the door.
    const { placeCashOnDeliveryOrder } = await import("@/lib/payments/settlement");
    await placeCashOnDeliveryOrder(order.id);
    return { ...order, paymentMethod: "COD" as const };
  }

  // Unpaid orders return their stock after 30 minutes.
  const { enqueueJob } = await import("@/lib/jobs/queue");
  await enqueueJob({
    type: "listing.expire",
    payload: { expireOrderId: order.id },
    runAt: new Date(Date.now() + 30 * 60_000),
    uniqueKey: `order.expire:${order.id}`,
  });

  return { ...order, paymentMethod: "ONLINE" as const };
}

/** Restores reserved stock. Used on cancellation and on payment timeout. */
/**
 * Cancels a store order and returns its stock.
 *
 * `requireBuyerId` is how a caller proves the request came from the order's
 * owner. The worker passes nothing, because "payment expired" is not a person
 * acting; every user-facing path must pass it, or a stranger's order id would
 * be enough to cancel someone else's order. Not being the buyer returns false,
 * exactly like a nonexistent order, so this is not an enumeration oracle.
 */
/** Puts ordered quantities back on the shelf, variant and product both. */
export async function restockItems(tx: Tx, items: { variantId: string; quantity: number }[]): Promise<void> {
  for (const item of items) {
    await tx.productVariant.update({
      where: { id: item.variantId },
      data: { stock: { increment: item.quantity } },
    });
    const variant = await tx.productVariant.findUnique({
      where: { id: item.variantId },
      select: { productId: true },
    });
    if (variant) {
      const product = await tx.product.findUnique({
        where: { id: variant.productId },
        select: { status: true, deletedAt: true },
      });
      await tx.product.update({
        where: { id: variant.productId },
        data: {
          stock: { increment: item.quantity },
          // Back on sale only if it was merely sold out; a draft or an
          // archived product stays exactly as its seller left it.
          ...(product?.status === "OUT_OF_STOCK" && !product.deletedAt ? { status: "ACTIVE" } : {}),
        },
      });
    }
  }
}

/**
 * Cancels an order that has not shipped. An unpaid or cash-on-delivery order
 * only needs its stock back. A paid one must also give the buyer their money
 * back: the shops' earnings are reversed in the same transaction as the
 * cancellation, and the gateway refund follows once it has committed.
 */
export async function cancelOrder(
  params: { orderId: string; reason: string; actorId: string; requireBuyerId?: string },
): Promise<boolean> {
  const outcome = await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: params.orderId },
      select: {
        id: true,
        status: true,
        buyerId: true,
        paymentMethod: true,
        paymentIntentId: true,
        totalCents: true,
        items: { select: { variantId: true, quantity: true } },
      },
    });
    if (!order) return null;
    if (params.requireBuyerId && order.buyerId !== params.requireBuyerId) return null;

    const claimed = await tx.order.updateMany({
      where: { id: order.id, status: { in: ["PENDING_PAYMENT", "CONFIRMED", "PAID", "PROCESSING"] } },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: params.reason },
    });
    if (claimed.count === 0) return null;

    const paid = order.paymentMethod === "ONLINE" && (order.status === "PAID" || order.status === "PROCESSING");
    if (paid) {
      const { clawBackOrderEarnings } = await import("@/lib/payments/settlement");
      await clawBackOrderEarnings(tx, {
        orderId: order.id,
        refundCents: order.totalCents,
        actorId: params.actorId,
        reason: "cancelled",
      });
    }

    await restockItems(tx, order.items);

    await tx.orderItem.updateMany({
      where: { orderId: order.id },
      data: { fulfillmentStatus: "CANCELLED" },
    });

    await audit(
      {
        action: "order.cancelled",
        actorId: params.actorId,
        entityType: "ORDER",
        entityId: order.id,
        summary: params.reason,
      },
      tx,
    );

    return { refundIntentId: paid ? order.paymentIntentId : null };
  });

  if (!outcome) return false;

  if (outcome.refundIntentId) {
    const { refundPayment } = await import("@/lib/payments/service");
    const intent = await db.paymentIntent.findUnique({
      where: { id: outcome.refundIntentId },
      select: { amountCents: true, refundedCents: true },
    });
    const remaining = intent ? intent.amountCents - intent.refundedCents : 0;
    if (remaining > 0) {
      try {
        await refundPayment({
          intentId: outcome.refundIntentId,
          amountCents: remaining,
          reason: "CANCELLED_ORDER",
          approvedById: params.actorId,
          note: params.reason,
          idempotencyKey: `cancel_${params.orderId}`,
        });
      } catch (e) {
        // The order is cancelled and the money is back with the platform; the
        // gateway refund needs a person. Flagged, never silently dropped.
        const { logger } = await import("@/lib/logger");
        logger.exception("REFUND FAILED after order cancellation", e, { orderId: params.orderId });
        await db.paymentIntent.update({
          where: { id: outcome.refundIntentId },
          data: { failureCode: "REFUND_PENDING", failureMessage: "Order cancelled; gateway refund failed" },
        });
      }
    }
  }

  return true;
}

/**
 * A store order as its buyer sees it. Someone else's order and a missing one
 * are the same 404.
 */
export async function getOrderForBuyer(auth: AuthContext, orderId: string) {
  const order = await db.order.findFirst({
    where: { id: orderId, buyerId: auth.user.id },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentMethod: true,
      paymentIntentId: true,
      subtotalCents: true,
      shippingCents: true,
      discountCents: true,
      totalCents: true,
      currency: true,
      shippingName: true,
      shippingPhone: true,
      shippingLine1: true,
      shippingLine2: true,
      shippingCity: true,
      shippingCountry: true,
      createdAt: true,
      placedAt: true,
      cancelledAt: true,
      cancelReason: true,
      items: {
        select: {
          id: true,
          shopId: true,
          titleSnapshot: true,
          variantSnapshot: true,
          imageSnapshot: true,
          quantity: true,
          totalCents: true,
          fulfillmentStatus: true,
          shop: { select: { name: true, slug: true } },
        },
      },
      deliveries: {
        select: { id: true, shopId: true, trackingNumber: true, status: true, provider: true, deliveredAt: true },
      },
    },
  });
  if (!order) throw notFound("That order");

  // The latest payment attempt for an online order that has not been paid,
  // so the page can send the buyer back to finish it.
  const pendingPayment =
    order.paymentMethod === "ONLINE" && order.status === "PENDING_PAYMENT"
      ? await db.paymentIntent.findFirst({
          where: { userId: auth.user.id, referenceType: "ORDER", referenceId: order.id },
          orderBy: { createdAt: "desc" },
          select: { id: true, status: true },
        })
      : null;

  const shipped = order.items.some((i) => ["SHIPPED", "DELIVERED"].includes(i.fulfillmentStatus));
  const cancellable = ["PENDING_PAYMENT", "CONFIRMED", "PAID", "PROCESSING"].includes(order.status) && !shipped;

  return { ...order, pendingPayment, cancellable };
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export interface ProductSearchParams {
  query?: string;
  categoryId?: string;
  shopId?: string;
  species?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
  inStockOnly?: boolean;
  sort?: "relevance" | "price_asc" | "price_desc" | "newest" | "popular" | "rating";
  page?: number;
  limit?: number;
}

export async function searchProducts(params: ProductSearchParams) {
  const limit = Math.min(params.limit ?? 24, LIMITS.pageSizeMax);
  const page = Math.max(1, params.page ?? 1);

  const where = {
    deletedAt: null,
    status: params.inStockOnly ? "ACTIVE" : { in: ["ACTIVE", "OUT_OF_STOCK"] },
    shop: { status: "ACTIVE", deletedAt: null },
    ...(params.query ? { AND: searchTextClauses(params.query) } : {}),
    ...(params.categoryId ? { categoryId: params.categoryId } : {}),
    ...(params.shopId ? { shopId: params.shopId } : {}),
    ...(params.minPriceCents != null || params.maxPriceCents != null
      ? {
          priceCents: {
            ...(params.minPriceCents != null ? { gte: params.minPriceCents } : {}),
            ...(params.maxPriceCents != null ? { lte: params.maxPriceCents } : {}),
          },
        }
      : {}),
  } as const;

  const orderBy =
    params.sort === "price_asc"
      ? [{ priceCents: "asc" as const }]
      : params.sort === "price_desc"
        ? [{ priceCents: "desc" as const }]
        : params.sort === "newest"
          ? [{ publishedAt: "desc" as const }]
          : params.sort === "rating"
            ? [{ ratingAvgBps: "desc" as const }, { ratingCount: "desc" as const }]
            : [{ soldCount: "desc" as const }, { viewCount: "desc" as const }];

  // The default ("relevance") order is ranked in memory over a bounded window
  // so it can weigh text match, quality and the shop's plan boost together.
  // Past the window it degrades to the SQL popularity order rather than
  // scanning further; nobody pages 17 deep into a product search.
  const ranked = (!params.sort || params.sort === "relevance") && page * limit <= PRODUCT_RANK_WINDOW;

  const [rows, total] = await Promise.all([
    db.product.findMany({
      where,
      orderBy,
      skip: ranked ? 0 : (page - 1) * limit,
      take: ranked ? PRODUCT_RANK_WINDOW : limit,
      select: {
        id: true,
        title: true,
        slug: true,
        priceCents: true,
        compareAtCents: true,
        currency: true,
        stock: true,
        trackInventory: true,
        status: true,
        brand: true,
        ratingAvgBps: true,
        ratingCount: true,
        soldCount: true,
        images: { orderBy: { position: "asc" }, take: 1, select: { url: true, alt: true } },
        shop: { select: { id: true, name: true, slug: true, verifiedAt: true, ownerUserId: true } },
        category: { select: { id: true, name: true, slug: true } },
        variants: { where: { isDefault: true }, take: 1, select: { id: true } },
      },
    }),
    db.product.count({ where }),
  ]);

  let ordered = rows;
  if (ranked) {
    const boosts = await getVisibilityBoosts(rows.map((r) => r.shop.ownerUserId));
    const scored = rows.map((row) => ({
      row,
      score: productRankScore({
        soldCount: row.soldCount,
        ratingAvgBps: row.ratingAvgBps,
        ratingCount: row.ratingCount,
        inStock: row.status === "ACTIVE",
        verifiedShop: Boolean(row.shop.verifiedAt),
        relevance: params.query ? relevanceScore(params.query, { title: row.title, secondary: row.brand ?? undefined }) : 0,
        planBoost: boosts.get(row.shop.ownerUserId) ?? 1,
      }),
    }));
    scored.sort((a, b) => b.score - a.score);
    ordered = scored.slice((page - 1) * limit, page * limit).map((s) => s.row);
  }

  // The owner id was only needed for ranking; it is not part of the public card.
  const items = ordered.map(({ shop: { ownerUserId: _owner, ...shop }, ...row }) => ({ ...row, shop }));

  return { items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

const PRODUCT_RANK_WINDOW = 400;

/**
 * Product ranking, in one readable place, on the same principle as listing
 * ranking: quality and relevance first, and a paid plan multiplies that score
 * (capped at `MAX_VISIBILITY_BOOST`) rather than overriding it. An out-of-stock
 * product from a Seller Pro shop still sits below a well-reviewed one in stock.
 */
export function productRankScore(input: {
  soldCount: number;
  ratingAvgBps: number;
  ratingCount: number;
  inStock: boolean;
  verifiedShop: boolean;
  relevance: number;
  planBoost?: number;
}): number {
  // A baseline for simply being listed. Without it a brand-new product scores
  // zero, and a multiplier on zero is zero, so a new Seller Pro shop would get
  // nothing for its plan until it had already sold something.
  let score = 10;
  score += Math.min(60, input.relevance);
  score += Math.min(30, Math.log1p(input.soldCount) * 6);
  // A rating only counts in proportion to how many people gave it; one
  // five-star review is not evidence of anything.
  const confidence = Math.min(1, input.ratingCount / 10);
  score += (Math.min(500, input.ratingAvgBps) / 500) * 20 * confidence;
  if (input.verifiedShop) score += 8;
  if (!input.inStock) score *= 0.5;
  return score * (input.planBoost ?? 1);
}

export async function getProductBySlug(slug: string) {
  const product = await db.product.findFirst({
    where: { slug, deletedAt: null },
    select: {
      id: true,
      title: true,
      slug: true,
      description: true,
      brand: true,
      priceCents: true,
      compareAtCents: true,
      currency: true,
      stock: true,
      trackInventory: true,
      status: true,
      attributes: true,
      weightGrams: true,
      ratingAvgBps: true,
      ratingCount: true,
      soldCount: true,
      publishedAt: true,
      images: { orderBy: { position: "asc" }, select: { id: true, url: true, alt: true } },
      variants: {
        orderBy: { position: "asc" },
        select: { id: true, name: true, priceCents: true, stock: true, isDefault: true },
      },
      category: { select: { id: true, name: true, slug: true } },
      shop: {
        select: {
          id: true,
          name: true,
          slug: true,
          logoUrl: true,
          verifiedAt: true,
          ratingAvgBps: true,
          ratingCount: true,
          orderCount: true,
          flatShippingCents: true,
          freeShippingThresholdCents: true,
          country: true,
          city: true,
        },
      },
    },
  });

  if (!product || (product.status !== "ACTIVE" && product.status !== "OUT_OF_STOCK")) {
    throw notFound("That product");
  }

  await db.product.update({ where: { id: product.id }, data: { viewCount: { increment: 1 } } }).catch(() => {});

  return product;
}

export async function listShopOrders(auth: AuthContext, shopId: string, status?: string) {
  await assertOwnsShop(shopId, auth);

  return db.orderItem.findMany({
    where: {
      shopId,
      ...(status ? { fulfillmentStatus: status } : {}),
      order: { status: { notIn: ["PENDING_PAYMENT", "CANCELLED"] } },
    },
    orderBy: { order: { placedAt: "desc" } },
    take: 100,
    select: {
      id: true,
      titleSnapshot: true,
      variantSnapshot: true,
      imageSnapshot: true,
      quantity: true,
      unitPriceCents: true,
      totalCents: true,
      sellerEarningsCents: true,
      commissionCents: true,
      fulfillmentStatus: true,
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          paymentMethod: true,
          placedAt: true,
          currency: true,
          shippingName: true,
          shippingCity: true,
          shippingCountry: true,
          buyer: { select: { id: true, name: true, avatarUrl: true } },
        },
      },
    },
  });
}

export async function updateFulfillment(
  auth: AuthContext,
  orderItemId: string,
  status: "PACKED" | "SHIPPED" | "DELIVERED" | "CANCELLED",
) {
  const item = await db.orderItem.findUnique({
    where: { id: orderItemId },
    select: {
      id: true,
      shopId: true,
      orderId: true,
      fulfillmentStatus: true,
      order: { select: { paymentMethod: true, status: true } },
    },
  });
  if (!item) throw notFound("That order item");
  await assertOwnsShop(item.shopId, auth);

  // A shop that delivers its own parcels marks them delivered here. For a
  // cash-on-delivery order that is the moment the shop has the cash, so the
  // commission on it is charged in the same transaction.
  await db.$transaction(async (tx) => {
    await tx.orderItem.update({ where: { id: orderItemId }, data: { fulfillmentStatus: status } });
    if (status === "DELIVERED" && item.order.paymentMethod === "COD") {
      const shopItems = await tx.orderItem.findMany({
        where: { orderId: item.orderId, shopId: item.shopId },
        select: { fulfillmentStatus: true },
      });
      if (shopItems.every((i) => i.fulfillmentStatus === "DELIVERED" || i.fulfillmentStatus === "CANCELLED")) {
        const { settleCashOnDelivery } = await import("@/lib/payments/settlement");
        await settleCashOnDelivery(tx, item.orderId, item.shopId);
      }
    }
  });

  // The order status reflects the least-advanced item, so an order is only
  // "shipped" once every seller has actually shipped.
  const siblings = await db.orderItem.findMany({
    where: { orderId: item.orderId },
    select: { fulfillmentStatus: true },
  });

  const allDelivered = siblings.every((s) => s.fulfillmentStatus === "DELIVERED");
  const allShipped = siblings.every((s) => ["SHIPPED", "DELIVERED"].includes(s.fulfillmentStatus));

  if (allDelivered) {
    await db.order.update({ where: { id: item.orderId }, data: { status: "DELIVERED" } });
  } else if (allShipped) {
    await db.order.update({ where: { id: item.orderId }, data: { status: "SHIPPED" } });
  } else {
    await db.order.updateMany({
      where: { id: item.orderId, status: { in: ["PAID", "CONFIRMED"] } },
      data: { status: "PROCESSING" },
    });
  }

  await audit({
    action: "order.fulfilled",
    actorId: auth.user.id,
    entityType: "ORDER_ITEM",
    entityId: orderItemId,
    summary: status,
  });
}

export async function listCategories() {
  return db.category.findMany({
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      icon: true,
      parentId: true,
      _count: { select: { products: true } },
    },
  });
}
