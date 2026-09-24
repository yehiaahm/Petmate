import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { OpenDisputeForm } from "@/components/disputes/open-dispute-form";
import { Breadcrumbs, PageHeader, Alert } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = {
  title: "Open a dispute",
  robots: { index: false, follow: false },
};

export default async function NewDisputePage({
  searchParams,
}: {
  searchParams: Promise<{ petOrderId?: string; orderId?: string }>;
}) {
  const [params, auth] = await Promise.all([searchParams, requireAuth()]);
  const settings = await getSettings();

  // Scoped to the caller: an id belonging to someone else's order matches
  // nothing, which is the same outcome as an id that does not exist.
  const petOrder = params.petOrderId
    ? await db.petOrder.findFirst({
        where: {
          id: params.petOrderId,
          OR: [{ buyerId: auth.user.id }, { sellerId: auth.user.id }],
        },
        select: {
          id: true,
          orderNumber: true,
          amountCents: true,
          currency: true,
          status: true,
          listing: { select: { title: true } },
        },
      })
    : null;

  const order = params.orderId
    ? await db.order.findFirst({
        where: { id: params.orderId, buyerId: auth.user.id },
        select: { id: true, orderNumber: true, totalCents: true, currency: true, status: true },
      })
    : null;

  if (!petOrder && !order) notFound();

  const subject = petOrder
    ? {
        kind: "pet" as const,
        id: petOrder.id,
        label: petOrder.listing.title,
        reference: petOrder.orderNumber,
        amountCents: petOrder.amountCents,
        currency: petOrder.currency,
      }
    : {
        kind: "order" as const,
        id: order!.id,
        label: `Store order ${order!.orderNumber}`,
        reference: order!.orderNumber,
        amountCents: order!.totalCents,
        currency: order!.currency,
      };

  return (
    <div className="container-page max-w-2xl py-8 lg:py-10">
      <Breadcrumbs
        items={[
          { label: "Disputes", href: "/dashboard/disputes" },
          { label: "New" },
        ]}
      />

      <PageHeader
        title="Open a dispute"
        description="Use this when something genuinely went wrong. It freezes the money and puts a person on the case."
      />

      <Alert tone="warning" className="mt-6" title="Try the other side first">
        <p className="mt-1 leading-relaxed">
          Most problems are a misunderstanding about timing or location, and a message resolves
          them in an hour. A dispute is slower and both sides see everything you write.
        </p>
      </Alert>

      <div className="mt-6 rounded-[var(--radius-card)] bg-bg-sunken p-4 text-sm">
        <p className="font-medium text-fg">{subject.label}</p>
        <p className="mt-0.5 text-fg-muted">
          <span className="font-mono text-xs">{subject.reference}</span> ·{" "}
          {formatMoney(subject.amountCents, subject.currency)}
        </p>
      </div>

      <div className="mt-6">
        <OpenDisputeForm
          subject={subject}
          disputeWindowDays={settings.disputeWindowDays}
        />
      </div>
    </div>
  );
}
