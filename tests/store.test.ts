import { describe, it, expect, beforeEach } from "vitest";
import { db, makeUser, makeShopWithProduct, resetDatabase, subscribeUser } from "./helpers";
import { parseCsv, csvRecords, csvCell } from "@/lib/csv";
import {
  createShop,
  importProducts,
  archiveProduct,
  addToCart,
  productSchema,
  getShopConsole,
} from "@/lib/services/commerce.service";
import { decideVerification } from "@/lib/services/safety.service";
import { isAppError } from "@/lib/errors";

describe("CSV", () => {
  it("handles quotes, embedded commas and line breaks, and Excel's BOM", () => {
    const text = '﻿sku,title\r\nA1,"Bed, large"\r\nA2,"Two\nlines"\r\nA3,"She said ""hi"""\r\n\r\n';
    expect(parseCsv(text)).toEqual([
      ["sku", "title"],
      ["A1", "Bed, large"],
      ["A2", "Two\nlines"],
      ["A3", 'She said "hi"'],
    ]);
  });

  it("keys records by trimmed, lower-cased headers", () => {
    const { headers, records } = csvRecords(" SKU , Title \nx1, Bowl \n");
    expect(headers).toEqual(["sku", "title"]);
    expect(records).toEqual([{ sku: "x1", title: "Bowl" }]);
  });

  it("quotes only what needs quoting", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(null)).toBe("");
  });
});

