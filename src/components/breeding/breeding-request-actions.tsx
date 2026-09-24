"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, FileSignature, CreditCard, ClipboardCheck, ShieldAlert, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/components/i18n/i18n-provider";
import { api, ApiError } from "@/lib/api-client";
import { parseMoneyToCents } from "@/lib/money";
import { goToPayment } from "@/lib/payment-redirect";
import { PLATFORM_CURRENCY } from "@/lib/currency";
import { BREEDING_FEE_TYPE, type BreedingFeeType } from "@/lib/constants";

export interface BreedingRequestView {
  id: string;
  status: string;
  isIncoming: boolean;
  iAgreed: boolean;
  hasTerms: boolean;
  feeStatus: string;
  feeCents: number;
  feeType: string;
  termsText: string | null;
  locationNote: string | null;
  iPayFee: boolean;
  feeReleaseAt: string | null;
  /** Hours the payer has to object after the stud's owner records the breeding. */
  reviewHours: number;
}

/**
 * Every step of a breeding request an owner can take from its page: answer
 * it, propose and agree terms, pay the stud fee into escrow, record how it went
 * and, for the payer, release the fee early or report a problem.
 *
 * The buttons shown follow the state the server returned; the server checks
 * every one of them again, so a stale page can only produce a clear refusal.
 */
export function BreedingRequestActions({ request }: { request: BreedingRequestView }) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "terms" | "outcome" | "report">(null);

  async function post<T>(key: string, body: Record<string, unknown>): Promise<T | null> {
    setBusy(key);
    try {
      return await api.post<T>("/api/breeding", { requestId: request.id, ...body });
    } catch (err) {
      toast.error(t("That did not work"), err instanceof ApiError ? err.message : t("Please try again."));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function respond(accept: boolean) {
    if (await post("respond", { action: "respond", accept })) {
      toast.success(accept ? t("Request accepted") : t("Request declined"));
      router.refresh();
    }
  }

  async function agree() {
    const result = await post<{ bothAgreed: boolean; feeDue: boolean }>("agree", { action: "agree" });
    if (!result) return;
    toast.success(
      result.bothAgreed ? t("Terms agreed by both owners") : t("You have agreed"),
      result.feeDue
        ? t("The stud fee is now due through PetMate.")
        : result.bothAgreed
          ? t("You can now arrange the date.")
          : t("Waiting for the other owner."),
    );
    router.refresh();
  }

  async function pay() {
    const result = await post<{ payment: { id: string; redirectUrl: string | null } }>("pay", { action: "pay-fee" });
    if (result) goToPayment(result.payment.redirectUrl ?? `/checkout/${result.payment.id}`, router.push);
  }

  async function release() {
    if (await post("release", { action: "release-fee" })) {
      toast.success(t("Stud fee released"), t("Thank you for confirming."));
      router.refresh();
    }
  }

  const open = ["AGREED", "SCHEDULED"].includes(request.status);
  const canRespond = request.isIncoming && request.status === "PENDING";
  const canPropose = ["ACCEPTED", "TERMS_PROPOSED"].includes(request.status);
  const canAgree = request.status === "TERMS_PROPOSED" && request.hasTerms && !request.iAgreed;
  const canPay = open && request.iPayFee && request.feeStatus === "DUE";
  const canRecord = open && request.feeStatus !== "FROZEN";
  const canRelease = request.status === "COMPLETED" && request.iPayFee && request.feeStatus === "HELD";
  const canReport = request.iPayFee && request.feeStatus === "HELD";

  if (!canRespond && !canPropose && !canAgree && !canPay && !canRecord && !canRelease && !canReport) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {canRespond && (
        <>
          <Button onClick={() => void respond(true)} loading={busy === "respond"}>
            <Check className="size-4" aria-hidden />
            {t("Accept")}
          </Button>
          <Button variant="outline" onClick={() => void respond(false)} disabled={busy !== null}>
            <X className="size-4" aria-hidden />
            {t("Decline")}
          </Button>
        </>
      )}

      {canPay && (
        <Button onClick={() => void pay()} loading={busy === "pay"}>
          <CreditCard className="size-4" aria-hidden />
          {t("Pay the stud fee")}
        </Button>
      )}

      {canAgree && (
        <Button onClick={() => void agree()} loading={busy === "agree"}>
          <Check className="size-4" aria-hidden />
          {t("Agree to terms")}
        </Button>
      )}

      {canPropose && (
        <Button variant={canAgree ? "outline" : "primary"} onClick={() => setModal("terms")}>
          <FileSignature className="size-4" aria-hidden />
          {request.hasTerms ? t("Propose different terms") : t("Propose terms")}
        </Button>
      )}

      {canRelease && (
        <Button onClick={() => void release()} loading={busy === "release"}>
          <Wallet className="size-4" aria-hidden />
          {t("Confirm and release the fee")}
        </Button>
      )}

      {canRecord && (
        <Button variant="outline" onClick={() => setModal("outcome")}>
          <ClipboardCheck className="size-4" aria-hidden />
          {t("Record the outcome")}
        </Button>
      )}

      {canReport && (
        <Button variant="ghost" onClick={() => setModal("report")}>
          <ShieldAlert className="size-4" aria-hidden />
          {t("Report a problem")}
        </Button>
      )}

      <TermsModal open={modal === "terms"} onClose={() => setModal(null)} request={request} />
      <OutcomeModal open={modal === "outcome"} onClose={() => setModal(null)} request={request} />
      <ReportModal open={modal === "report"} onClose={() => setModal(null)} requestId={request.id} />
    </div>
  );
}

