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
import { formatMoney, parseMoneyToCents } from "@/lib/money";
import { formatAge, relativeTime, cn } from "@/lib/utils";
import { BREEDING_FEE_TYPE, BREEDING_FEE_TYPE_LABEL, type BreedingFeeType } from "@/lib/constants";

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
  const [tab, setTab] = useState<"matches" | "requests">(
    requests.some((r) => r.isIncoming && r.status === "PENDING") ? "requests" : "matches",
  );

  const pendingIncoming = requests.filter((r) => r.isIncoming && r.status === "PENDING").length;

  return (
    <div>
      <SegmentedControl
        label="Breeding view"
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
        <h2 className="font-display text-lg font-semibold text-fg">Which pet?</h2>

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
                    {option.sex === "MALE" ? "Male" : "Female"} · {formatAge(option.birthDate ? new Date(option.birthDate) : null)}
                  </span>
                </span>
                {option.hasProfile ? (
                  <Badge tone="success" size="sm">
                    Listed
                  </Badge>
                ) : (
                  <Badge tone="neutral" size="sm">
                    No profile
                  </Badge>
                )}
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => void findMatches()} loading={searching} loadingText="Scoring matches…">
            <Search className="size-4" aria-hidden />
            {pet?.hasProfile ? "Find matches" : "Create breeding profile"}
          </Button>
          {pet?.hasProfile && (
            <Button variant="outline" onClick={() => setProfileOpen(true)}>
              <Settings2 className="size-4" aria-hidden />
              Edit preferences
            </Button>
          )}
        </div>

        {!advancedMatching && (
          <p className="mt-3 text-xs text-fg-muted">
            The {planName} plan searches a limited pool.{" "}
            <Link href="/pricing" className="font-semibold text-brand hover:underline">
              Upgrade
            </Link>{" "}
            to search every eligible pet.
          </p>
        )}
      </Card>

      {error && <Alert tone="danger">{error}</Alert>}

      {matches !== null && (
        <section>
          <h2 className="mb-3 font-display text-lg font-semibold text-fg">
            {matches.length} {matches.length === 1 ? "match" : "matches"}
          </h2>

          {matches.length === 0 ? (
            <EmptyState
              icon={<Dna className="size-6" aria-hidden />}
              title="No eligible matches yet"
              description="Nothing nearby meets the requirements for this pet. Widening the travel distance in your preferences is usually what unlocks results."
              action={
                <Button variant="outline" onClick={() => setProfileOpen(true)}>
                  Adjust preferences
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
                              {formatAge(match.pet.birthDate ? new Date(match.pet.birthDate) : null)}
                            </p>
                            <p className="mt-1 flex items-center gap-1 text-xs text-fg-subtle">
                              <MapPin className="size-3" aria-hidden />
                              {[match.pet.city, match.pet.country].filter(Boolean).join(", ") ||
                                "Location not set"}
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
                            <p className="text-[11px] text-fg-subtle">compatibility</p>
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
                            Trust {match.owner.trustScore}
                          </Badge>
                          <Badge tone="brand" size="sm">
                            {match.fee.type === "FEE" && match.fee.cents > 0
                              ? formatMoney(match.fee.cents, match.fee.currency)
                              : BREEDING_FEE_TYPE_LABEL[match.fee.type as BreedingFeeType]}
                          </Badge>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button size="sm" onClick={() => setRequestTarget(match)}>
                            Send request
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
                            Why this score
                          </Button>
                        </div>
                      </div>
                    </div>

                    {expanded === match.pet.id && (
                      <div className="border-t border-[var(--border)] bg-bg-sunken p-4">
                        <p className="mb-3 text-xs text-fg-muted">
                          Engine: <span className="font-mono">{match.compatibility.engine}</span> —
                          a deterministic rule set, not a learned model.
                        </p>
                        <ul className="space-y-2.5">
                          {match.compatibility.factors.map((factor) => (
                            <li key={factor.key}>
                              <div className="flex items-baseline justify-between gap-3 text-sm">
                                <span className="font-medium text-fg">{factor.label}</span>
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
            toast.success("Request sent", "You will be notified when they respond.");
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

      toast.success("Breeding profile saved", `${pet.name} is now discoverable.`);
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
      title={`Breeding preferences for ${pet.name}`}
      description="These are matched against every candidate. Stricter requirements mean fewer but better matches."
      size="lg"
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        <Field label="Arrangement">
          {({ id }) => (
            <Select
              id={id}
              value={feeType}
              onChange={(e) => setFeeType(e.target.value as BreedingFeeType)}
            >
              {BREEDING_FEE_TYPE.map((type) => (
                <option key={type} value={type}>
                  {BREEDING_FEE_TYPE_LABEL[type]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {feeType === "FEE" && (
          <Field label="Fee">
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
          label="Willing to travel"
          hint="Matches beyond this still appear, but score lower."
        >
          {({ id }) => (
            <Select id={id} value={travelKm} onChange={(e) => setTravelKm(e.target.value)}>
              {[25, 50, 100, 200, 500, 1000].map((km) => (
                <option key={km} value={km}>
                  Up to {km} km
                </option>
              ))}
            </Select>
          )}
        </Field>

        <fieldset className="space-y-3">
          <legend className="mb-1 text-sm font-medium text-fg">Requirements for a partner</legend>
          <Checkbox
            label="Health testing"
            hint="Documents on file for the relevant screening."
            checked={requiresHealthTests}
            onChange={(e) => setRequiresHealthTests(e.target.checked)}
          />
          <Checkbox
            label="Vaccinations up to date"
            checked={requiresVaccination}
            onChange={(e) => setRequiresVaccination(e.target.checked)}
          />
          <Checkbox
            label="Registered pedigree"
            checked={requiresPedigree}
            onChange={(e) => setRequiresPedigree(e.target.checked)}
          />
          <Checkbox
            label="Open to a different breed"
            hint="Leave off to match the same breed only."
            checked={allowsMixedBreed}
            onChange={(e) => setAllowsMixedBreed(e.target.checked)}
          />
        </fieldset>

        <Field label="Notes for other owners" trailing={`${notes.length}/1500`}>
          {({ id }) => (
            <Textarea
              id={id}
              rows={3}
              maxLength={1500}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Hip score 4/3, elbows 0, eyes clear. Happy to share full records before anything is agreed."
            />
          )}
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={saving} loadingText="Saving…">
            Save profile
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
      title={`Request: ${fromPet.name} × ${match.pet.name}`}
      description={`Compatibility ${match.compatibility.score}/100. The owner sees the full breakdown too.`}
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        <Field
          label="Your message"
          required
          hint="Say what you are looking for and what you can share about health testing."
          trailing={`${message.length}/4000`}
        >
          {({ id }) => (
            <Textarea
              id={id}
              rows={5}
              maxLength={4000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={`Hello — I have ${fromPet.name}, hip scored and fully vaccinated, and I am looking for a match this season. Happy to share the full health record and to travel. Would you be open to talking?`}
            />
          )}
        </Field>

        <Alert tone="info">
          Nothing is committed by sending this. Terms are agreed separately and both of you have to
          accept them before anything is scheduled.
        </Alert>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void send()}
            loading={sending}
            loadingText="Sending…"
            disabled={message.trim().length < 20}
          >
            Send request
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function RequestList({ requests }: { requests: RequestSummary[] }) {
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
        "That did not work",
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
      toast.error("That did not work", err instanceof ApiError ? err.message : "Please try again.");
    } finally {
      setWorking(null);
    }
  }

  if (requests.length === 0) {
    return (
      <EmptyState
        icon={<Dna className="size-6" aria-hidden />}
        title="No breeding requests"
        description="Requests you send and receive appear here, with the compatibility breakdown attached."
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
                      {request.isIncoming ? "From" : "To"} {request.counterparty.name} ·{" "}
                      {relativeTime(request.createdAt)}
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
                    {request.iAgreed ? "You agreed" : "You have not agreed"}
                  </Badge>
                  <Badge tone={request.theyAgreed ? "success" : "neutral"} size="sm">
                    {request.theyAgreed ? "They agreed" : "They have not agreed"}
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
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void respond(request.id, false)}
                      disabled={working === request.id}
                    >
                      <X className="size-4" aria-hidden />
                      Decline
                    </Button>
                  </>
                )}

                {canAgree && (
                  <Button
                    size="sm"
                    onClick={() => void agree(request.id)}
                    loading={working === request.id}
                  >
                    Agree to terms
                  </Button>
                )}

                <ButtonLink href={`/dashboard/breeding/requests/${request.id}`} size="sm" variant="outline">
                  View details
                </ButtonLink>

                {request.conversationId && (
                  <ButtonLink
                    href={`/messages/${request.conversationId}`}
                    size="sm"
                    variant="ghost"
                  >
                    <MessageSquare className="size-4" aria-hidden />
                    Open conversation
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
