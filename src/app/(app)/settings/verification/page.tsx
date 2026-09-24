import type { Metadata } from "next";
import { BadgeCheck, Clock, XCircle } from "lucide-react";
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getTrustBreakdown } from "@/lib/services/trust.service";
import { VerificationSubmit } from "@/components/settings/verification-submit";
import { PageHeader, Card, CardHeader, Badge, Alert } from "@/components/ui/primitives";
import { TrustMeter } from "@/components/dashboard/trust-meter";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Verification",
  robots: { index: false, follow: false },
};

/** Only the types an individual submits for themselves belong on this page. */
const SELF_SERVE = [
  {
    type: "IDENTITY" as const,
    title: "Identity",
    body: "A government-issued photo ID. Unlocks higher-value listings and puts a verified badge on your profile.",
    documents: "Passport, national ID or driving licence.",
  },
  {
    type: "ADDRESS" as const,
    title: "Address",
    body: "Confirms you are where your listings say you are, which is what makes distance filtering trustworthy.",
    documents: "A utility bill or bank statement from the last three months.",
  },
  {
    type: "BREEDER" as const,
    title: "Breeder",
    body: "For licensed breeders. Adds a breeder badge and raises how far your listings reach.",
    documents: "Your breeding licence or registered kennel documentation.",
  },
];

const STATUS: Record<string, { label: string; tone: "info" | "success" | "danger" | "warning" }> = {
  PENDING: { label: "Submitted", tone: "info" },
  IN_REVIEW: { label: "Being reviewed", tone: "info" },
  APPROVED: { label: "Verified", tone: "success" },
  REJECTED: { label: "Not approved", tone: "danger" },
  EXPIRED: { label: "Expired", tone: "warning" },
};

export default async function VerificationSettingsPage() {
  const auth = await requireAuth();

  const [verifications, trust, user] = await Promise.all([
    db.verification.findMany({
      where: { subjectType: "USER", subjectId: auth.user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        type: true,
        status: true,
        rejectionReason: true,
        createdAt: true,
        reviewedAt: true,
        expiresAt: true,
      },
    }),
    getTrustBreakdown(auth.user.id),
    db.user.findUniqueOrThrow({
      where: { id: auth.user.id },
      select: { emailVerifiedAt: true, phoneVerifiedAt: true },
    }),
  ]);

  // Most recent record per type decides what the card offers.
  const latestByType = new Map<string, (typeof verifications)[number]>();
  for (const v of verifications) if (!latestByType.has(v.type)) latestByType.set(v.type, v);

  return (
    <>
      <PageHeader
        title="Verification"
        description="Verification is how a stranger decides whether to trust you with several hundred pounds and a living animal. Every badge here is checked by a person."
      />

      <div className="mt-6 space-y-5">
        <TrustMeter trust={trust} />

        <Card>
          <CardHeader title="Already confirmed" />
          <div className="flex flex-wrap gap-2 p-5">
            {user.emailVerifiedAt ? (
              <Badge tone="success" icon={<BadgeCheck className="size-3.5" aria-hidden />}>
                Email confirmed {formatDate(user.emailVerifiedAt)}
              </Badge>
            ) : (
              <Badge tone="warning">Email not confirmed</Badge>
            )}
            {user.phoneVerifiedAt && (
              <Badge tone="success" icon={<BadgeCheck className="size-3.5" aria-hidden />}>
                Phone confirmed
              </Badge>
            )}
          </div>
        </Card>

        {SELF_SERVE.map((item) => {
          const latest = latestByType.get(item.type);
          const status = latest ? STATUS[latest.status] : null;
          const canSubmit =
            !latest || latest.status === "REJECTED" || latest.status === "EXPIRED";

          return (
            <Card key={item.type}>
              <CardHeader
                title={item.title}
                description={item.body}
                action={
                  status ? (
                    <Badge tone={status.tone}>
                      {status.tone === "success" ? (
                        <BadgeCheck className="me-1 size-3.5" aria-hidden />
                      ) : status.tone === "danger" ? (
                        <XCircle className="me-1 size-3.5" aria-hidden />
                      ) : (
                        <Clock className="me-1 size-3.5" aria-hidden />
                      )}
                      {status.label}
                    </Badge>
                  ) : undefined
                }
              />
              <div className="p-5">
                {latest?.status === "REJECTED" && latest.rejectionReason && (
                  <Alert tone="danger" className="mb-4" title="Why it was not approved">
                    <p className="mt-1">{latest.rejectionReason}</p>
                  </Alert>
                )}

                {latest?.status === "APPROVED" ? (
                  <p className="text-sm text-fg-muted">
                    Verified on {formatDate(latest.reviewedAt)}
                    {latest.expiresAt ? `, valid until ${formatDate(latest.expiresAt)}` : ""}.
                  </p>
                ) : canSubmit ? (
                  <VerificationSubmit
                    type={item.type}
                    subjectId={auth.user.id}
                    documentsHint={item.documents}
                  />
                ) : (
                  <p className="text-sm text-fg-muted">
                    Submitted {formatDate(latest.createdAt)}. We review these in order and will
                    email you either way — there is nothing else for you to do.
                  </p>
                )}
              </div>
            </Card>
          );
        })}

        <Alert tone="info" title="What happens to your documents">
          <p className="mt-1 leading-relaxed">
            They are visible only to the reviewers who process them, never to other members, and
            they are not used for anything except this check. Verification is optional — you can
            use PetMate without it, with lower listing limits.
          </p>
        </Alert>
      </div>
    </>
  );
}
