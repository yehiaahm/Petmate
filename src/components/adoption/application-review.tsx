"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Home,
  Users,
  Clock,
  PawPrint,
  BadgeCheck,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  Inbox,
} from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, Badge, Avatar, EmptyState, DataRow } from "@/components/ui/primitives";
import { Field, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n/i18n-provider";

export interface ReviewApplication {
  id: string;
  status: string;
  score: number;
  homeType: string | null;
  hasYard: boolean;
  hasOtherPets: boolean;
  otherPetsInfo: string | null;
  hasChildren: boolean;
  childrenAges: string | null;
  hoursAloneDaily: number | null;
  experienceLevel: string | null;
  previousPets: string | null;
  motivation: string | null;
  createdAt: string;
  decisionNote: string | null;
  conversationId: string | null;
  reasons: { label: string; positive: boolean }[];
  applicant: {
    name: string;
    handle: string;
    avatarUrl: string | null;
    trustScore: number;
    city: string | null;
    country: string | null;
    emailVerified: boolean;
    memberSince: string;
    petCount: number;
  };
}

const TONE: Record<string, "info" | "warning" | "success" | "danger" | "neutral"> = {
  SUBMITTED: "info",
  IN_REVIEW: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  WITHDRAWN: "neutral",
  COMPLETED: "success",
};

export function ApplicationReview({
  applications,
  petName,
}: {
  applications: ReviewApplication[];
  petName: string;
}) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const toast = useToast();

  const [deciding, setDeciding] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(id: string, decision: "APPROVED" | "REJECTED" | "IN_REVIEW") {
    setBusy(`${decision}:${id}`);
    try {
      await api.post("/api/adoption", {
        action: "decide",
        applicationId: id,
        decision,
        note: note.trim() || undefined,
      });
      toast.success(
        decision === "APPROVED"
          ? "Approved"
          : decision === "REJECTED"
            ? "Declined"
            : "Marked as being read",
        decision === "APPROVED"
          ? `A conversation has been opened so you can arrange meeting ${petName}.`
          : undefined,
      );
      setDeciding(null);
      setNote("");
      router.refresh();
    } catch (err) {
      toast.error(
        t("That did not go through"),
        err instanceof ApiError ? err.message : "Please try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  if (applications.length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="size-5" aria-hidden />}
        title={t("No applications yet")}
        description={t("Applications appear here as they arrive, already scored against the answers given. Nothing is auto-rejected.")}
      />
    );
  }

  return (
    <ul className="space-y-4">
      {applications.map((application) => {
        const open = deciding === application.id;
        const decided = ["APPROVED", "REJECTED", "WITHDRAWN", "COMPLETED"].includes(
          application.status,
        );

        return (
          <li key={application.id}>
            <Card className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 gap-3">
                  <Avatar
                    src={application.applicant.avatarUrl}
                    name={application.applicant.name}
                    size="md"
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/u/${application.applicant.handle}`}
                        className="text-[15px] font-medium text-fg hover:underline"
                      >
                        {application.applicant.name}
                      </Link>
                      <Badge tone={TONE[application.status] ?? "neutral"} size="sm">
                        {application.status.replaceAll("_", " ").toLowerCase()}
                      </Badge>
                      {application.applicant.emailVerified && (
                        <BadgeCheck
                          className="size-3.5 text-[var(--success)]"
                          aria-label={t("Email confirmed")}
                        />
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-fg-subtle">
                      {[application.applicant.city, application.applicant.country]
                        .filter(Boolean)
                        .join(", ") || t("Location not given")}{" "}
                      · {t("trust {score}", { score: application.applicant.trustScore })} ·{" "}
                      {t.plural(application.applicant.petCount, { one: "{count} pet on PetMate", other: "{count} pets on PetMate" })} ·{" "}
                      {t("member since {date}", { date: fmt.date(application.applicant.memberSince) })}
                    </p>
                    <p className="mt-0.5 text-xs text-fg-subtle">
                      {t("Applied {when}", { when: fmt.relative(new Date(application.createdAt)) })}
                    </p>
                  </div>
                </div>

                <div className="shrink-0 text-end">
                  <p
                    className={cn(
                      "font-display text-2xl font-semibold tabular",
                      application.score >= 70
                        ? "text-[var(--success)]"
                        : application.score >= 45
                          ? "text-fg"
                          : "text-[var(--warning)]",
                    )}
                  >
                    {application.score}
                  </p>
                  <p className="text-xs text-fg-subtle">{t("fit score")}</p>
                </div>
              </div>

              {application.reasons.length > 0 && (
                <ul className="mt-4 flex flex-wrap gap-1.5">
                  {application.reasons.map((reason) => (
                    <li key={reason.label}>
                      <Badge tone={reason.positive ? "success" : "warning"} size="sm">
                        {reason.positive ? (
                          <ThumbsUp className="me-1 size-3" aria-hidden />
                        ) : (
                          <ThumbsDown className="me-1 size-3" aria-hidden />
                        )}
                        {t(reason.label)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}

              <dl className="mt-4 grid gap-x-6 sm:grid-cols-2">
                <DataRow
                  label={
                    <span className="flex items-center gap-1.5">
                      <Home className="size-3.5" aria-hidden />
                      {t("Home")}
                    </span>
                  }
                  value={
                    <>
                      {application.homeType?.toLowerCase() ?? "—"}
                      {application.hasYard ? ` · ${t("has a yard")}` : ""}
                    </>
                  }
                />
                <DataRow
                  label={
                    <span className="flex items-center gap-1.5">
                      <Clock className="size-3.5" aria-hidden />
                      {t("Alone each day")}
                    </span>
                  }
                  value={
                    application.hoursAloneDaily != null
                      ? `${application.hoursAloneDaily} hours`
                      : "—"
                  }
                />
                <DataRow
                  label={
                    <span className="flex items-center gap-1.5">
                      <PawPrint className="size-3.5" aria-hidden />
                      {t("Other pets")}
                    </span>
                  }
                  value={application.hasOtherPets ? (application.otherPetsInfo ?? "Yes") : "None"}
                />
                <DataRow
                  label={
                    <span className="flex items-center gap-1.5">
                      <Users className="size-3.5" aria-hidden />
                      {t("Children")}
                    </span>
                  }
                  value={application.hasChildren ? (application.childrenAges ?? "Yes") : "None"}
                />
                <DataRow
                  label={t("Experience")}
                  value={application.experienceLevel?.replaceAll("_", " ").toLowerCase() ?? "—"}
                />
              </dl>

              {application.motivation && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                    {t("Why they want {name}", { name: petName })}
                  </p>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">
                    {application.motivation}
                  </p>
                </div>
              )}

              {application.previousPets && (
                <div className="mt-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                    {t("Previous pets")}
                  </p>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">
                    {application.previousPets}
                  </p>
                </div>
              )}

              {application.decisionNote && (
                <p className="mt-4 rounded-[var(--radius-field)] bg-bg-sunken px-3.5 py-2.5 text-sm leading-relaxed text-fg-muted">
                  <span className="font-medium text-fg">{t("Your note:")} </span>
                  {application.decisionNote}
                </p>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                {application.conversationId && (
                  <ButtonLink
                    href={`/messages/${application.conversationId}`}
                    size="sm"
                    variant="outline"
                  >
                    <MessageSquare className="size-4" aria-hidden />
                    {t("Message")}
                  </ButtonLink>
                )}

                {!decided && !open && (
                  <>
                    <Button size="sm" onClick={() => setDeciding(application.id)}>
                      {t("Decide")}
                    </Button>
                    {application.status === "SUBMITTED" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={busy === `IN_REVIEW:${application.id}`}
                        onClick={() => decide(application.id, "IN_REVIEW")}
                      >
                        {t("Mark as reading")}
                      </Button>
                    )}
                  </>
                )}
              </div>

              {open && (
                <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
                  <Field
                    label={t("Note to the applicant")}
                    hint={t("They see this. A real reason is worth writing — people apply to several and a template teaches them nothing.")}
                  >
                    {({ id, invalid }) => (
                      <Textarea
                        id={id}
                        invalid={invalid}
                        rows={3}
                        maxLength={1000}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                    )}
                  </Field>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      loading={busy === `APPROVED:${application.id}`}
                      onClick={() => decide(application.id, "APPROVED")}
                    >
                      {t("Approve")}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      loading={busy === `REJECTED:${application.id}`}
                      onClick={() => decide(application.id, "REJECTED")}
                    >
                      {t("Decline")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeciding(null)}>
                      {t("Cancel")}
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
