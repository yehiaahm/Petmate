import type { Metadata } from "next";
import Link from "next/link";
import { LifeBuoy } from "lucide-react";
import { requireAuth } from "@/lib/auth/rbac";
import {
  listMySupportTickets,
  SUPPORT_TOPIC_LABEL,
  type SupportTopic,
} from "@/lib/services/support.service";
import { PageHeader, Card, EmptyState, Badge } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
  title: t("My support requests"),
  robots: { index: false, follow: false },
};
}

const STATUS_TONE: Record<string, "info" | "warning" | "success" | "neutral"> = {
  OPEN: "info",
  AWAITING_USER: "warning",
  RESOLVED: "success",
  CLOSED: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  OPEN: "With support",
  AWAITING_USER: "Waiting on you",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

export default async function SupportHistoryPage() {
  const { t, fmt } = await getI18n();
  const auth = await requireAuth();
  const tickets = await listMySupportTickets(auth.user.id, auth.user.email);

  return (
    <>
      <PageHeader
        title={t("Support")}
        description={t("Every request you have opened, including ones you sent before signing in with this address.")}
        action={<ButtonLink href="/support#contact">{t("New request")}</ButtonLink>}
      />

      <div className="mt-6">
        {tickets.length === 0 ? (
          <EmptyState
            icon={<LifeBuoy className="size-5" aria-hidden />}
            title={t("You have not contacted us")}
            description={t("Most answers are in the help centre. If yours is not, a person reads every message.")}
            action={<ButtonLink href="/support">{t("Open the help centre")}</ButtonLink>}
          />
        ) : (
          <ul className="space-y-2">
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <Link href={`/support/${ticket.reference}`} className="block">
                  <Card interactive className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0">
                        <p className="text-[15px] font-medium text-fg">{ticket.subject}</p>
                        <p className="mt-0.5 text-xs text-fg-subtle">
                          <span className="font-mono">{ticket.reference}</span> ·{" "}
                          {t(SUPPORT_TOPIC_LABEL[ticket.topic as SupportTopic] ?? ticket.topic)} ·{" "}
                          {t("updated {when}", { when: fmt.relative(ticket.lastReplyAt) })}
                        </p>
                      </div>
                      <Badge tone={STATUS_TONE[ticket.status] ?? "neutral"} size="sm">
                        {t(STATUS_LABEL[ticket.status] ?? ticket.status)}
                      </Badge>
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
