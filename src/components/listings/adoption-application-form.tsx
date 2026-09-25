"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea, Checkbox } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { useI18n } from "@/components/i18n/i18n-provider";

/**
 * Adoption application.
 *
 * The questions are the ones rescues actually reject on: hours alone, home
 * type, existing animals, experience. Asking them as structured fields means
 * the rescue can sort a hundred applications instead of reading a hundred
 * paragraphs, and the applicant knows what is being judged.
 */
export function AdoptionApplicationForm({
  open,
  onClose,
  listingId,
  petName,
  questions,
}: {
  open: boolean;
  onClose: () => void;
  listingId: string;
  petName: string;
  questions: { id: string; prompt: string; required: boolean }[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();

  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    homeType: "HOUSE" as "APARTMENT" | "HOUSE" | "FARM" | "OTHER",
    hasYard: false,
    hasOtherPets: false,
    otherPetsInfo: "",
    hasChildren: false,
    childrenAges: "",
    hoursAloneDaily: 4,
    experienceLevel: "SOME" as "FIRST_TIME" | "SOME" | "EXPERIENCED",
    previousPets: "",
    motivation: "",
    agreedToTerms: false,
  });

  const [answers, setAnswers] = useState<Record<string, string>>({});

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    try {
      await api.post("/api/adoption", {
        action: "apply",
        application: {
          listingId,
          homeType: form.homeType,
          hasYard: form.hasYard,
          hasOtherPets: form.hasOtherPets,
          otherPetsInfo: form.otherPetsInfo || undefined,
          hasChildren: form.hasChildren,
          childrenAges: form.childrenAges || undefined,
          hoursAloneDaily: form.hoursAloneDaily,
          experienceLevel: form.experienceLevel,
          previousPets: form.previousPets || undefined,
          motivation: form.motivation,
          answers: Object.keys(answers).length ? answers : undefined,
          agreedToTerms: form.agreedToTerms,
        },
      });

      onClose();
      toast.success(
        t("Application sent"),
        `${petName}'s current owner will be in touch. You can follow it under your applications.`,
      );
      router.push("/dashboard/applications");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        const map: Record<string, string> = {};
        for (const field of err.fields) {
          map[field.field.replace("application.", "")] = field.message;
        }
        setFieldErrors(map);
        // Send them back to the step that holds the problem.
        if (map.motivation || map.agreedToTerms) setStep(2);
        else setStep(1);
      } else {
        setError("We could not send that application. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const canContinue = form.hoursAloneDaily >= 0 && form.hoursAloneDaily <= 24;
  const canSubmit = form.motivation.trim().length >= 50 && form.agreedToTerms;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("Apply to adopt {petName}", { petName })}
      description={t("Step {step} of 2 · {section}", { step, section: step === 1 ? t("Your household") : t("About you") })}
      size="lg"
    >
      <div className="space-y-5">
        {error && (
          <Alert tone="danger" title={t("Check your answers")}>
            {error}
          </Alert>
        )}

        {step === 1 ? (
          <>
            <Alert tone="info">
              {t("These questions are what most rescues decide on. Answer honestly — a mismatch found now is far better than a pet returned in three months.")}
            </Alert>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("Your home")} required error={fieldErrors.homeType}>
                {({ id, invalid }) => (
                  <Select
                    id={id}
                    invalid={invalid}
                    value={form.homeType}
                    onChange={(e) => set("homeType", e.target.value as typeof form.homeType)}
                  >
                    <option value="HOUSE">{t("House")}</option>
                    <option value="APARTMENT">{t("Apartment")}</option>
                    <option value="FARM">{t("Farm or smallholding")}</option>
                    <option value="OTHER">{t("Something else")}</option>
                  </Select>
                )}
              </Field>

              <Field
                label={t("Hours alone on a typical day")}
                required
                hint={t("Be realistic, not aspirational.")}
                error={fieldErrors.hoursAloneDaily}
              >
                {({ id, invalid }) => (
                  <Input
                    id={id}
                    invalid={invalid}
                    type="number"
                    min={0}
                    max={24}
                    value={form.hoursAloneDaily}
                    onChange={(e) => set("hoursAloneDaily", Number(e.target.value))}
                  />
                )}
              </Field>
            </div>

            <div className="space-y-3">
              <Checkbox
                label={t("I have a secure garden or yard")}
                checked={form.hasYard}
                onChange={(e) => set("hasYard", e.target.checked)}
              />
              <Checkbox
                label={t("I already have other pets")}
                checked={form.hasOtherPets}
                onChange={(e) => set("hasOtherPets", e.target.checked)}
              />
              {form.hasOtherPets && (
                <Field label={t("Tell us about them")}>
                  {({ id }) => (
                    <Textarea
                      id={id}
                      rows={2}
                      maxLength={500}
                      value={form.otherPetsInfo}
                      onChange={(e) => set("otherPetsInfo", e.target.value)}
                      placeholder={t("Two neutered cats, 6 and 9, both used to dogs.")}
                    />
                  )}
                </Field>
              )}
              <Checkbox
                label={t("There are children in the home")}
                checked={form.hasChildren}
                onChange={(e) => set("hasChildren", e.target.checked)}
              />
              {form.hasChildren && (
                <Field label={t("Their ages")}>
                  {({ id }) => (
                    <Input
                      id={id}
                      maxLength={100}
                      value={form.childrenAges}
                      onChange={(e) => set("childrenAges", e.target.value)}
                      placeholder={t("4 and 9")}
                    />
                  )}
                </Field>
              )}
            </div>

            <Field label={t("Your experience with animals")} required>
              {({ id }) => (
                <Select
                  id={id}
                  value={form.experienceLevel}
                  onChange={(e) => set("experienceLevel", e.target.value as typeof form.experienceLevel)}
                >
                  <option value="FIRST_TIME">{t("This would be my first pet")}</option>
                  <option value="SOME">{t("I have had pets before")}</option>
                  <option value="EXPERIENCED">{t("I have kept this species for years")}</option>
                </Select>
              )}
            </Field>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={onClose}>
                {t("Cancel")}
              </Button>
              <Button onClick={() => setStep(2)} disabled={!canContinue}>
                {t("Continue")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <Field
              label={t("Pets you have had before")}
              hint={t("What happened to them is the question behind this one.")}
            >
              {({ id }) => (
                <Textarea
                  id={id}
                  rows={3}
                  maxLength={1000}
                  value={form.previousPets}
                  onChange={(e) => set("previousPets", e.target.value)}
                  placeholder={t("A collie cross from 2009 until she died of old age in 2022.")}
                />
              )}
            </Field>

            <Field
              label={t("Why {petName}?", { petName })}
              required
              hint={t("At least 50 characters. Say what your days look like and where they would fit.")}
              error={fieldErrors.motivation}
              trailing={`${form.motivation.length}/2000`}
            >
              {({ id, invalid }) => (
                <Textarea
                  id={id}
                  invalid={invalid}
                  rows={5}
                  maxLength={2000}
                  value={form.motivation}
                  onChange={(e) => set("motivation", e.target.value)}
                  placeholder={t("I work from home four days a week and walk every morning. {petName}'s description sounds like the quiet companion I am looking for, and I have the time to let her settle at her own pace.", { petName })}
                />
              )}
            </Field>

            {questions.map((question) => (
              <Field
                key={question.id}
                label={question.prompt}
                required={question.required}
                error={fieldErrors[`answers.${question.id}`]}
              >
                {({ id }) => (
                  <Textarea
                    id={id}
                    rows={2}
                    maxLength={1000}
                    value={answers[question.id] ?? ""}
                    onChange={(e) =>
                      setAnswers((a) => ({ ...a, [question.id]: e.target.value }))
                    }
                  />
                )}
              </Field>
            ))}

            <Checkbox
              label={t("I understand this is a long-term commitment")}
              hint={t("If my circumstances change, I will contact {petName}'s rescue rather than rehoming privately.", { petName })}
              checked={form.agreedToTerms}
              onChange={(e) => set("agreedToTerms", e.target.checked)}
            />

            <div className="flex justify-between gap-2 pt-1">
              <Button variant="ghost" onClick={() => setStep(1)}>
                {t("Back")}
              </Button>
              <Button
                onClick={() => void submit()}
                loading={submitting}
                loadingText={t("Sending…")}
                disabled={!canSubmit}
              >
                {t("Send application")}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
