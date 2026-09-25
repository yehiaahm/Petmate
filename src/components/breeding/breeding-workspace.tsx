"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Dna,
  Search,
  Settings2,
  MessageSquare,
  Check,
  X,
  ChevronDown,
  MapPin,
} from "lucide-react";
import { Card, Badge, Alert, Avatar, StatusPill, EmptyState } from "@/components/ui/primitives";
import { Button, ButtonLink } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Textarea, Checkbox, SegmentedControl } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { parseMoneyToCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { BREEDING_FEE_TYPE, BREEDING_FEE_TYPE_LABEL, type BreedingFeeType } from "@/lib/constants";
import { useI18n } from "@/components/i18n/i18n-provider";
import { RichText } from "@/components/i18n/rich-text";

interface PetSummary {
  id: string;
  name: string;
  species: string;
  sex: "MALE" | "FEMALE";
  birthDate: string | null;
  healthScore: number;
  breedName: string | null;
  photo: string | null;
  hasProfile: boolean;
  profileStatus: string | null;
  studFeeCents: number;
  currency: string;
  feeType: string;
  willingToTravelKm: number;
  requiresHealthTests: boolean;
  requiresVaccination: boolean;
  requiresPedigree: boolean;
  allowsMixedBreed: boolean;
  notes: string;
}

interface RequestSummary {
  id: string;
  status: string;
  isIncoming: boolean;
  message: string | null;
  score: number | null;
  feeCents: number;
  currency: string;
  feeType: string;
  createdAt: string;
  scheduledAt: string | null;
  iAgreed: boolean;
  theyAgreed: boolean;
  conversationId: string | null;
  myPet: { id: string; name: string; photo: string | null };
  theirPet: { id: string; name: string; photo: string | null; breedName: string | null };
  counterparty: { id: string; name: string; handle: string; avatarUrl: string | null };
}

interface Factor {
  key: string;
  label: string;
  value: number;
  weight: number;
  points: number;
  detail: string;
}

interface Match {
  pet: {
    id: string;
    name: string;
    breedName: string | null;
    photo: string | null;
    city: string | null;
    country: string | null;
    healthScore: number;
    verificationLevel: string;
    birthDate: string | null;
    sex: string;
  };
  owner: { id: string; name: string; handle: string; avatarUrl: string | null; trustScore: number };
  fee: { cents: number; currency: string; type: string };
  compatibility: {
    score: number;
    engine: string;
    eligible: boolean;
    blockers: string[];
    factors: Factor[];
    headline: string;
  };
}

export function BreedingWorkspace({
  pets,
  requests,
  advancedMatching,
  planName,
}: {
  pets: PetSummary[];
  requests: RequestSummary[];
  advancedMatching: boolean;
  planName: string;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"matches" | "requests">(
    requests.some((r) => r.isIncoming && r.status === "PENDING") ? "requests" : "matches",
  );

  const pendingIncoming = requests.filter((r) => r.isIncoming && r.status === "PENDING").length;

  return (
    <div>
      <SegmentedControl
        label={t("Breeding view")}
        value={tab}
        onChange={(v) => setTab(v as "matches" | "requests")}
        className="max-w-sm"
        options={[
          { value: "matches", label: "Find matches", icon: <Search className="size-4" aria-hidden /> },
          {
            value: "requests",
            label: pendingIncoming > 0 ? `Requests (${pendingIncoming})` : "Requests",
            icon: <Dna className="size-4" aria-hidden />,
          },
        ]}
      />

      <div className="mt-6">
        {tab === "matches" ? (
          <MatchFinder pets={pets} advancedMatching={advancedMatching} planName={planName} />
        ) : (
          <RequestList requests={requests} />
        )}
      </div>
    </div>
  );
}

function MatchFinder({
  pets,
  advancedMatching,
  planName,
}: {
  pets: PetSummary[];
  advancedMatching: boolean;
  planName: string;
}) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const toast = useToast();

  const [petId, setPetId] = useState(pets[0]?.id ?? "");
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [requestTarget, setRequestTarget] = useState<Match | null>(null);

  const pet = pets.find((p) => p.id === petId);

  async function findMatches() {
    if (!pet) return;

    if (!pet.hasProfile) {
      setProfileOpen(true);
      return;
    }

    setSearching(true);
    setError(null);

    try {
      const result = await api.get<{ matches: Match[] }>(
        `/api/breeding?mode=matches&petId=${petId}`,
      );
      setMatches(result.matches ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We could not load matches.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h2 className="font-display text-lg font-semibold text-fg">{t("Which pet?")}</h2>

        <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {pets.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => {
                  setPetId(option.id);
                  setMatches(null);
                }}
                aria-pressed={petId === option.id}
                className={cn(
                  "flex w-full items-center gap-3 rounded-[var(--radius-field)] border p-3 text-start transition-colors",
                  petId === option.id
                    ? "border-brand bg-brand-soft"
                    : "border-[var(--border-strong)] hover:bg-bg-sunken",
                )}
              >
                <span className="relative size-11 shrink-0 overflow-hidden rounded-[var(--radius-field)] bg-bg-sunken">
                  {option.photo && (
                    <Image src={option.photo} alt="" fill sizes="44px" className="object-cover" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-fg">
                    {option.name}
                  </span>
                  <span className="block truncate text-xs text-fg-muted">
                    {option.sex === "MALE" ? t("Male") : t("Female")} · {fmt.age(option.birthDate ? new Date(option.birthDate) : null)}
                  </span>
                </span>
                {option.hasProfile ? (
                  <Badge tone="success" size="sm">
                    {t("Listed")}
                  </Badge>
                ) : (
                  <Badge tone="neutral" size="sm">
                    {t("No profile")}
                  </Badge>
                )}
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => void findMatches()} loading={searching} loadingText={t("Scoring matches…")}>
            <Search className="size-4" aria-hidden />
            {pet?.hasProfile ? t("Find matches") : t("Create breeding profile")}
          </Button>
          {pet?.hasProfile && (
            <Button variant="outline" onClick={() => setProfileOpen(true)}>
              <Settings2 className="size-4" aria-hidden />
              {t("Edit preferences")}
            </Button>
          )}
        </div>

        {!advancedMatching && (
          <p className="mt-3 text-xs text-fg-muted">
            {t("The {plan} plan searches a limited pool.", { plan: planName })}{" "}
            <Link href="/pricing" className="font-semibold text-brand hover:underline">
              {t("Upgrade")}
            </Link>{" "}
            {t("to search every eligible pet.")}
          </p>
        )}
      </Card>

      {error && <Alert tone="danger">{error}</Alert>}

      {matches !== null && (
        <section>
          <h2 className="mb-3 font-display text-lg font-semibold text-fg">
            {t.plural(matches.length, { one: "{count} match", other: "{count} matches" })}
          </h2>

          {matches.length === 0 ? (
            <EmptyState
              icon={<Dna className="size-6" aria-hidden />}
              title={t("No eligible matches yet")}
              description={t("Nothing nearby meets the requirements for this pet. Widening the travel distance in your preferences is usually what unlocks results.")}
              action={
                <Button variant="outline" onClick={() => setProfileOpen(true)}>
                  {t("Adjust preferences")}
                </Button>
              }
            />
          ) : (
            <ul className="space-y-3">
              {matches.map((match) => (
                <li key={match.pet.id}>
                  <Card as="article" className="overflow-hidden">
                    <div className="flex flex-col gap-4 p-4 sm:flex-row">
                      <div className="relative aspect-card w-full shrink-0 overflow-hidden rounded-[var(--radius-field)] bg-bg-sunken sm:size-28">
                        {match.pet.photo && (
                          <Image
                            src={match.pet.photo}
                            alt=""
                            fill
                            sizes="112px"
                            className="object-cover"
                          />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="font-display text-lg font-semibold text-fg">
                              {match.pet.name}
                            </h3>
                            <p className="text-sm text-fg-muted">
                              {match.pet.breedName ?? match.pet.sex} ·{" "}
                              {fmt.age(match.pet.birthDate ? new Date(match.pet.birthDate) : null)}
                            </p>
                            <p className="mt-1 flex items-center gap-1 text-xs text-fg-subtle">
                              <MapPin className="size-3" aria-hidden />
                              {[match.pet.city, match.pet.country].filter(Boolean).join(", ") ||
                                t("Location not set")}
                            </p>
                          </div>

                          <div className="shrink-0 text-end">
                            <p
                              className={cn(
                                "font-display text-3xl font-semibold tabular",
                                match.compatibility.score >= 75
                                  ? "text-[var(--success)]"
                                  : match.compatibility.score >= 55
                                    ? "text-brand"
                                    : "text-[var(--warning)]",
                              )}
                            >
                              {match.compatibility.score}
                            </p>
                            <p className="text-[11px] text-fg-subtle">{t("compatibility")}</p>
                          </div>
                        </div>

                        <p className="mt-2 text-sm text-fg-muted">
                          {match.compatibility.headline}
                        </p>

                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <Avatar
                            src={match.owner.avatarUrl}
                            name={match.owner.name}
                            size="xs"
                          />
                          <Link
                            href={`/u/${match.owner.handle}`}
                            className="text-sm text-fg-muted hover:text-fg hover:underline"
                          >
                            {match.owner.name}
                          </Link>
                          <Badge tone="neutral" size="sm">
                            {t("Trust {score}", { score: match.owner.trustScore })}
                          </Badge>
                          <Badge tone="brand" size="sm">
                            {match.fee.type === "FEE" && match.fee.cents > 0
                              ? fmt.money(match.fee.cents, match.fee.currency)
                              : t(BREEDING_FEE_TYPE_LABEL[match.fee.type as BreedingFeeType])}
                          </Badge>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button size="sm" onClick={() => setRequestTarget(match)}>
                            {t("Send request")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setExpanded(expanded === match.pet.id ? null : match.pet.id)
                            }
                            aria-expanded={expanded === match.pet.id}
                          >
                            <ChevronDown
                              className={cn(
                                "size-4 transition-transform",
                                expanded === match.pet.id && "rotate-180",
                              )}
                              aria-hidden
                            />
                            {t("Why this score")}
                          </Button>
                        </div>
                      </div>
                    </div>

                    {expanded === match.pet.id && (
                      <div className="border-t border-[var(--border)] bg-bg-sunken p-4">
                        <p className="mb-3 text-xs text-fg-muted">
                          <RichText
                            text={t("Engine: {engine} — a deterministic rule set, not a learned model.")}
                            values={{ engine: <span className="font-mono">{match.compatibility.engine}</span> }}
                          />
                        </p>
                        <ul className="space-y-2.5">
                          {match.compatibility.factors.map((factor) => (
                            <li key={factor.key}>
                              <div className="flex items-baseline justify-between gap-3 text-sm">
                                <span className="font-medium text-fg">{t(factor.label)}</span>
                                <span className="shrink-0 tabular text-fg-muted">
                                  {factor.points} / {factor.weight}
                                </span>
                              </div>
                              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg-inset">
                                <div
                                  className={cn(
                                    "h-full rounded-full",
                                    factor.value >= 0.75
                                      ? "bg-[var(--success)]"
                                      : factor.value >= 0.45
                                        ? "bg-[var(--warning)]"
                                        : "bg-[var(--danger)]",
                                  )}
                                  style={{ width: `${Math.max(2, factor.value * 100)}%` }}
                                />
                              </div>
                              <p className="mt-1 text-xs text-fg-muted">{factor.detail}</p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {pet && (
        <BreedingProfileModal
          open={profileOpen}
          onClose={() => setProfileOpen(false)}
          pet={pet}
          onSaved={() => {
            setProfileOpen(false);
            router.refresh();
            void findMatches();
          }}
        />
      )}

      {pet && requestTarget && (
        <SendRequestModal
          open={Boolean(requestTarget)}
          onClose={() => setRequestTarget(null)}
          fromPet={pet}
          match={requestTarget}
          onSent={() => {
            setRequestTarget(null);
            toast.success(t("Request sent"), t("You will be notified when they respond."));
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function BreedingProfileModal({
  open,
  onClose,
  pet,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  pet: PetSummary;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();

  const [feeType, setFeeType] = useState<BreedingFeeType>(pet.feeType as BreedingFeeType);
  const [fee, setFee] = useState(pet.studFeeCents ? (pet.studFeeCents / 100).toString() : "");
  const [travelKm, setTravelKm] = useState(String(pet.willingToTravelKm));
  const [requiresHealthTests, setRequiresHealthTests] = useState(pet.requiresHealthTests);
  const [requiresVaccination, setRequiresVaccination] = useState(pet.requiresVaccination);
  const [requiresPedigree, setRequiresPedigree] = useState(pet.requiresPedigree);
  const [allowsMixedBreed, setAllowsMixedBreed] = useState(pet.allowsMixedBreed);
  const [notes, setNotes] = useState(pet.notes);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);

    try {
      await api.post("/api/breeding", {
        action: "save-profile",
        profile: {
          petId: pet.id,
          studFeeCents: feeType === "FEE" ? (parseMoneyToCents(fee) ?? 0) : 0,
          currency: pet.currency,
          feeType,
          willingToTravelKm: Number(travelKm) || 50,
          requiresHealthTests,
          requiresVaccination,
          requiresPedigree,
          allowsMixedBreed,
          notes: notes.trim() || undefined,
        },
      });

      toast.success(t("Breeding profile saved"), `${pet.name} is now discoverable.`);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We could not save that profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("Breeding preferences for {name}", { name: pet.name })}
      description={t("These are matched against every candidate. Stricter requirements mean fewer but better matches.")}
      size="lg"
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        <Field label={t("Arrangement")}>
          {({ id }) => (
            <Select
              id={id}
              value={feeType}
              onChange={(e) => setFeeType(e.target.value as BreedingFeeType)}
            >
              {BREEDING_FEE_TYPE.map((type) => (
                <option key={type} value={type}>
                  {t(BREEDING_FEE_TYPE_LABEL[type])}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {feeType === "FEE" && (
          <Field label={t("Fee")}>
            {({ id }) => (
              <Input
                id={id}
                inputMode="decimal"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                leading={<span className="text-sm">{pet.currency}</span>}
                placeholder="0.00"
              />
            )}
          </Field>
        )}

        <Field
          label={t("Willing to travel")}
          hint={t("Matches beyond this still appear, but score lower.")}
        >
          {({ id }) => (
            <Select id={id} value={travelKm} onChange={(e) => setTravelKm(e.target.value)}>
              {[25, 50, 100, 200, 500, 1000].map((km) => (
                <option key={km} value={km}>
                  {t("Up to {km} km", { km })}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <fieldset className="space-y-3">
          <legend className="mb-1 text-sm font-medium text-fg">{t("Requirements for a partner")}</legend>
          <Checkbox
            label={t("Health testing")}
            hint={t("Documents on file for the relevant screening.")}
            checked={requiresHealthTests}
            onChange={(e) => setRequiresHealthTests(e.target.checked)}
          />
          <Checkbox
            label={t("Vaccinations up to date")}
            checked={requiresVaccination}
            onChange={(e) => setRequiresVaccination(e.target.checked)}
          />
          <Checkbox
            label={t("Registered pedigree")}
            checked={requiresPedigree}
            onChange={(e) => setRequiresPedigree(e.target.checked)}
          />
          <Checkbox
            label={t("Open to a different breed")}
            hint={t("Leave off to match the same breed only.")}
            checked={allowsMixedBreed}
            onChange={(e) => setAllowsMixedBreed(e.target.checked)}
          />
        </fieldset>

        <Field label={t("Notes for other owners")} trailing={`${notes.length}/1500`}>
          {({ id }) => (
            <Textarea
              id={id}
              rows={3}
              maxLength={1500}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("Hip score 4/3, elbows 0, eyes clear. Happy to share full records before anything is agreed.")}
            />
          )}
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button onClick={() => void save()} loading={saving} loadingText={t("Saving…")}>
            {t("Save profile")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function SendRequestModal({
  open,
  onClose,
  fromPet,
  match,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  fromPet: PetSummary;
  match: Match;
  onSent: () => void;
}) {
  const { t } = useI18n();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setSending(true);
    setError(null);

    try {
      await api.post("/api/breeding", {
        action: "request",
        request: { fromPetId: fromPet.id, toPetId: match.pet.id, message: message.trim() },
      });
      onSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We could not send that request.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("Request: {name} × {name2}", { name: fromPet.name, name2: match.pet.name })}
      description={t("Compatibility {score}/100. The owner sees the full breakdown too.", { score: match.compatibility.score })}
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        <Field
          label={t("Your message")}
          required
          hint={t("Say what you are looking for and what you can share about health testing.")}
          trailing={`${message.length}/4000`}
        >
          {({ id }) => (
            <Textarea
              id={id}
              rows={5}
              maxLength={4000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("Hello — I have {name}, hip scored and fully vaccinated, and I am looking for a match this season. Happy to share the full health record and to travel. Would you be open to talking?", { name: fromPet.name })}
            />
          )}
        </Field>

        <Alert tone="info">
          {t("Nothing is committed by sending this. Terms are agreed separately and both of you have to accept them before anything is scheduled.")}
        </Alert>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            onClick={() => void send()}
            loading={sending}
            loadingText={t("Sending…")}
            disabled={message.trim().length < 20}
          >
            {t("Send request")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function RequestList({ requests }: { requests: RequestSummary[] }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [working, setWorking] = useState<string | null>(null);

  async function respond(id: string, accept: boolean) {
    setWorking(id);
    try {
      await api.post("/api/breeding", { action: "respond", requestId: id, accept });
      toast.success(accept ? "Request accepted" : "Request declined");
      router.refresh();
    } catch (err) {
      toast.error(
        t("That did not work"),
        err instanceof ApiError ? err.message : "Please try again.",
      );
    } finally {
      setWorking(null);
    }
  }

  async function agree(id: string) {
    setWorking(id);
    try {
      const result = await api.post<{ bothAgreed: boolean }>("/api/breeding", {
        action: "agree",
        requestId: id,
      });
      toast.success(
        result.bothAgreed ? "Terms agreed by both owners" : "You have agreed",
        result.bothAgreed ? "You can now arrange the date." : "Waiting for the other owner.",
      );
      router.refresh();
    } catch (err) {
      toast.error(t("That did not work"), err instanceof ApiError ? err.message : "Please try again.");
    } finally {
      setWorking(null);
    }
  }

  if (requests.length === 0) {
    return (
      <EmptyState
        icon={<Dna className="size-6" aria-hidden />}
        title={t("No breeding requests")}
        description={t("Requests you send and receive appear here, with the compatibility breakdown attached.")}
      />
    );
  }

  return (
    <ul className="space-y-3">
      {requests.map((request) => {
        const canRespond = request.isIncoming && request.status === "PENDING";
        const canAgree =
          ["TERMS_PROPOSED", "AGREED"].includes(request.status) && !request.iAgreed;

        return (
          <li key={request.id}>
            <Card as="article" className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex -space-x-3">
                    {[request.myPet.photo, request.theirPet.photo].map((photo, i) => (
                      <span
                        key={i}
                        className="relative size-11 overflow-hidden rounded-full border-2 border-[var(--bg-elevated)] bg-bg-sunken"
                      >
                        {photo && <Image src={photo} alt="" fill sizes="44px" className="object-cover" />}
                      </span>
                    ))}
                  </div>

                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-fg">
                      <Link href={`/dashboard/breeding/requests/${request.id}`} className="hover:underline">
                        {request.myPet.name} × {request.theirPet.name}
                      </Link>
                    </p>
                    <p className="truncate text-xs text-fg-muted">
                      {request.isIncoming ? t("From {name}", { name: request.counterparty.name }) : t("To {name}", { name: request.counterparty.name })} ·{" "}
                      {fmt.relative(request.createdAt)}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {request.score != null && (
                    <Badge tone={request.score >= 70 ? "success" : "brand"} size="sm">
                      {request.score}/100
                    </Badge>
                  )}
                  <StatusPill
                    tone={
                      request.status === "PENDING"
                        ? "warning"
                        : ["ACCEPTED", "AGREED", "SCHEDULED", "COMPLETED"].includes(request.status)
                          ? "success"
                          : "neutral"
                    }
                  >
                    {request.status.replace("_", " ").toLowerCase()}
                  </StatusPill>
                </div>
              </div>

              {request.message && (
                <p className="mt-3 rounded-[var(--radius-field)] bg-bg-sunken px-3 py-2 text-sm text-fg-muted">
                  {request.message}
                </p>
              )}

              {["TERMS_PROPOSED", "AGREED", "SCHEDULED"].includes(request.status) && (
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <Badge tone={request.iAgreed ? "success" : "neutral"} size="sm">
                    {request.iAgreed ? t("You agreed") : t("You have not agreed")}
                  </Badge>
                  <Badge tone={request.theyAgreed ? "success" : "neutral"} size="sm">
                    {request.theyAgreed ? t("They agreed") : t("They have not agreed")}
                  </Badge>
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {canRespond && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => void respond(request.id, true)}
                      loading={working === request.id}
                    >
                      <Check className="size-4" aria-hidden />
                      {t("Accept")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void respond(request.id, false)}
                      disabled={working === request.id}
                    >
                      <X className="size-4" aria-hidden />
                      {t("Decline")}
                    </Button>
                  </>
                )}

                {canAgree && (
                  <Button
                    size="sm"
                    onClick={() => void agree(request.id)}
                    loading={working === request.id}
                  >
                    {t("Agree to terms")}
                  </Button>
                )}

                <ButtonLink href={`/dashboard/breeding/requests/${request.id}`} size="sm" variant="outline">
                  {t("View details")}
                </ButtonLink>

                {request.conversationId && (
                  <ButtonLink
                    href={`/messages/${request.conversationId}`}
                    size="sm"
                    variant="ghost"
                  >
                    <MessageSquare className="size-4" aria-hidden />
                    {t("Open conversation")}
                  </ButtonLink>
                )}
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
