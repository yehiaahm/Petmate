import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth/rbac";
import { getDispute } from "@/lib/services/safety.service";
import { isAppError } from "@/lib/errors";
import { DisputeThread } from "@/components/disputes/dispute-thread";
import { Breadcrumbs } from "@/components/ui/primitives";
import { PLATFORM_CURRENCY } from "@/lib/currency";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
  title: t("Dispute"),
  robots: { index: false, follow: false },
};
}

export default async function DisputePage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, auth] = await Promise.all([params, requireAuth()]);

  let dispute;
  try {
    dispute = await getDispute(auth, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <div className="container-page max-w-3xl py-8 lg:py-10">
      <Breadcrumbs
        items={[
          { label: "Disputes", href: "/dashboard/disputes" },
          { label: dispute.reference },
        ]}
      />

      <DisputeThread
        dispute={{
          id: dispute.id,
          reference: dispute.reference,
          status: dispute.status,
          reason: dispute.reason,
          amountCents: dispute.amountCents,
          refundCents: dispute.refundCents,
          currency: dispute.petOrder?.currency ?? dispute.order?.currency ?? PLATFORM_CURRENCY,
          resolution: dispute.resolution,
          responseDueAt: dispute.responseDueAt?.toISOString() ?? null,
          createdAt: dispute.createdAt.toISOString(),
          resolvedAt: dispute.resolvedAt?.toISOString() ?? null,
          isRaiser: dispute.isRaiser,
          orderLabel:
            dispute.petOrder?.listing.title ?? dispute.order?.orderNumber ?? "Order",
          orderHref: dispute.petOrder
            ? `/dashboard/${dispute.isRaiser ? "purchases" : "sales"}/${dispute.petOrder.id}`
            : null,
          counterpartyName: dispute.isRaiser ? dispute.against.name : dispute.raisedBy.name,
          messages: dispute.messages.map((m) => ({
            id: m.id,
            body: m.body,
            isStaff: m.isStaff,
            isMine: m.authorId === auth.user.id,
            authorName:
              m.authorId === dispute.raisedById ? dispute.raisedBy.name : dispute.against.name,
            createdAt: m.createdAt.toISOString(),
          })),
        }}
      />
    </div>
  );
}
