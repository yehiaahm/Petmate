import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { badRequest, conflict, notFound, unprocessable } from "@/lib/errors";
import { assertOwnsShop, isStaff } from "@/lib/auth/rbac";
import type { AuthContext } from "@/lib/auth/session";
import { applyBps } from "@/lib/money";
import { resolveCommissionBps } from "@/lib/settings";
import { generateOrderNumber, uniqueSlug } from "@/lib/utils";
import { buildSearchText, searchTextClauses } from "@/lib/search/text";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getEntitlements } from "@/lib/billing/entitlements";
import {
  safeText,
  safeParagraph,
  optionalText,
  cuidSchema,
  centsSchema,
  currencySchema,
  emailSchema,
  phoneSchema,
} from "@/lib/validation/common";
import { LIMITS } from "@/lib/constants";

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
  flatShippingCents: centsSchema.default(599),
  freeShippingThresholdCents: centsSchema.optional(),
});

export async function createShop(auth: AuthContext, input: z.infer<typeof shopSchema>) {
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

    await audit(
      { action: "user.role_granted", actorId: auth.user.id, entityType: "SHOP", entityId: shop.id, summary: "Shop created" },
      tx,
    );

    return shop;
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
  currency: currencySchema.default("USD"),
  stock: z.number().int().min(0).max(1_000_000).default(0),
  trackInventory: z.boolean().default(true),
  lowStockAt: z.number().int().min(0).max(1000).default(5),
  weightGrams: z.number().int().min(0).max(500_000).optional(),
  attributes: z.record(z.string(), z.string()).optional(),
  images: z.array(z.object({ url: z.string().max(1000), alt: optionalText(160) })).max(LIMITS.imagesPerProduct).optional(),
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
      data: {
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
      },
      select: { id: true, slug: true, title: true, status: true },
    });

    return product;
  });
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

  return {
    items: lines.map(({ _shop, _currency, ...rest }) => rest),
    shops,
    subtotalCents,
    shippingCents,
    totalCents: subtotalCents + shippingCents,
    currency: lines[0]?._currency ?? "USD",
    hasUnavailable: lines.some((l) => !l.available),
  };
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
});

/**
 * Creates the order and reserves stock. Returns the amount to charge, which the
 * payment layer then uses — the client never supplies a total.
 */
export async function createOrder(auth: AuthContext, input: z.infer<typeof checkoutSchema>) {
  await enforceRateLimit("checkout", auth.user.id);

  const cart = await getCart(auth.user.id);
  const available = cart.items.filter((i) => i.available);

  if (!available.length) {
    throw badRequest(
      cart.items.length ? "Nothing in your basket is available right now." : "Your basket is empty.",
    );
  }

  const entitlements = await getEntitlements(auth.user.id);

  const order = await db.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        orderNumber: generateOrderNumber("PM"),
        buyerId: auth.user.id,
        status: "PENDING_PAYMENT",
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
              shop: { select: { commissionBps: true } },
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
      const commissionBps = Math.max(0, baseBps - entitlements.commissionDiscountBps);

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

  // Unpaid orders return their stock after 30 minutes.
  const { enqueueJob } = await import("@/lib/jobs/queue");
  await enqueueJob({
    type: "listing.expire",
    payload: { expireOrderId: order.id },
    runAt: new Date(Date.now() + 30 * 60_000),
    uniqueKey: `order.expire:${order.id}`,
  });

  return order;
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
export async function cancelOrder(
  params: { orderId: string; reason: string; actorId: string; requireBuyerId?: string },
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: params.orderId },
      select: {
        id: true,
        status: true,
        buyerId: true,
        items: { select: { variantId: true, quantity: true } },
      },
    });
    if (!order) return false;
    if (params.requireBuyerId && order.buyerId !== params.requireBuyerId) return false;

    const claimed = await tx.order.updateMany({
      where: { id: order.id, status: { in: ["PENDING_PAYMENT", "PAID", "PROCESSING"] } },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: params.reason },
    });
    if (claimed.count === 0) return false;

    for (const item of order.items) {
      await tx.productVariant.update({
        where: { id: item.variantId },
        data: { stock: { increment: item.quantity } },
      });
      const variant = await tx.productVariant.findUnique({
        where: { id: item.variantId },
        select: { productId: true },
      });
      if (variant) {
        await tx.product.update({
          where: { id: variant.productId },
          data: { stock: { increment: item.quantity }, status: "ACTIVE" },
        });
      }
    }

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

    return true;
  });
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

  const [items, total] = await Promise.all([
    db.product.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
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
        shop: { select: { id: true, name: true, slug: true, verifiedAt: true } },
        category: { select: { id: true, name: true, slug: true } },
        variants: { where: { isDefault: true }, take: 1, select: { id: true } },
      },
    }),
    db.product.count({ where }),
  ]);

  return { items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
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
    select: { id: true, shopId: true, orderId: true, fulfillmentStatus: true },
  });
  if (!item) throw notFound("That order item");
  await assertOwnsShop(item.shopId, auth);

  await db.orderItem.update({ where: { id: orderItemId }, data: { fulfillmentStatus: status } });

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
      where: { id: item.orderId, status: "PAID" },
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
