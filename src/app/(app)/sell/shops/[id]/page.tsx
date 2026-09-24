import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Clock, ExternalLink, Plus, Upload } from "lucide-react";
import { requireAuth } from "@/lib/auth/rbac";
import { getShopConsole } from "@/lib/services/commerce.service";
import { getEntitlements } from "@/lib/billing/entitlements";
import { isAppError } from "@/lib/errors";
import { getI18n } from "@/lib/i18n/server";
import { PageHeader, Breadcrumbs, Alert, Card, CardHeader, Badge, Stat } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { ProductTable } from "@/components/sell/product-table";
import { ProductImport } from "@/components/sell/product-import";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("Shop console"), robots: { index: false, follow: false } };
}

export default async function ShopConsolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [auth, { t, fmt }] = await Promise.all([requireAuth(), getI18n()]);

  const { shop, products, pendingVerification } = await getShopConsole(auth, id).catch((error) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const entitlements = await getEntitlements(auth.user.id);

  const active = shop.status === "ACTIVE";
  const onSale = products.filter((p) => p.status === "ACTIVE").length;
  const lowStock = products.filter((p) => p.trackInventory && p.status !== "DRAFT" && p.stock <= p.lowStockAt).length;

  return (
    <div className="container-page max-w-5xl py-8 lg:py-10">
      <Breadcrumbs items={[{ label: t("Seller console"), href: "/sell" }, { label: shop.name }]} />

      <PageHeader
        eyebrow={t("Shop")}
        title={shop.name}
        description={
          <span className="inline-flex items-center gap-2">
            <Badge tone={active ? "success" : "warning"} size="sm">
              {active ? t("Live") : t("In review")}
            </Badge>
            {shop.city && <span>{shop.city}</span>}
          </span>
        }
        action={
          <div className="flex flex-wrap gap-2">
            {active && (
              <ButtonLink href={`/store?shopId=${shop.id}`} variant="outline" size="sm">
                <ExternalLink className="size-4" aria-hidden />
                {t("View storefront")}
              </ButtonLink>
            )}
            {active && (
              <ButtonLink href={`/sell/shops/${shop.id}/products/new`} size="sm">
                <Plus className="size-4" aria-hidden />
                {t("Add product")}
              </ButtonLink>
            )}
          </div>
        }
      />

      {!active && (
        <Alert tone="warning" className="mt-6" icon={<Clock className="size-4" aria-hidden />} title={t("Your shop is being reviewed")}>
          {pendingVerification
            ? t("Submitted {date}. We check the business details before a shop can sell, usually within one working day. You will get an email when it is approved.", {
                date: fmt.date(pendingVerification.createdAt),
              })
            : t("This shop is not live. Contact support if you think that is a mistake.")}
        </Alert>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat label={t("Products on sale")} value={fmt.number(onSale)} />
        <Stat label={t("Low on stock")} value={fmt.number(lowStock)} />
        <Stat label={t("Orders")} value={fmt.number(shop.orderCount)} />
      </div>

      <Card className="mt-6">
        <CardHeader title={t("Products")} description={t("Everything in this shop, drafts included.")} />
        <div className="p-5">
          <ProductTable
            shopId={shop.id}
            canList={active}
            products={products.map((p) => ({
              id: p.id,
              title: p.title,
              slug: p.slug,
              sku: p.sku,
              status: p.status,
              priceCents: p.priceCents,
              currency: p.currency,
              stock: p.stock,
              trackInventory: p.trackInventory,
              lowStockAt: p.lowStockAt,
              soldCount: p.soldCount,
              image: p.images[0] ?? null,
            }))}
          />
        </div>
      </Card>

      {active && (
        <Card className="mt-6">
          <CardHeader
            title={
              <span className="inline-flex items-center gap-2">
                <Upload className="size-4" aria-hidden />
                {t("Bulk import and stock updates")}
              </span>
            }
          />
          <div className="p-5">
            <ProductImport shopId={shop.id} entitled={entitlements.bulkTools} />
          </div>
        </Card>
      )}
    </div>
  );
}
