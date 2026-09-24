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
import { formatDate, relativeTime, cn } from "@/lib/utils";

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
        "That did not go through",
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
        title="No applications yet"
        description="Applications appear here as they arrive, already scored against the answers given. Nothing is auto-rejected."
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
                          aria-label="Email confirmed"
                        />
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-fg-subtle">
                      {[application.applicant.city, application.applicant.country]
                        .filter(Boolean)
                        .join(", ") || "Location not given"}{" "}
                      · trust {application.applicant.trustScore} ·{" "}
                      {application.applicant.petCount} pets on PetMate · member since{" "}
                      {formatDate(application.applicant.memberSince)}
                    </p>
                    <p className="mt-0.5 text-xs text-fg-subtle">
                      Applied {relativeTime(new Date(application.createdAt))}
                    </p>
                  </div>
                </div>

                <div className="shrink-0 text-right">
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
                  <p className="text-xs text-fg-subtle">fit score</p>
                </div>
              </div>

              {application.reasons.length > 0 && (
                <ul className="mt-4 flex flex-wrap gap-1.5">
                  {application.reasons.map((reason) => (
                    <li key={reason.label}>
                      <Badge tone={reason.positive ? "success" : "warning"} size="sm">
                        {reason.positive ? (
                          <ThumbsUp className="mr-1 size-3" aria-hidden />
                        ) : (
                          <ThumbsDown className="mr-1 size-3" aria-hidden />
                        )}
                        {reason.label}
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
                      Home
                    </span>
                  }
                  value={
                    <>
                      {application.homeType?.toLowerCase() ?? "—"}
                      {application.hasYard ? " · has a yard" : ""}
                    </>
                  }
                />
                <DataRow
                  label={
                    <span className="flex items-center gap-1.5">
                      <Clock className="size-3.5" aria-hidden />
                      Alone each day
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
                      Other pets
                    </span>
                  }
                  value={application.hasOtherPets ? (application.otherPetsInfo ?? "Yes") : "None"}
                />
                <DataRow
                  label={
                    <span className="flex items-center gap-1.5">
                      <Users className="size-3.5" aria-hidden />
                      Children
                    </span>
                  }
                  value={application.hasChildren ? (application.childrenAges ?? "Yes") : "None"}
                />
                <DataRow
                  label="Experience"
                  value={application.experienceLevel?.replaceAll("_", " ").toLowerCase() ?? "—"}
                />
              </dl>

              {application.motivation && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                    Why they want {petName}
                  </p>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">
                    {application.motivation}
                  </p>
                </div>
              )}

              {application.previousPets && (
                <div className="mt-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                    Previous pets
                  </p>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">
                    {application.previousPets}
                  </p>
                </div>
              )}

              {application.decisionNote && (
                <p className="mt-4 rounded-[var(--radius-field)] bg-bg-sunken px-3.5 py-2.5 text-sm leading-relaxed text-fg-muted">
                  <span className="font-medium text-fg">Your note: </span>
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
                    Message
                  </ButtonLink>
                )}

                {!decided && !open && (
                  <>
                    <Button size="sm" onClick={() => setDeciding(application.id)}>
                      Decide
                    </Button>
                    {application.status === "SUBMITTED" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={busy === `IN_REVIEW:${application.id}`}
                        onClick={() => decide(application.id, "IN_REVIEW")}
                      >
                        Mark as reading
                      </Button>
                    )}
                  </>
                )}
              </div>

              {open && (
                <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
                  <Field
                    label="Note to the applicant"
                    hint="They see this. A real reason is worth writing — people apply to several and a template teaches them nothing."
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
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      loading={busy === `REJECTED:${application.id}`}
                      onClick={() => decide(application.id, "REJECTED")}
                    >
                      Decline
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeciding(null)}>
                      Cancel
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
