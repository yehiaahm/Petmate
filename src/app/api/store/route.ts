import { z } from "zod";
import { route } from "@/lib/api";
import { requireActive } from "@/lib/auth/rbac";
import {
  searchProducts,
  createShop,
  shopSchema,
  createProduct,
  productSchema,
  updateProduct,
  listCategories,
  updateFulfillment,
  listShopOrders,
} from "@/lib/services/commerce.service";
import { cuidSchema } from "@/lib/validation/common";
import { LIMITS } from "@/lib/constants";

export const GET = route({
  rateLimit: "search",
  query: z.object({
    mode: z.enum(["products", "categories", "shop-orders"]).default("products"),
    q: z.string().max(200).optional(),
    categoryId: cuidSchema.optional(),
    shopId: cuidSchema.optional(),
    minPrice: z.coerce.number().int().min(0).optional(),
    maxPrice: z.coerce.number().int().min(0).optional(),
    inStock: z.coerce.boolean().optional(),
    status: z.string().max(30).optional(),
    sort: z.enum(["relevance", "price_asc", "price_desc", "newest", "popular", "rating"]).optional(),
    page: z.coerce.number().int().min(1).max(500).default(1),
    limit: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(24),
  }),
  async handler({ query }) {
    if (query.mode === "categories") {
      const categories = await listCategories();
      return { categories };
    }

    if (query.mode === "shop-orders") {
      const auth = await requireActive();
      if (!query.shopId) return { orders: [] };
      const orders = await listShopOrders(auth, query.shopId, query.status);
      return { orders };
    }

    return searchProducts({
      query: query.q,
      categoryId: query.categoryId,
      shopId: query.shopId,
      minPriceCents: query.minPrice != null ? query.minPrice * 100 : undefined,
      maxPriceCents: query.maxPrice != null ? query.maxPrice * 100 : undefined,
      inStockOnly: query.inStock,
      sort: query.sort,
      page: query.page,
      limit: query.limit,
    });
  },
});

export const POST = route({
  auth: true,
  verifiedEmail: true,
  body: z.discriminatedUnion("action", [
    z.object({ action: z.literal("create-shop"), shop: shopSchema }),
    z.object({ action: z.literal("create-product"), shopId: cuidSchema, product: productSchema }),
    z.object({
      action: z.literal("update-product"),
      productId: cuidSchema,
      product: productSchema.partial(),
    }),
    z.object({
      action: z.literal("fulfil"),
      orderItemId: cuidSchema,
      status: z.enum(["PACKED", "SHIPPED", "DELIVERED", "CANCELLED"]),
    }),
  ]),
  async handler({ body }) {
    const auth = await requireActive();

    switch (body.action) {
      case "create-shop": {
        const shop = await createShop(auth, body.shop);
        return { shop };
      }
      case "create-product": {
        const product = await createProduct(auth, body.shopId, body.product);
        return { product };
      }
      case "update-product": {
        const product = await updateProduct(auth, body.productId, body.product);
        return { product };
      }
      case "fulfil":
        await updateFulfillment(auth, body.orderItemId, body.status);
        return { ok: true };
    }
  },
});