function useSubmit(requestId: string, onDone: () => void) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(body: Record<string, unknown>, success: string) {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/breeding", { requestId, ...body });
      onDone();
      router.refresh();
      return success;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Please try again."));
      return null;
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, setError, submit };
}

/** A date input's value as the start of that day in the viewer's time zone. */
function dateInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function TermsModal({ open, onClose, request }: { open: boolean; onClose: () => void; request: BreedingRequestView }) {
  const { t } = useI18n();
  const toast = useToast();
  const { busy, error, setError, submit } = useSubmit(request.id, onClose);
  const [feeType, setFeeType] = useState<BreedingFeeType>(
    (BREEDING_FEE_TYPE as readonly string[]).includes(request.feeType) ? (request.feeType as BreedingFeeType) : "FEE",
  );
  const [fee, setFee] = useState(request.feeCents ? String(request.feeCents / 100) : "");
  const [terms, setTerms] = useState(request.termsText ?? "");
  const [date, setDate] = useState("");
  const [location, setLocation] = useState(request.locationNote ?? "");

  const feeLabel: Record<BreedingFeeType, string> = {
    FEE: t("Stud fee"),
    PICK_OF_LITTER: t("Pick of the litter"),
    SPLIT: t("Split the litter"),
    FREE: t("No fee"),
  };

  async function save() {
    const feeCents = feeType === "FEE" ? parseMoneyToCents(fee) : 0;
    if (feeType === "FEE" && (feeCents == null || feeCents <= 0)) {
      setError(t("Enter the stud fee, or choose a different arrangement."));
      return;
    }
    const done = await submit(
      {
        action: "propose-terms",
        terms: {
          feeCents: feeCents ?? 0,
          currency: PLATFORM_CURRENCY,
          feeType,
          termsText: terms,
          scheduledAt: dateInputToIso(date),
          locationNote: location || undefined,
        },
      },
      t("Terms sent"),
    );
    if (done) toast.success(done, t("The other owner has been asked to agree."));
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("Propose terms")}
      description={t("Both owners must agree before anything is scheduled. Changing the terms resets both agreements.")}
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        <Field label={t("Arrangement")}>
          {({ id }) => (
            <Select id={id} value={feeType} onChange={(e) => setFeeType(e.target.value as BreedingFeeType)}>
              {BREEDING_FEE_TYPE.map((type) => (
                <option key={type} value={type}>
                  {feeLabel[type]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {feeType === "FEE" && (
          <Field
            label={t("Stud fee")}
            hint={t("Paid by the female's owner into escrow through PetMate, and released to the stud's owner after the breeding.")}
          >
            {({ id }) => (
              <Input
                id={id}
                inputMode="decimal"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                leading={<span className="text-sm">{PLATFORM_CURRENCY}</span>}
                placeholder="0.00"
              />
            )}
          </Field>
        )}

        <Field label={t("Terms")} required trailing={`${terms.length}/3000`} hint={t("What happens if it does not take, who keeps which puppies or kittens, health checks before the mating.")}>
          {({ id }) => (
            <Textarea id={id} rows={5} maxLength={3000} value={terms} onChange={(e) => setTerms(e.target.value)} />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Date (optional)")}>
            {({ id }) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
          </Field>
          <Field label={t("Where (optional)")}>
            {({ id }) => <Input id={id} maxLength={200} value={location} onChange={(e) => setLocation(e.target.value)} />}
          </Field>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={terms.trim().length < 20}>
            {t("Send terms")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function OutcomeModal({ open, onClose, request }: { open: boolean; onClose: () => void; request: BreedingRequestView }) {
  const { t } = useI18n();
  const toast = useToast();
  const { busy, error, submit } = useSubmit(request.id, onClose);
  const [outcome, setOutcome] = useState<"SUCCESSFUL" | "UNSUCCESSFUL" | "CANCELLED">("SUCCESSFUL");
  const [expected, setExpected] = useState("");
  const [notes, setNotes] = useState("");

  const feeUnpaid = request.feeStatus === "DUE";
  const feeHeld = request.feeStatus === "HELD";

  const explanation =
    outcome === "CANCELLED"
      ? feeHeld
        ? t("The stud fee is refunded in full to the owner who paid it.")
        : t("The breeding is closed and nothing is charged.")
      : feeHeld
        ? request.iPayFee
          ? t("Recording it yourself releases the stud fee to the other owner now.")
          : t.plural(request.reviewHours, {
              one: "The other owner has {count} hour to confirm or report a problem, then the fee is paid to you automatically.",
              other: "The other owner has {count} hours to confirm or report a problem, then the fee is paid to you automatically.",
            })
        : null;

  async function save() {
    const done = await submit(
      {
        action: "outcome",
        outcome,
        expectedAt: outcome === "SUCCESSFUL" ? dateInputToIso(expected) : undefined,
        notes: notes || undefined,
      },
      outcome === "CANCELLED" ? t("Breeding cancelled") : t("Outcome recorded"),
    );
    if (done) toast.success(done);
  }

  return (
    <Modal open={open} onClose={onClose} title={t("Record the outcome")} size="sm">
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {feeUnpaid && outcome !== "CANCELLED" && (
          <Alert tone="warning">{t("The agreed stud fee has to be paid through PetMate before the breeding is recorded.")}</Alert>
        )}

        <Field label={t("How did it go?")}>
          {({ id }) => (
            <Select id={id} value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
              <option value="SUCCESSFUL">{t("Successful: a litter is expected")}</option>
              <option value="UNSUCCESSFUL">{t("It happened but did not take")}</option>
              <option value="CANCELLED">{t("Called off: it did not happen")}</option>
            </Select>
          )}
        </Field>

        {outcome === "SUCCESSFUL" && (
          <Field label={t("Expected litter date (optional)")}>
            {({ id }) => <Input id={id} type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />}
          </Field>
        )}

        <Field label={t("Notes (optional)")}>
          {({ id }) => <Textarea id={id} rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>

        {explanation && <p className="text-sm text-fg-muted">{explanation}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={feeUnpaid && outcome !== "CANCELLED"}>
            {t("Save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ReportModal({ open, onClose, requestId }: { open: boolean; onClose: () => void; requestId: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const { busy, error, submit } = useSubmit(requestId, onClose);
  const [details, setDetails] = useState("");

  async function save() {
    const done = await submit({ action: "report-fee", details }, t("Problem reported"));
    if (done) toast.success(done, t("The fee is on hold. Our team will contact you both."));
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("Report a problem")}
      description={t("The stud fee stays on hold, and is not paid to anyone, until our team has reviewed what happened.")}
      size="sm"
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label={t("What went wrong?")} required trailing={`${details.length}/2000`}>
          {({ id }) => <Textarea id={id} rows={5} maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} />}
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button variant="danger" onClick={() => void save()} loading={busy} disabled={details.trim().length < 20}>
            {t("Report and hold the fee")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
