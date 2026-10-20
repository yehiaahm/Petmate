import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth/rbac";
import { getProductForEdit, listCategories } from "@/lib/services/commerce.service";
import { db } from "@/lib/db";
import { isAppError } from "@/lib/errors";
import { getI18n } from "@/lib/i18n/server";
import { PageHeader, Breadcrumbs } from "@/components/ui/primitives";
import { ProductForm } from "@/components/sell/product-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("Edit product"), robots: { index: false, follow: false } };
}

export default async function EditProductPage({ params }: { params: Promise<{ id: string; productId: string }> }) {
  const { id, productId } = await params;
  const [auth, { t }] = await Promise.all([requireAuth(), getI18n()]);

  const product = await getProductForEdit(auth, productId).catch((error) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  // The URL's shop must be the product's shop, or the breadcrumb would lie.
  if (product.shopId !== id) notFound();

  const [categories, shop] = await Promise.all([
    listCategories(),
    db.shop.findUniqueOrThrow({ where: { id }, select: { name: true } }),
  ]);

  return (
    <div className="container-page max-w-3xl py-8 lg:py-10">
      <Breadcrumbs
        items={[
          { label: t("Seller console"), href: "/sell" },
          { label: shop.name, href: `/sell/shops/${id}` },
          { label: product.title },
        ]}
      />
      <PageHeader title={t("Edit product")} />
      <div className="mt-6">
        <ProductForm
          shopId={id}
          categories={categories.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId }))}
          product={product}
        />
      </div>
    </div>
  );
}