describe("opening a shop", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("queues the shop for review, and approval puts it live", async () => {
    const owner = await makeUser();
    const shop = await createShop(owner.auth, {
      name: "Zamalek Pet Supplies",
      email: "shop@example.test",
      country: "Egypt",
      flatShippingCents: 6_000,
    });

    const verification = await db.verification.findFirstOrThrow({
      where: { subjectType: "SHOP", subjectId: shop.id },
    });
    expect(verification.status).toBe("PENDING");
    expect((await getShopConsole(owner.auth, shop.id)).pendingVerification?.id).toBe(verification.id);

    const admin = await makeUser({ roles: ["USER", "ADMIN"] });
    await decideVerification(admin.auth, verification.id, "APPROVED", "Business registration checked");

    const live = await db.shop.findUniqueOrThrow({ where: { id: shop.id }, select: { status: true, verifiedAt: true } });
    expect(live.status).toBe("ACTIVE");
    expect(live.verifiedAt).not.toBeNull();
  });

  it("hides another seller's shop behind a 404", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const { shopId } = await makeShopWithProduct(owner.id);
    await expect(getShopConsole(stranger.auth, shopId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("product images", () => {
  it("accepts uploads and https, and refuses anything a page should not load", () => {
    const base = { title: "A bowl", description: "A description that is long enough to pass.", priceCents: 1000 };
    const ok = (url: string) => productSchema.safeParse({ ...base, images: [{ url }] }).success;
    expect(ok("/uploads/product_image/2026/a.webp")).toBe(true);
    expect(ok("https://cdn.example.com/a.webp")).toBe(true);
    expect(ok("javascript:alert(1)")).toBe(false);
    expect(ok("data:image/png;base64,AAAA")).toBe(false);
    expect(ok("http://example.com/a.png")).toBe(false);
    expect(ok("//evil.example/a.png")).toBe(false);
  });
});

describe("bulk import", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  const header = "sku,title,description,price,compare_at_price,stock,brand,category,weight_grams,publish";
  const row = (sku: string, price: string, stock = "10") =>
    `${sku},Product ${sku},"A description that is long enough for validation, with a comma.",${price},,${stock},Brand,,500,yes`;

  async function seller() {
    const owner = await makeUser();
    const { shopId } = await makeShopWithProduct(owner.id);
    return { owner, shopId };
  }

  it("is a Seller Pro feature", async () => {
    const { owner, shopId } = await seller();
    const error = await importProducts(owner.auth, shopId, `${header}\n${row("A1", "250")}`).catch((e) => e);
    expect(isAppError(error) && error.code).toBe("UPGRADE_REQUIRED");
  });

  it("creates new products and updates existing ones by SKU", async () => {
    const { owner, shopId } = await seller();
    await subscribeUser(owner.id, { bulkTools: true });

    const first = await importProducts(owner.auth, shopId, [header, row("A1", "250"), row("A2", "\"1,200.50\"", "0")].join("\n"));
    expect(first).toEqual({ applied: true, created: 2, updated: 0, errors: [] });

    const a1 = await db.product.findFirstOrThrow({ where: { shopId, sku: "A1" }, include: { variants: true } });
    expect(a1.priceCents).toBe(25_000);
    expect(a1.status).toBe("ACTIVE");
    expect(a1.variants[0]!.stock).toBe(10);
    // Published with no stock is shown honestly as sold out.
    const a2 = await db.product.findFirstOrThrow({ where: { shopId, sku: "A2" } });
    expect(a2.priceCents).toBe(120_050);
    expect(a2.status).toBe("OUT_OF_STOCK");

    // A stock-only update, written with Arabic-Indic digits as Arabic Excel does.
    const second = await importProducts(owner.auth, shopId, "sku,stock,price\nA2,٣٥,١١٠٠\n");
    expect(second).toMatchObject({ applied: true, created: 0, updated: 1 });
    const updated = await db.product.findFirstOrThrow({ where: { id: a2.id }, include: { variants: true } });
    expect(updated.stock).toBe(35);
    expect(updated.priceCents).toBe(110_000);
    expect(updated.status).toBe("ACTIVE");
    expect(updated.variants[0]!.stock).toBe(35);
    expect(updated.variants[0]!.priceCents).toBe(110_000);
  });

  it("applies nothing when any row is wrong, and says which rows", async () => {
    const { owner, shopId } = await seller();
    await subscribeUser(owner.id, { bulkTools: true });
    const before = await db.product.count({ where: { shopId } });

    const csv = [header, row("B1", "250"), row("B2", "free"), row("B1", "300"), "B4,Short,too short,10,,1,,no-such-category,,maybe"].join("\n");
    const result = await importProducts(owner.auth, shopId, csv);

    expect(result.applied).toBe(false);
    expect(await db.product.count({ where: { shopId } })).toBe(before);
    const where = result.errors.map((e) => `${e.row}:${e.column}`);
    expect(where).toEqual(expect.arrayContaining(["3:price", "4:sku", "5:category", "5:publish"]));
    // Row numbers match the spreadsheet: the header is row 1.
    expect(result.errors.every((e) => e.row >= 2)).toBe(true);
  });

  it("refuses files it cannot read before looking at any row", async () => {
    const { owner, shopId } = await seller();
    await subscribeUser(owner.id, { bulkTools: true });
    expect((await importProducts(owner.auth, shopId, "colour,size\nred,L")).errors[0]!.message).toMatch(/title/);
    expect((await importProducts(owner.auth, shopId, "sku,title,colour\nA,B,red")).errors[0]!.message).toBe("Unknown columns: colour.");
    const tooMany = [header, ...Array.from({ length: 501 }, (_, i) => row(`R${i}`, "10"))].join("\n");
    expect((await importProducts(owner.auth, shopId, tooMany)).errors[0]!.message).toMatch(/up to 500 rows/);
  });
});

describe("archiving a product", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("takes it off sale and out of every basket", async () => {
    const owner = await makeUser();
    const buyer = await makeUser();
    const { productId, variantId } = await makeShopWithProduct(owner.id);
    await addToCart(buyer.auth, { variantId, quantity: 1 });
    expect(await db.cartItem.count({ where: { variantId } })).toBe(1);

    await archiveProduct(owner.auth, productId);

    const product = await db.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.deletedAt).not.toBeNull();
    expect(product.status).toBe("ARCHIVED");
    expect(await db.cartItem.count({ where: { variantId } })).toBe(0);

    await expect(archiveProduct(buyer.auth, productId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
