"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ShieldAlert,
  Tag,
  BadgeCheck,
  Scale,
  Activity,
  CheckCircle2,
  XCircle,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, Badge, EmptyState, Alert } from "@/components/ui/primitives";
import { Field, Textarea, Select, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";
import { formatDate, relativeTime, cn } from "@/lib/utils";
import { REPORT_REASON_LABEL, DISPUTE_REASON_LABEL } from "@/lib/constants";

export interface ReportRow {
  id: string;
  entityType: string;
  entityId: string;
  reason: string;
  details: string | null;
  priority: string;
  createdAt: string;
  reporter: { name: string; handle: string; trustScore: number };
}

export interface ListingRow {
  id: string;
  title: string;
  slug: string;
  description: string;
  priceCents: number;
  currency: string;
  intent: string;
  riskScore: number;
  riskFlags: string[];
  createdAt: string;
  sellerName: string;
  sellerHandle: string;
  sellerTrust: number;
  sellerJoined: string;
  /** Decided on the server so render stays pure. */
  sellerIsNew: boolean;
  petName: string;
  petSpecies: string;
  petHealthScore: number;
  petVerification: string;
  photoUrl: string | null;
}

export interface VerificationRow {
  id: string;
  subjectType: string;
  subjectId: string;
  type: string;
  notes: string | null;
  documentCount: number;
  createdAt: string;
  userName: string;
  userHandle: string;
  userTrust: number;
}

export interface DisputeRow {
  id: string;
  reference: string;
  reason: string;
  status: string;
  details: string;
  amountCents: number;
  currency: string;
  createdAt: string;
  responseDueAt: string | null;
  raisedByName: string;
  againstName: string;
  subject: string;
  messageCount: number;
}

export interface RiskRow {
  id: string;
  type: string;
  score: number;
  entityType: string | null;
  entityId: string | null;
  details: string | null;
  createdAt: string;
  userName: string | null;
  userHandle: string | null;
}

type Tab = "reports" | "listings" | "verifications" | "disputes" | "risk";

export function ModerationQueues({
  initialTab,
  reports,
  listings,
  verifications,
  disputes,
  risks,
}: {
  initialTab: string;
  reports: ReportRow[];
  listings: ListingRow[];
  verifications: VerificationRow[];
  disputes: DisputeRow[];
  risks: RiskRow[];
}) {
  const [tab, setTab] = useState<Tab>(
    (["reports", "listings", "verifications", "disputes", "risk"].includes(initialTab)
      ? initialTab
      : "reports") as Tab,
  );

  const tabs = [
    { id: "reports" as const, label: "Reports", count: reports.length, icon: ShieldAlert },
    { id: "listings" as const, label: "Listings", count: listings.length, icon: Tag },
    {
      id: "verifications" as const,
      label: "Verifications",
      count: verifications.length,
      icon: BadgeCheck,
    },
    { id: "disputes" as const, label: "Disputes", count: disputes.length, icon: Scale },
    { id: "risk" as const, label: "Risk", count: risks.length, icon: Activity },
  ];

  return (
    <div>
      <div role="tablist" aria-label="Moderation queues" className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
              tab === t.id
                ? "border-transparent bg-brand text-brand-fg"
                : "border-[var(--border)] text-fg-muted hover:border-[var(--border-strong)] hover:text-fg",
            )}
          >
            <t.icon className="size-4" aria-hidden />
            {t.label}
            <span className="tabular">{t.count}</span>
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === "reports" && <ReportQueue rows={reports} />}
        {tab === "listings" && <ListingQueue rows={listings} />}
        {tab === "verifications" && <VerificationQueue rows={verifications} />}
        {tab === "disputes" && <DisputeQueue rows={disputes} />}
        {tab === "risk" && <RiskQueue rows={risks} />}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function useAction() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, body: unknown, successTitle: string, successBody?: string) {
    setBusy(key);
    try {
      await api.post("/api/admin", body);
      toast.success(successTitle, successBody);
      router.refresh();
      return true;
    } catch (err) {
      toast.error(
        "That did not go through",
        err instanceof ApiError ? err.message : "Please try again.",
      );
      return false;
    } finally {
      setBusy(null);
    }
  }

  return { busy, run };
}

