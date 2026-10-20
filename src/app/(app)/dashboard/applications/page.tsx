import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Heart, MessageSquare } from "lucide-react";
import { requireAuth } from "@/lib/auth/rbac";
import { listMyApplications } from "@/lib/services/adoption.service";
import { PageHeader, Card, Badge, EmptyState } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { WithdrawApplication } from "@/components/adoption/withdraw-application";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
  title: t("My applications"),
  robots: { index: false, follow: false },
};
}

const TONE: Record<string, "info" | "warning" | "success" | "danger" | "neutral"> = {
  SUBMITTED: "info",
  IN_REVIEW: "info",
  SHORTLISTED: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  WITHDRAWN: "neutral",
  COMPLETED: "success",
};

const LABEL: Record<string, string> = {
  SUBMITTED: "Submitted",
  IN_REVIEW: "Being read",
  SHORTLISTED: "Shortlisted",
  APPROVED: "Approved",
  REJECTED: "Not this time",
  WITHDRAWN: "Withdrawn",
  COMPLETED: "Adopted",
};

export default async function MyApplicationsPage() {
  const { t, fmt } = await getI18n();
  const auth = await requireAuth();
  const applications = await listMyApplications(auth);

  return (
    <div className="container-page max-w-3xl py-8 lg:py-10">
      <PageHeader
        title={t("Adoption applications")}
        description={t("Rescues read these properly, which is why there are questions rather than a Contact button. Your answers are reused on every application.")}
      />

      <div className="mt-6">
        {applications.length === 0 ? (
          <EmptyState
            icon={<Heart className="size-5" aria-hidden />}
            title={t("No applications yet")}
            description={t("Apply once and your household profile carries over, so the second application takes a minute rather than ten.")}
            action={<ButtonLink href="/pets?intent=ADOPTION">{t("Browse adoptions")}</ButtonLink>}
          />
        ) : (
          <ul className="space-y-3">
            {applications.map((application) => (
              <li key={application.id}>
                <Card className="p-4">
                  <div className="flex gap-4">
                    {application.listing.pet.photos[0]?.url ? (
                      <Image
                        src={application.listing.pet.photos[0].url}
                        alt=""
                        width={64}
                        height={64}
                        className="size-16 shrink-0 rounded-xl object-cover"
                      />
                    ) : (
                      <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-bg-sunken text-fg-subtle">
                        <Heart className="size-5" aria-hidden />
                      </span>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/pets/${application.listing.slug}`}
                          className="text-[15px] font-medium text-fg hover:underline"
                        >
                          {application.listing.pet.name}
                        </Link>
                        <Badge tone={TONE[application.status] ?? "neutral"} size="sm">
                          {LABEL[application.status] ?? application.status}
                        </Badge>
                      </div>

                      <p className="mt-0.5 text-sm text-fg-muted">
                        {application.listing.title} ·{" "}
                        {[application.listing.city, application.listing.country]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                      <p className="mt-0.5 text-xs text-fg-subtle">
                        {t("Applied {date}", { date: fmt.date(application.createdAt) })} · {t("fit score")}{" "}
                        <span className="tabular">{application.score}</span>
                      </p>

                      {application.decisionNote && (
                        <p className="mt-2 rounded-[var(--radius-field)] bg-bg-sunken px-3.5 py-2.5 text-sm leading-relaxed text-fg-muted">
                          <span className="font-medium text-fg">
                            {t("{name} said:", { name: application.listing.seller.name })}{" "}
                          </span>
                          {application.decisionNote}
                        </p>
                      )}

                      <div className="mt-3 flex flex-wrap gap-2">
                        {application.conversationId && (
                          <ButtonLink
                            href={`/messages/${application.conversationId}`}
                            size="sm"
                            variant="outline"
                          >
                            <MessageSquare className="size-4" aria-hidden />
                            {t("Conversation")}
                          </ButtonLink>
                        )}
                        {["SUBMITTED", "IN_REVIEW", "SHORTLISTED"].includes(
                          application.status,
                        ) && <WithdrawApplication applicationId={application.id} />}
                      </div>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
