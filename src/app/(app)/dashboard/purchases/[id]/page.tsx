import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/rbac";
import { getPetOrder } from "@/lib/services/petorder.service";
import { isAppError } from "@/lib/errors";
import { PetOrderDetail } from "@/components/orders/pet-order-detail";
import { toPetOrderView } from "@/components/orders/serialize";
import { Breadcrumbs, PageHeader } from "@/components/ui/primitives";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
  title: t("Purchase"),
  robots: { index: false, follow: false },
};
}

export default async function PurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getI18n();
  const [{ id }, auth] = await Promise.all([params, requireAuth()]);

  let order;
  try {
    order = await getPetOrder(auth, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  // Both parties can read the order, but each has their own URL. Landing on
  // the wrong one is a redirect, not an error.
  if (!order.isBuyer) redirect(`/dashboard/sales/${order.id}`);

  return (
    <div className="container-page max-w-3xl py-8 lg:py-10">
      <Breadcrumbs
        items={[
          { label: "Orders", href: "/dashboard/orders" },
          { label: order.orderNumber },
        ]}
      />
      <PageHeader title={t("Your purchase")} description={t("Where the money is, and what happens next.")} />
      <div className="mt-6">
        <PetOrderDetail order={toPetOrderView(order)} />
      </div>
    </div>
  );
}
