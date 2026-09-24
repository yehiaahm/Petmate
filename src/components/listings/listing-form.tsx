"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Check, Sparkles, AlertTriangle, ThumbsUp, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, Checkbox, SegmentedControl } from "@/components/ui/field";
import { Card, Alert, Badge } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { formatMoney, parseMoneyToCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { LIMITS, type ListingIntent } from "@/lib/constants";

interface PetOption {
  id: string;
  name: string;
  species: string;
  sex: string;
  breedName: string | null;
  photo: string | null;
  photoCount: number;
  healthRecordCount: number;
}

interface Feedback {
  score: number;
  strengths: string[];
  improvements: { issue: string; suggestion: string }[];
  suggestedTitle?: string;
}

/**
 * Listing composer.
 *
 * The quality coach is the interesting part: it reviews the draft before it is
 * published and says what is missing. It always reports which engine produced
 * the feedback, so rule-based checks are never dressed up as AI.
 */
export function ListingForm({
  pets,
  preselectedPetId,
  currency,
  disabled,
  manualReviewPriceCents,
  defaultCity,
  defaultCountry,
}: {
  pets: PetOption[];
  preselectedPetId?: string;
  currency: string;
  disabled?: boolean;
  manualReviewPriceCents: number;
  defaultCity?: string | null;
  defaultCountry?: string | null;
}) {
  const router = useRouter();
  const toast = useToast();

  const [petId, setPetId] = useState(
    preselectedPetId && pets.some((p) => p.id === preselectedPetId)
      ? preselectedPetId
      : (pets[0]?.id ?? ""),
  );
  const [intent, setIntent] = useState<ListingIntent>("SALE");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [negotiable, setNegotiable] = useState(false);
  const [city, setCity] = useState(defaultCity ?? "");
  const [country, setCountry] = useState(defaultCountry ?? "");
  const [questions, setQuestions] = useState<string[]>([]);

  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [feedbackSource, setFeedbackSource] = useState<"ai" | "rules" | null>(null);
  const [feedbackNote, setFeedbackNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const pet = pets.find((p) => p.id === petId);
  const priceCents = parseMoneyToCents(price) ?? 0;
  const needsReview = intent === "SALE" && priceCents >= manualReviewPriceCents;

  const blockingIssues = (feedback?.improvements ?? []).filter((i) =>
    i.issue.startsWith("[required]"),
  );

  async function runCheck() {
    if (!pet || description.trim().length < 20) {
      toast.info("Write a bit more first", "The coach needs something to look at.");
      return;
    }

    setChecking(true);
    try {
      const result = await api.post<{
        feedback: Feedback;
        source: "ai" | "rules";
        note?: string;
      }>("/api/ai", {
        action: "review-listing",
        petId: pet.id,
        title: title.trim() || `${pet.name}`,
        description: description.trim(),
        intent,
        priceCents,
      });

      setFeedback(result.feedback);
      setFeedbackSource(result.source);
      setFeedbackNote(result.note ?? null);
    } catch (err) {
      toast.error(
        "Could not check the listing",
        err instanceof ApiError ? err.message : "Please try again.",
      );
    } finally {
      setChecking(false);
    }
  }

  async function submit(publish: boolean) {
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    try {
      const { listing } = await api.post<{ listing: { id: string; status: string } }>(
        "/api/listings",
        {
          petId,
          intent,
          title: title.trim(),
          description: description.trim(),
          priceCents: intent === "SALE" ? priceCents : 0,
          adoptionFeeCents: intent === "ADOPTION" ? priceCents : 0,
          studFeeCents: intent === "BREEDING" ? priceCents : 0,
          currency,
          negotiable,
          city: city || undefined,
          country: country || undefined,
          questions: intent === "ADOPTION" && questions.length ? questions : undefined,
          publish,
        },
      );

      toast.success(
        listing.status === "ACTIVE"
          ? "Your listing is live"
          : listing.status === "PENDING_REVIEW"
            ? "Sent for review"
            : "Saved as a draft",
        listing.status === "PENDING_REVIEW"
          ? "We check listings before they go live. This usually takes a few hours."
          : undefined,
      );

      router.push(`/dashboard/listings/${listing.id}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        const map: Record<string, string> = {};
        for (const field of err.fields) map[field.field] = field.message;
        setFieldErrors(map);
      } else {
        setError("Something went wrong. Please try again.");
      }
      setSubmitting(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  return (
    <form onSubmit={(e) => e.preventDefault()} className="space-y-6" noValidate>
      {error && (
        <Alert tone="danger" title="Could not create the listing">
          {error}
        </Alert>
      )}

      <Card className="p-5">
        <h2 className="font-display text-lg font-semibold text-fg">Which pet?</h2>

        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {pets.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => setPetId(option.id)}
                aria-pressed={petId === option.id}
                className={cn(
                  "flex w-full items-center gap-3 rounded-[var(--radius-field)] border p-3 text-left transition-colors",
                  petId === option.id
                    ? "border-brand bg-brand-soft"
                    : "border-[var(--border-strong)] hover:bg-bg-sunken",
                )}
              >
                <span className="relative size-12 shrink-0 overflow-hidden rounded-[var(--radius-field)] bg-bg-sunken">
                  {option.photo && (
                    <Image src={option.photo} alt="" fill sizes="48px" className="object-cover" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-fg">
                    {option.name}
                  </span>
                  <span className="block truncate text-xs text-fg-muted">
                    {option.breedName ?? option.species}
                  </span>
                </span>
                {petId === option.id && <Check className="size-4 shrink-0 text-brand" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>

        {pet && pet.photoCount === 0 && (
          <div className="mt-3">
            <Alert tone="warning">
              {pet.name} has no photos. A listing cannot be published without at least one.{" "}
              <Link href={`/dashboard/pets/${pet.id}/edit`} className="font-semibold underline">
                Add photos
              </Link>
            </Alert>
          </div>
        )}

        {pet && pet.healthRecordCount === 0 && pet.photoCount > 0 && (
          <div className="mt-3">
            <Alert tone="info">
              {pet.name} has no health records. Listings with them get noticeably more genuine
              enquiries.{" "}
              <Link href={`/dashboard/pets/${pet.id}/health`} className="font-semibold underline">
                Add records
              </Link>
            </Alert>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="font-display text-lg font-semibold text-fg">What are you offering?</h2>

        <div className="mt-4 space-y-4">
          <SegmentedControl
            label="Listing type"
            value={intent}
            onChange={(v) => setIntent(v as ListingIntent)}
            options={[
              { value: "SALE", label: "For sale" },
              { value: "ADOPTION", label: "For adoption" },
              { value: "BREEDING", label: "Breeding" },
            ]}
          />

          <Field
            label="Title"
            required
            hint="Say what it is plainly. Buyers scan these."
            error={fieldErrors.title}
            trailing={`${title.length}/${LIMITS.titleMax}`}
          >
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                maxLength={LIMITS.titleMax}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  pet
                    ? `${pet.name} — ${pet.breedName ?? pet.species.toLowerCase()} ${pet.sex === "FEMALE" ? "girl" : "boy"}, ready now`
                    : "A clear, specific title"
                }
              />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={
                intent === "SALE" ? "Price" : intent === "ADOPTION" ? "Adoption fee" : "Stud fee"
              }
              required={intent === "SALE"}
              hint={
                intent === "ADOPTION"
                  ? "Leave blank for free to a good home."
                  : intent === "BREEDING"
                    ? "Leave blank if terms are negotiable."
                    : undefined
              }
              error={fieldErrors.priceCents}
            >
              {({ id, invalid }) => (
                <Input
                  id={id}
                  invalid={invalid}
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  leading={<span className="text-sm">{currency}</span>}
                  placeholder="0.00"
                />
              )}
            </Field>

            <div className="flex items-end pb-2.5">
              <Checkbox
                label="Open to offers"
                checked={negotiable}
                onChange={(e) => setNegotiable(e.target.checked)}
              />
            </div>
          </div>

          {needsReview && (
            <Alert tone="info" icon={<Info className="size-4" aria-hidden />}>
              Listings above {formatMoney(manualReviewPriceCents, currency)} go to manual review
              before they appear. That protects buyers at this price point, and it protects you
              from a dispute later.
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="City">
              {({ id }) => (
                <Input id={id} maxLength={80} value={city} onChange={(e) => setCity(e.target.value)} />
              )}
            </Field>
            <Field label="Country">
              {({ id }) => (
                <Input
                  id={id}
                  maxLength={60}
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                />
              )}
            </Field>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-fg">Description</h2>
            <p className="mt-1 text-sm text-fg-muted">
              Temperament, routine, health, and why you are rehoming.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void runCheck()}
            loading={checking}
            loadingText="Checking…"
          >
            <Sparkles className="size-4" aria-hidden />
            Check my listing
          </Button>
        </div>

        <div className="mt-4">
          <Field
            label="About this pet"
            required
            error={fieldErrors.description}
            trailing={`${description.length}/${LIMITS.descriptionMax}`}
          >
            {({ id, invalid }) => (
              <Textarea
                id={id}
                invalid={invalid}
                rows={10}
                maxLength={LIMITS.descriptionMax}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={`${pet?.name ?? "She"} has been raised in the house with two children and a cat, is used to the vacuum and the doorbell, and is handled all over without fuss. Toilet training is well underway and she sleeps through the night in her crate.\n\nShe has had her first two vaccinations, is microchipped and wormed to date. I am rehoming because my circumstances changed, and I would like her to go somewhere with time for training.\n\nVisits welcome before you decide.`}
              />
            )}
          </Field>
        </div>

        {feedback && (
          <div className="mt-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-bg-sunken p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
                Listing quality
                <span className="tabular text-fg-muted">{feedback.score}/100</span>
              </h3>
              {/* Always state which engine produced this. */}
              <Badge tone={feedbackSource === "ai" ? "brand" : "neutral"} size="sm">
                {feedbackSource === "ai" ? "AI review" : "Rule checks"}
              </Badge>
            </div>

            {feedbackNote && <p className="mt-1.5 text-xs text-fg-subtle">{feedbackNote}</p>}

            {feedback.strengths.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {feedback.strengths.map((strength) => (
                  <li key={strength} className="flex items-start gap-2 text-sm text-fg-muted">
                    <ThumbsUp
                      className="mt-0.5 size-3.5 shrink-0 text-[var(--success)]"
                      aria-hidden
                    />
                    {strength}
                  </li>
                ))}
              </ul>
            )}

            {feedback.improvements.length > 0 && (
              <ul className="mt-3 space-y-2.5">
                {feedback.improvements.map((item, index) => {
                  const required = item.issue.startsWith("[required]");
                  return (
                    <li key={index} className="flex items-start gap-2 text-sm">
                      <AlertTriangle
                        className={cn(
                          "mt-0.5 size-3.5 shrink-0",
                          required ? "text-[var(--danger)]" : "text-[var(--warning)]",
                        )}
                        aria-hidden
                      />
                      <span>
                        <span className="font-medium text-fg">
                          {item.issue.replace("[required] ", "")}
                        </span>
                        <span className="block text-fg-muted">{item.suggestion}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {feedback.suggestedTitle && feedback.suggestedTitle !== title && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
                <span className="text-xs text-fg-muted">Suggested title:</span>
                <span className="text-sm font-medium text-fg">{feedback.suggestedTitle}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setTitle(feedback.suggestedTitle!)}
                >
                  Use it
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      {intent === "ADOPTION" && (
        <Card className="p-5">
          <h2 className="font-display text-lg font-semibold text-fg">Questions for applicants</h2>
          <p className="mt-1 text-sm text-fg-muted">
            Applicants already answer about their home, hours alone, other pets and experience. Add
            anything specific to this animal.
          </p>

          <div className="mt-4 space-y-2">
            {questions.map((question, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  value={question}
                  maxLength={200}
                  onChange={(e) =>
                    setQuestions((q) => q.map((v, i) => (i === index ? e.target.value : v)))
                  }
                  placeholder="What would make you return an animal to us?"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setQuestions((q) => q.filter((_, i) => i !== index))}
                  aria-label="Remove question"
                >
                  ×
                </Button>
              </div>
            ))}

            {questions.length < 8 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setQuestions((q) => [...q, ""])}
              >
                Add a question
              </Button>
            )}
          </div>
        </Card>
      )}

      {blockingIssues.length > 0 && (
        <Alert tone="warning" title="Fix these before publishing">
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {blockingIssues.map((issue, i) => (
              <li key={i}>{issue.issue.replace("[required] ", "")}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="ghost"
          onClick={() => void submit(false)}
          disabled={submitting || !petId || title.trim().length < 10}
        >
          Save as draft
        </Button>
        <Button
          type="button"
          size="lg"
          onClick={() => void submit(true)}
          loading={submitting}
          loadingText="Publishing…"
          disabled={
            disabled ||
            !petId ||
            title.trim().length < 10 ||
            description.trim().length < 40 ||
            (pet?.photoCount ?? 0) === 0 ||
            (intent === "SALE" && priceCents < 100)
          }
        >
          {needsReview ? "Submit for review" : "Publish listing"}
        </Button>
      </div>
    </form>
  );
}
