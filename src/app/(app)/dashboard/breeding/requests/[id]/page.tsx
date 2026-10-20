import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { MessageSquare, ShieldCheck, Clock, Undo2, AlertTriangle, Wallet } from "lucide-react";
import { requireAuth } from "@/lib/auth/rbac";
import { getBreedingRequest } from "@/lib/services/breeding.service";
import { feeReviewHours } from "@/lib/services/breeding-fee.service";
import { isAppError } from "@/lib/errors";
import { getI18n } from "@/lib/i18n/server";
import { PageHeader, Breadcrumbs, Card, CardHeader, Alert, StatusPill, Badge, DataRow } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { BreedingRequestActions } from "@/components/breeding/breeding-request-actions";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("Breeding request"), robots: { index: false, follow: false } };
}

const STATUS_TONE: Record<string, "info" | "warning" | "success" | "danger" | "neutral"> = {
  PENDING: "warning",
  ACCEPTED: "info",
  TERMS_PROPOSED: "info",
  AGREED: "success",
  SCHEDULED: "success",
  COMPLETED: "success",
  DECLINED: "neutral",
  WITHDRAWN: "neutral",
  CANCELLED: "neutral",
};

export default async function BreedingRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [auth, { t, fmt }] = await Promise.all([requireAuth(), getI18n()]);

  const [request, reviewHours] = await Promise.all([
    getBreedingRequest(auth, id).catch((error) => {
      if (isAppError(error) && error.code === "NOT_FOUND") notFound();
      throw error;
    }),
    feeReviewHours(),
  ]);

  const statusLabel: Record<string, string> = {
    PENDING: t("Waiting for a reply"),
    ACCEPTED: t("Accepted · agree the terms"),
    TERMS_PROPOSED: t("Terms proposed"),
    AGREED: t("Terms agreed"),
    SCHEDULED: t("Scheduled"),
    COMPLETED: t("Completed"),
    DECLINED: t("Declined"),
    WITHDRAWN: t("Withdrawn"),
    CANCELLED: t("Cancelled"),
  };
  const feeTypeLabel: Record<string, string> = {
    FEE: t("Stud fee"),
    PICK_OF_LITTER: t("Pick of the litter"),
    SPLIT: t("Split the litter"),
    FREE: t("No fee"),
  };
  const outcomeLabel: Record<string, string> = {
    SUCCESSFUL: t("Successful"),
    UNSUCCESSFUL: t("Did not take"),
    CANCELLED: t("Called off"),
  };

  const fee = fmt.money(request.feeCents, request.currency);
  const payout = fmt.money(request.payoutCents, request.currency);
  const commission = fmt.money(request.commissionCents, request.currency);
  const paidArrangement = request.feeType === "FEE" && request.feeCents > 0;
  const hasTerms = Boolean(request.termsText);

  const feeNotice = (() => {
    switch (request.feeStatus) {
      case "DUE":
        return request.iPayFee
          ? { tone: "warning" as const, icon: Wallet, title: t("Pay the stud fee to confirm"), body: t("{amount} is held by PetMate until the breeding is recorded, and refunded if it is cancelled.", { amount: fee }) }
          : { tone: "info" as const, icon: Clock, title: t("Waiting for the stud fee"), body: t("The other owner has been asked to pay {amount} into escrow. You will be told when it arrives.", { amount: fee }) };
      case "HELD":
        if (request.feeReleaseAt) {
          return request.iPayFee
            ? { tone: "warning" as const, icon: Clock, title: t("Confirm the breeding to release the stud fee"), body: t("The fee is paid to the other owner automatically on {date} unless you report a problem.", { date: fmt.dateTime(request.feeReleaseAt) }) }
            : { tone: "info" as const, icon: Clock, title: t("Stud fee releasing"), body: t("{amount} is paid to your wallet on {date}, unless the other owner reports a problem.", { amount: payout, date: fmt.dateTime(request.feeReleaseAt) }) };
        }
        return { tone: "success" as const, icon: ShieldCheck, title: t("Stud fee held securely"), body: request.iPayFee ? t("The other owner is paid only after the breeding is recorded. If it is cancelled, you get it back.") : t("{amount} is held by PetMate and is paid to you once the breeding is recorded.", { amount: payout }) };
      case "FROZEN":
        return { tone: "danger" as const, icon: AlertTriangle, title: t("The stud fee is on hold"), body: t("A problem was reported with this breeding. Our team will review it and contact you both.") };
      case "RELEASED":
        return { tone: "success" as const, icon: Wallet, title: t("Stud fee paid out"), body: request.iReceiveFee ? t("{amount} was added to your wallet.", { amount: payout }) : t("The stud fee has been paid to the other owner.") };
      case "REFUNDED":
        return { tone: "info" as const, icon: Undo2, title: t("Stud fee refunded"), body: t("{amount} was returned to the card or wallet it was paid with.", { amount: fee }) };
      case "REFUND_PENDING":
        return { tone: "warning" as const, icon: Undo2, title: t("Refund in progress"), body: t("The refund is being processed by our team.") };
      default:
        return null;
    }
  })();

  const pets = [request.myPet, request.theirPet];

  return (
    <div className="container-page max-w-3xl py-8 lg:py-10">
      <Breadcrumbs items={[{ label: t("Breeding"), href: "/dashboard/breeding" }, { label: `${request.myPet.name} × ${request.theirPet.name}` }]} />

      <PageHeader
        title={`${request.myPet.name} × ${request.theirPet.name}`}
        description={
          request.isIncoming
            ? t("Request from {name}", { name: request.counterparty.name })
            : t("Request to {name}", { name: request.counterparty.name })
        }
        action={<StatusPill tone={STATUS_TONE[request.status] ?? "neutral"}>{statusLabel[request.status] ?? request.status}</StatusPill>}
      />

      {feeNotice && (
        <Alert tone={feeNotice.tone} className="mt-6" icon={<feeNotice.icon className="size-4" aria-hidden />} title={feeNotice.title}>
          {feeNotice.body}
        </Alert>
      )}

      <div className="mt-6">
        <BreedingRequestActions
          request={{
            id: request.id,
            status: request.status,
            isIncoming: request.isIncoming,
            iAgreed: request.iAgreed,
            hasTerms,
            feeStatus: request.feeStatus,
            feeCents: request.feeCents,
            feeType: request.feeType,
            termsText: request.termsText,
            locationNote: request.locationNote,
            iPayFee: request.iPayFee,
            feeReleaseAt: request.feeReleaseAt?.toISOString() ?? null,
            reviewHours,
          }}
        />
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {pets.map((pet, i) => (
          <Card key={pet.id} className="flex items-center gap-4 p-4">
            <span className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-bg-sunken">
              {pet.photos[0] && <Image src={pet.photos[0].url} alt="" fill sizes="64px" className="object-cover" />}
            </span>
            <div className="min-w-0">
              <p className="text-xs text-fg-subtle">{i === 0 ? t("Your pet") : t("Their pet")}</p>
              <p className="truncate font-semibold text-fg">{pet.name}</p>
              <p className="truncate text-sm text-fg-muted">
                {pet.sex === "MALE" ? t("Male") : t("Female")}
                {pet.breed?.name ? ` · ${pet.breed.name}` : ""}
              </p>
            </div>
          </Card>
        ))}
      </div>

      <Card className="mt-4">
        <CardHeader
          title={t("Terms")}
          description={
            hasTerms ? (
              <span className="inline-flex flex-wrap gap-2">
                <Badge tone={request.iAgreed ? "success" : "neutral"} size="sm">
                  {request.iAgreed ? t("You agreed") : t("You have not agreed")}
                </Badge>
                <Badge tone={request.theyAgreed ? "success" : "neutral"} size="sm">
                  {request.theyAgreed ? t("They agreed") : t("They have not agreed")}
                </Badge>
              </span>
            ) : undefined
          }
        />
        <div className="px-5 pb-5">
          <dl className="divide-y divide-[var(--border)]">
            <DataRow label={t("Arrangement")} value={feeTypeLabel[request.feeType] ?? request.feeType} />
            {paidArrangement && <DataRow label={t("Stud fee")} value={<span className="font-semibold">{fee}</span>} />}
            {paidArrangement && request.iReceiveFee && request.feeStatus !== "NONE" && (
              <DataRow label={t("You receive, after {commission} commission", { commission })} value={payout} />
            )}
            {request.compatibilityScore != null && <DataRow label={t("Compatibility")} value={`${request.compatibilityScore}/100`} />}
            {request.scheduledAt && <DataRow label={t("Date")} value={fmt.date(request.scheduledAt, "long")} />}
            {request.locationNote && <DataRow label={t("Where")} value={request.locationNote} />}
            {request.outcome && <DataRow label={t("Outcome")} value={outcomeLabel[request.outcome] ?? request.outcome} />}
          </dl>
          {hasTerms ? (
            <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-fg">{request.termsText}</p>
          ) : (
            <p className="mt-4 text-sm text-fg-muted">
              {request.status === "PENDING"
                ? t("Terms are agreed once the request has been accepted.")
                : t("No terms proposed yet. Either owner can propose them.")}
            </p>
          )}
          {paidArrangement && request.feeStatus === "NONE" && ["ACCEPTED", "TERMS_PROPOSED"].includes(request.status) && (
            <p className="mt-4 text-xs text-fg-subtle">
              {t("Once both owners agree, the female's owner pays the stud fee into escrow through PetMate. It is paid to the stud's owner after the breeding, or refunded if it is called off.")}
            </p>
          )}
        </div>
      </Card>

      {request.message && (
        <Card className="mt-4 p-5">
          <p className="text-xs font-medium text-fg-subtle">{t("Message")}</p>
          <p className="mt-2 whitespace-pre-line text-sm text-fg">{request.message}</p>
        </Card>
      )}

      {request.conversationId && (
        <div className="mt-6">
          <ButtonLink href={`/messages/${request.conversationId}`} variant="outline">
            <MessageSquare className="size-4" aria-hidden />
            {t("Open conversation")}
          </ButtonLink>
        </div>
      )}
    </div>
  );
}