function ReportQueue({ rows }: { rows: ReportRow[] }) {
  const { busy, run } = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const [resolution, setResolution] = useState("");
  const [enforcement, setEnforcement] = useState("NONE");

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ShieldAlert className="size-5" aria-hidden />}
        title="No open reports"
        description="Reports land here the moment they are filed. Animal-welfare and fraud reports arrive marked urgent."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((report) => (
        <li key={report.id}>
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    tone={
                      report.priority === "URGENT"
                        ? "danger"
                        : report.priority === "HIGH"
                          ? "warning"
                          : "neutral"
                    }
                    size="sm"
                  >
                    {report.priority.toLowerCase()}
                  </Badge>
                  <span className="text-[15px] font-medium text-fg">
                    {REPORT_REASON_LABEL[report.reason as keyof typeof REPORT_REASON_LABEL] ??
                      report.reason}
                  </span>
                  <span className="text-xs text-fg-subtle">
                    {report.entityType.toLowerCase()} · {relativeTime(new Date(report.createdAt))}
                  </span>
                </div>
                {report.details && (
                  <p className="mt-2 text-sm leading-relaxed text-fg-muted">{report.details}</p>
                )}
                <p className="mt-2 text-xs text-fg-subtle">
                  Reported by{" "}
                  <Link href={`/u/${report.reporter.handle}`} className="hover:underline">
                    {report.reporter.name}
                  </Link>{" "}
                  (trust {report.reporter.trustScore})
                </p>
                <p className="mt-1 font-mono text-xs text-fg-subtle">{report.entityId}</p>
              </div>

              {open !== report.id && (
                <Button size="sm" variant="outline" onClick={() => setOpen(report.id)}>
                  Review
                </Button>
              )}
            </div>

            {open === report.id && (
              <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
                <Field label="What did you decide, and why?" required>
                  {({ id, invalid }) => (
                    <Textarea
                      id={id}
                      invalid={invalid}
                      rows={3}
                      maxLength={1000}
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
                      placeholder="Description contained a phone number; asked the seller to edit and republish."
                    />
                  )}
                </Field>

                <Field
                  label="Enforcement"
                  hint="Suspension is for the account, removal is for the content."
                >
                  {({ id }) => (
                    <Select
                      id={id}
                      value={enforcement}
                      onChange={(e) => setEnforcement(e.target.value)}
                    >
                      <option value="NONE">No enforcement</option>
                      <option value="REMOVE">Remove the content</option>
                      <option value="SUSPEND">Suspend the account</option>
                    </Select>
                  )}
                </Field>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    loading={busy === `uphold:${report.id}`}
                    disabled={resolution.trim().length < 3}
                    onClick={async () => {
                      const ok = await run(
                        `uphold:${report.id}`,
                        {
                          action: "resolve-report",
                          reportId: report.id,
                          status: "UPHELD",
                          resolution,
                          enforcement,
                        },
                        "Report upheld",
                      );
                      if (ok) {
                        setOpen(null);
                        setResolution("");
                        setEnforcement("NONE");
                      }
                    }}
                  >
                    <CheckCircle2 className="size-4" aria-hidden />
                    Uphold
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={busy === `dismiss:${report.id}`}
                    disabled={resolution.trim().length < 3}
                    onClick={async () => {
                      const ok = await run(
                        `dismiss:${report.id}`,
                        {
                          action: "resolve-report",
                          reportId: report.id,
                          status: "DISMISSED",
                          resolution,
                          enforcement: "NONE",
                        },
                        "Report dismissed",
                      );
                      if (ok) {
                        setOpen(null);
                        setResolution("");
                      }
                    }}
                  >
                    <XCircle className="size-4" aria-hidden />
                    Dismiss
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </li>
      ))}
    </ul>
  );
}

