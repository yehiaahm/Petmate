import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireAuth, assertOwnsShop } from "@/lib/auth/rbac";
import { listCategories } from "@/lib/services/commerce.service";
import { isAppError } from "@/lib/errors";
import { getI18n } from "@/lib/i18n/server";
import { PageHeader, Breadcrumbs } from "@/components/ui/primitives";
import { ProductForm } from "@/components/sell/product-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("Add a product"), robots: { index: false, follow: false } };
}

export default async function NewProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [auth, { t }] = await Promise.all([requireAuth(), getI18n()]);

  const shop = await assertOwnsShop(id, auth).catch((error) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  // A shop in review cannot list yet; its console explains why.
  if (shop.status !== "ACTIVE") redirect(`/sell/shops/${id}`);

  const categories = await listCategories();

  return (
    <div className="container-page max-w-3xl py-8 lg:py-10">
      <Breadcrumbs
        items={[
          { label: t("Seller console"), href: "/sell" },
          { label: shop.name, href: `/sell/shops/${id}` },
          { label: t("Add a product") },
        ]}
      />
      <PageHeader title={t("Add a product")} />
      <div className="mt-6">
        <ProductForm shopId={id} categories={categories.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId }))} />
      </div>
    </div>
  );
}
