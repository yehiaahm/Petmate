import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/rbac";
import { getPetOrder } from "@/lib/services/petorder.service";
import { isAppError } from "@/lib/errors";
import { PetOrderDetail } from "@/components/orders/pet-order-detail";
import { toPetOrderView } from "@/components/orders/serialize";
import { Breadcrumbs, PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Sale",
  robots: { index: false, follow: false },
};

export default async function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, auth] = await Promise.all([params, requireAuth()]);

  let order;
  try {
    order = await getPetOrder(auth, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (order.isBuyer) redirect(`/dashboard/purchases/${order.id}`);

  return (
    <div className="container-page max-w-3xl py-8 lg:py-10">
      <Breadcrumbs
        items={[
          { label: "Orders", href: "/dashboard/orders" },
          { label: order.orderNumber },
        ]}
      />
      <PageHeader title="Your sale" description="What the buyer has confirmed, and what you are owed." />
      <div className="mt-6">
        <PetOrderDetail order={toPetOrderView(order)} />
      </div>
    </div>
  );
}