function ListingQueue({ rows }: { rows: ListingRow[] }) {
  const { busy, run } = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Tag className="size-5" aria-hidden />}
        title="Nothing waiting for review"
        description="Listings arrive here when the risk score crosses the threshold or the value is above the review limit."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((listing) => {
        // Computed on the server: "is this seller new" depends on the clock,
        // and render must not.
        const newAccount = listing.sellerIsNew;

        return (
          <li key={listing.id}>
            <Card className="p-5">
              <div className="flex gap-4">
                {listing.photoUrl ? (
                  <Image
                    src={listing.photoUrl}
                    alt=""
                    width={80}
                    height={80}
                    className="size-20 shrink-0 rounded-xl object-cover"
                  />
                ) : (
                  <span className="flex size-20 shrink-0 items-center justify-center rounded-xl bg-bg-sunken text-fg-subtle">
                    <Tag className="size-6" aria-hidden />
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[15px] font-semibold text-fg">{listing.title}</h3>
                    <Badge
                      tone={
                        listing.riskScore >= 70
                          ? "danger"
                          : listing.riskScore >= 40
                            ? "warning"
                            : "neutral"
                      }
                      size="sm"
                    >
                      risk {listing.riskScore}
                    </Badge>
                    {newAccount && (
                      <Badge tone="warning" size="sm">
                        New account
                      </Badge>
                    )}
                  </div>

                  <p className="mt-1 text-sm text-fg-muted">
                    {formatMoney(listing.priceCents, listing.currency)} ·{" "}
                    {listing.intent.toLowerCase()} · {listing.petName} (
                    {listing.petSpecies.toLowerCase()}) · health {listing.petHealthScore}
                  </p>

                  <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-fg-muted">
                    {listing.description}
                  </p>

                  {listing.riskFlags.length > 0 && (
                    <Alert
                      tone="warning"
                      className="mt-3"
                      icon={<AlertTriangle className="size-4" aria-hidden />}
                    >
                      <ul className="mt-0.5 list-disc space-y-0.5 ps-4">
                        {listing.riskFlags.map((flag) => (
                          <li key={flag}>{flag}</li>
                        ))}
                      </ul>
                    </Alert>
                  )}

                  <p className="mt-2 text-xs text-fg-subtle">
                    <Link href={`/u/${listing.sellerHandle}`} className="hover:underline">
                      {listing.sellerName}
                    </Link>{" "}
                    · trust {listing.sellerTrust} · joined{" "}
                    {formatDate(listing.sellerJoined)} · submitted{" "}
                    {relativeTime(new Date(listing.createdAt))}
                  </p>

                  <div className="mt-3">
                    <Field label="Note to the seller" hint="Required when rejecting.">
                      {({ id, invalid }) => (
                        <Input
                          id={id}
                          invalid={invalid}
                          maxLength={1000}
                          value={notes[listing.id] ?? ""}
                          onChange={(e) =>
                            setNotes((n) => ({ ...n, [listing.id]: e.target.value }))
                          }
                          placeholder="Remove the phone number from the description and resubmit."
                        />
                      )}
                    </Field>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      loading={busy === `approve:${listing.id}`}
                      onClick={() =>
                        run(
                          `approve:${listing.id}`,
                          {
                            action: "moderate-listing",
                            listingId: listing.id,
                            decision: "APPROVE",
                            note: notes[listing.id] || undefined,
                          },
                          "Listing published",
                        )
                      }
                    >
                      <CheckCircle2 className="size-4" aria-hidden />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      loading={busy === `reject:${listing.id}`}
                      disabled={(notes[listing.id] ?? "").trim().length < 3}
                      onClick={() =>
                        run(
                          `reject:${listing.id}`,
                          {
                            action: "moderate-listing",
                            listingId: listing.id,
                            decision: "REJECT",
                            note: notes[listing.id],
                          },
                          "Listing rejected",
                        )
                      }
                    >
                      <XCircle className="size-4" aria-hidden />
                      Reject
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

function VerificationQueue({ rows }: { rows: VerificationRow[] }) {
  const { busy, run } = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<BadgeCheck className="size-5" aria-hidden />}
        title="No verifications waiting"
        description="ID, address, breeder and clinic-licence submissions queue here."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((v) => (
        <li key={v.id}>
          <Card className="p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brand" size="sm">
                {v.type.replaceAll("_", " ").toLowerCase()}
              </Badge>
              <span className="text-[15px] font-medium text-fg">{v.userName}</span>
              {v.userHandle && (
                <Link
                  href={`/u/${v.userHandle}`}
                  className="text-xs text-fg-subtle hover:underline"
                >
                  @{v.userHandle}
                  <ExternalLink className="ms-0.5 inline size-3" aria-hidden />
                </Link>
              )}
              <span className="text-xs text-fg-subtle">
                trust {v.userTrust} · {relativeTime(new Date(v.createdAt))}
              </span>
            </div>

            <p className="mt-2 text-sm text-fg-muted">
              {v.documentCount} document{v.documentCount === 1 ? "" : "s"} attached ·{" "}
              {v.subjectType.toLowerCase()} {v.subjectId}
            </p>
            {v.notes && (
              <p className="mt-2 rounded-[var(--radius-field)] bg-bg-sunken px-3.5 py-2.5 text-sm text-fg-muted">
                {v.notes}
              </p>
            )}

            <div className="mt-3">
              <Field label="Decision note" hint="The applicant sees this if you reject.">
                {({ id, invalid }) => (
                  <Input
                    id={id}
                    invalid={invalid}
                    maxLength={500}
                    value={notes[v.id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [v.id]: e.target.value }))}
                    placeholder="Document was expired — please upload a current one."
                  />
                )}
              </Field>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                loading={busy === `approve:${v.id}`}
                disabled={(notes[v.id] ?? "").trim().length < 3}
                onClick={() =>
                  run(
                    `approve:${v.id}`,
                    {
                      action: "decide-verification",
                      verificationId: v.id,
                      decision: "APPROVED",
                      note: notes[v.id],
                    },
                    "Verification approved",
                  )
                }
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="danger"
                loading={busy === `reject:${v.id}`}
                disabled={(notes[v.id] ?? "").trim().length < 3}
                onClick={() =>
                  run(
                    `reject:${v.id}`,
                    {
                      action: "decide-verification",
                      verificationId: v.id,
                      decision: "REJECTED",
                      note: notes[v.id],
                    },
                    "Verification rejected",
                  )
                }
              >
                Reject
              </Button>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function DisputeQueue({ rows }: { rows: DisputeRow[] }) {
  const { busy, run } = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("RESOLVED_BUYER");
  const [refund, setRefund] = useState("");
  const [resolution, setResolution] = useState("");

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Scale className="size-5" aria-hidden />}
        title="No open disputes"
        description="Funds stay frozen for as long as a dispute is open, so this queue matters more than its size suggests."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((d) => (
        <li key={d.id}>
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-fg-subtle">{d.reference}</span>
                  <Badge tone="warning" size="sm">
                    {d.status.replaceAll("_", " ").toLowerCase()}
                  </Badge>
                  <span className="text-[15px] font-medium text-fg">
                    {DISPUTE_REASON_LABEL[d.reason as keyof typeof DISPUTE_REASON_LABEL] ??
                      d.reason}
                  </span>
                </div>

                <p className="mt-1 text-sm text-fg-muted">
                  {d.subject} · {formatMoney(d.amountCents, d.currency)} ·{" "}
                  {d.raisedByName} vs {d.againstName}
                </p>
                <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-fg-muted">
                  {d.details}
                </p>
                <p className="mt-2 text-xs text-fg-subtle">
                  {d.messageCount} message{d.messageCount === 1 ? "" : "s"} · opened{" "}
                  {relativeTime(new Date(d.createdAt))}
                  {d.responseDueAt
                    ? ` · response due ${relativeTime(new Date(d.responseDueAt))}`
                    : ""}
                </p>
              </div>

              <div className="flex shrink-0 gap-2">
                <Link
                  href={`/dashboard/disputes/${d.id}`}
                  className="text-sm font-medium text-brand hover:underline"
                >
                  Read the thread
                </Link>
                {open !== d.id && (
                  <Button size="sm" variant="outline" onClick={() => setOpen(d.id)}>
                    Decide
                  </Button>
                )}
              </div>
            </div>

            {open === d.id && (
              <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Outcome" required>
                    {({ id }) => (
                      <Select id={id} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                        <option value="RESOLVED_BUYER">For the buyer — refund</option>
                        <option value="RESOLVED_SPLIT">Split — partial refund</option>
                        <option value="RESOLVED_SELLER">For the seller — release</option>
                      </Select>
                    )}
                  </Field>

                  <Field
                    label="Refund amount"
                    hint={`Up to ${formatMoney(d.amountCents, d.currency)}`}
                    required
                  >
                    {({ id, invalid }) => (
                      <Input
                        id={id}
                        invalid={invalid}
                        type="number"
                        step="0.01"
                        min={0}
                        max={d.amountCents / 100}
                        value={refund}
                        onChange={(e) => setRefund(e.target.value)}
                        className="tabular"
                      />
                    )}
                  </Field>
                </div>

                <Field label="Reasoning" required hint="Both parties see this.">
                  {({ id, invalid }) => (
                    <Textarea
                      id={id}
                      invalid={invalid}
                      rows={4}
                      maxLength={2000}
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
                    />
                  )}
                </Field>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    loading={busy === `resolve:${d.id}`}
                    disabled={resolution.trim().length < 10 || refund === ""}
                    onClick={async () => {
                      const ok = await run(
                        `resolve:${d.id}`,
                        {
                          action: "resolve-dispute",
                          disputeId: d.id,
                          outcome,
                          refundCents: Math.round(Number(refund) * 100),
                          resolution,
                        },
                        "Dispute resolved",
                        "The funds have moved and both parties have been told.",
                      );
                      if (ok) {
                        setOpen(null);
                        setRefund("");
                        setResolution("");
                      }
                    }}
                  >
                    Resolve
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </li>
      ))}
    </ul>
  );
}

function RiskQueue({ rows }: { rows: RiskRow[] }) {
  const { busy, run } = useAction();

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Activity className="size-5" aria-hidden />}
        title="No unhandled risk events"
        description="Events scoring 40 or above appear here. Lower scores are recorded but do not need a person."
      />
    );
  }

  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.id}>
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={r.score >= 70 ? "danger" : "warning"} size="sm">
                  {r.score}
                </Badge>
                <span className="text-sm font-medium text-fg">
                  {r.type.replaceAll("_", " ").toLowerCase()}
                </span>
                {r.userHandle && (
                  <Link
                    href={`/u/${r.userHandle}`}
                    className="text-xs text-fg-subtle hover:underline"
                  >
                    {r.userName}
                  </Link>
                )}
              </div>
              <p className="mt-0.5 font-mono text-xs text-fg-subtle">
                {r.entityType ?? "—"} {r.entityId ?? ""} · {relativeTime(new Date(r.createdAt))}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              loading={busy === `dismiss:${r.id}`}
              onClick={() =>
                run(`dismiss:${r.id}`, { action: "dismiss-risk", riskEventId: r.id }, "Marked handled")
              }
            >
              Mark handled
            </Button>
          </Card>
        </li>
      ))}
    </ul>
  );
}
