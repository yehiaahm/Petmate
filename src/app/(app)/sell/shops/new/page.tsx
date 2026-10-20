import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/rbac";
import { getSettings } from "@/lib/settings";
import { bpsToPercent } from "@/lib/money";
import { getI18n } from "@/lib/i18n/server";
import { ShopForm } from "@/components/sell/shop-form";
import { PageHeader, Breadcrumbs, Alert } from "@/components/ui/primitives";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("Open a shop"), robots: { index: false, follow: false } };
}

export default async function NewShopPage() {
  const [auth, settings, { t }] = await Promise.all([requireAuth(), getSettings(), getI18n()]);

  return (
    <div className="container-page max-w-2xl py-8 lg:py-10">
      <Breadcrumbs items={[{ label: t("Seller console"), href: "/sell" }, { label: t("Open a shop") }]} />

      <PageHeader
        title={t("Open a shop")}
        description={t("A shop sells products — food, medication, beds, toys — and is separate from listing an animal.")}
      />

      <Alert tone="info" className="mt-6" title={t("What it costs")}>
        <p className="mt-1 leading-relaxed">
          {t("Nothing to open and no monthly fee. PetMate takes {rate} of each completed order, and nothing on an order that is cancelled or refunded.", {
            rate: bpsToPercent(settings.commissionProductBps),
          })}
        </p>
      </Alert>

      <div className="mt-6">
        <ShopForm defaultEmail={auth.user.email} defaultCity={auth.user.city} defaultCountry={auth.user.country} />
      </div>
    </div>
  );
}
