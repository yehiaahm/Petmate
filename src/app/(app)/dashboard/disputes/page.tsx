import type { Metadata } from "next";
import Link from "next/link";
import { Scale } from "lucide-react";
import { requireAuth } from "@/lib/auth/rbac";
import { listMyDisputes } from "@/lib/services/safety.service";
import { PageHeader, Card, Badge, EmptyState } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import {
  DISPUTE_REASON_LABEL,
  DISPUTE_STATUS_LABEL,
  type DisputeReason,
  type DisputeStatus,
} from "@/lib/constants";
import { PLATFORM_CURRENCY } from "@/lib/currency";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
  title: t("Disputes"),
  robots: { index: false, follow: false },
};
}

const TONE: Record<string, "info" | "warning" | "success" | "danger" | "neutral"> = {
  OPEN: "warning",
  AWAITING_RESPONSE: "warning",
  IN_REVIEW: "info",
  RESOLVED_BUYER: "success",
  RESOLVED_SELLER: "success",
  RESOLVED_SPLIT: "success",
  WITHDRAWN: "neutral",
};

export default async function DisputesPage() {
  const { t, fmt } = await getI18n();
  const auth = await requireAuth();
  const disputes = await listMyDisputes(auth);

  return (
    <div className="container-page max-w-3xl py-8 lg:py-10">
      <PageHeader
        title={t("Disputes")}
        description={t("Money stays frozen while a dispute is open. Both sides submit evidence, and a person decides.")}
      />

      <div className="mt-6">
        {disputes.length === 0 ? (
          <EmptyState
            icon={<Scale className="size-5" aria-hidden />}
            title={t("No disputes")}
            description={t("Open one from an order if something went wrong. Escrow freezes the moment you do.")}
            action={<ButtonLink href="/dashboard/orders">{t("Go to orders")}</ButtonLink>}
          />
        ) : (
          <ul className="space-y-2">
            {disputes.map((dispute) => (
              <li key={dispute.id}>
                <Link href={`/dashboard/disputes/${dispute.id}`} className="block">
                  <Card interactive className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-4">
                    <div className="min-w-0">
                      <p className="text-[15px] font-medium text-fg">
                        {dispute.petOrder?.listing.title ??
                          dispute.order?.orderNumber ??
                          t("Order")}
                      </p>
                      <p className="mt-0.5 text-sm text-fg-muted">
                        {t(DISPUTE_REASON_LABEL[dispute.reason as DisputeReason] ?? dispute.reason)}
                        {" · "}{dispute.raisedById === auth.user.id ? t("you opened this") : t("opened against you")}
                      </p>
                      <p className="mt-0.5 text-xs text-fg-subtle">
                        <span className="font-mono">{dispute.reference}</span> ·{" "}
                        {t("opened {date}", { date: fmt.date(dispute.createdAt) })}
                        {dispute.responseDueAt && dispute.status === "AWAITING_RESPONSE"
                          ? ` · ${t("response due {when}", { when: fmt.relative(dispute.responseDueAt) })}`
                          : ""}
                      </p>
                    </div>
                    <div className="text-end">
                      <p className="text-sm font-semibold tabular text-fg">
                        {fmt.money(dispute.amountCents, dispute.petOrder?.currency ?? dispute.order?.currency ?? PLATFORM_CURRENCY)}
                      </p>
                      <Badge tone={TONE[dispute.status] ?? "neutral"} size="sm">
                        {t(DISPUTE_STATUS_LABEL[dispute.status as DisputeStatus] ?? dispute.status)}
                      </Badge>
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
