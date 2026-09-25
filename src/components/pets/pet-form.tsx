"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload, X } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea, Checkbox } from "@/components/ui/field";
import { Card, Alert } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  SPECIES,
  SPECIES_LABEL,
  SEX,
  TEMPERAMENT_TAGS,
  LIMITS,
  type Species,
} from "@/lib/constants";
import { useI18n } from "@/components/i18n/i18n-provider";

interface Breed {
  id: string;
  name: string;
  species: string;
}

interface PetFormValues {
  name: string;
  species: Species;
  breedId: string;
  breedText: string;
  sex: "MALE" | "FEMALE" | "UNKNOWN";
  birthDate: string;
  birthDateIsEstimate: boolean;
  weightKg: string;
  color: string;
  description: string;
  microchipId: string;
  isNeutered: boolean;
  temperament: string[];
  city: string;
  country: string;
}

/**
 * Pet create/edit form.
 *
 * Photos upload as they are chosen rather than on submit, so a slow connection
 * does not lose the whole form, and the user sees progress instead of a frozen
 * button.
 */
export function PetForm({
  breeds,
  initial,
  petId,
  defaultCity,
  defaultCountry,
}: {
  breeds: Breed[];
  initial?: Partial<PetFormValues>;
  petId?: string;
  defaultCity?: string | null;
  defaultCountry?: string | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();

  const [values, setValues] = useState<PetFormValues>({
    name: initial?.name ?? "",
    species: initial?.species ?? "DOG",
    breedId: initial?.breedId ?? "",
    breedText: initial?.breedText ?? "",
    sex: initial?.sex ?? "FEMALE",
    birthDate: initial?.birthDate ?? "",
    birthDateIsEstimate: initial?.birthDateIsEstimate ?? false,
    weightKg: initial?.weightKg ?? "",
    color: initial?.color ?? "",
    description: initial?.description ?? "",
    microchipId: initial?.microchipId ?? "",
    isNeutered: initial?.isNeutered ?? false,
    temperament: initial?.temperament ?? [],
    city: initial?.city ?? defaultCity ?? "",
    country: initial?.country ?? defaultCountry ?? "",
  });

  const [photos, setPhotos] = useState<{ id: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const speciesBreeds = breeds.filter((b) => b.species === values.species);

  function set<K extends keyof PetFormValues>(key: K, value: PetFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  // Changing species invalidates a breed belonging to the old one. Adjusting
  // during render rather than in an effect means the select never paints with
  // a breed that is not in its own option list.
  if (values.breedId && !speciesBreeds.some((b) => b.id === values.breedId)) {
    setValues((v) => ({ ...v, breedId: "" }));
  }

  async function uploadPhotos(files: FileList | null) {
    if (!files?.length) return;

    if (photos.length + files.length > LIMITS.photosPerPet) {
      toast.error(`Up to ${LIMITS.photosPerPet} photos`, t("Remove one before adding more."));
      return;
    }

    setUploading(true);
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      form.append("purpose", "PET_PHOTO");

      try {
        const { file: stored } = await api.upload<{ file: { id: string; url: string } }>(
          "/api/uploads",
          form,
        );
        setPhotos((p) => [...p, stored]);
      } catch (err) {
        toast.error(
          t("That photo was not accepted"),
          err instanceof ApiError ? err.message : "Please try a different image.",
        );
      }
    }
    setUploading(false);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    const payload = {
      name: values.name,
      species: values.species,
      breedId: values.breedId || undefined,
      breedText: values.breedText || undefined,
      sex: values.sex,
      birthDate: values.birthDate || undefined,
      birthDateIsEstimate: values.birthDateIsEstimate,
      weightKg: values.weightKg ? Number(values.weightKg) : undefined,
      color: values.color || undefined,
      description: values.description || undefined,
      microchipId: values.microchipId || undefined,
      isNeutered: values.isNeutered,
      temperament: values.temperament.length ? values.temperament : undefined,
      city: values.city || undefined,
      country: values.country || undefined,
    };

    try {
      const result = petId
        ? await api.patch<{ pet: { id: string } }>(`/api/pets/${petId}`, payload)
        : await api.post<{ pet: { id: string } }>("/api/pets", payload);

      const id = result.pet.id;

      // Attach photos after the pet exists, so a failed create never orphans them.
      for (const photo of photos) {
        await api
          .post(`/api/pets/${id}/photos`, { fileId: photo.id })
          .catch(() => toast.error(t("A photo could not be attached"), t("You can add it again later.")));
      }

      toast.success(petId ? "Changes saved" : `${values.name} added`);
      router.push(`/dashboard/pets/${id}`);
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
    <form onSubmit={submit} className="space-y-6" noValidate>
      {error && (
        <Alert tone="danger" title={t("Check the form")}>
          {error}
        </Alert>
      )}

      <Card className="p-5">
        <h2 className="font-display text-lg font-semibold text-fg">{t("The basics")}</h2>
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Name")} required error={fieldErrors.name}>
              {({ id, invalid }) => (
                <Input
                  id={id}
                  invalid={invalid}
                  required
                  maxLength={80}
                  autoFocus
                  value={values.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder={t("Maple")}
                />
              )}
            </Field>

            <Field label={t("Species")} required error={fieldErrors.species}>
              {({ id }) => (
                <Select
                  id={id}
                  value={values.species}
                  onChange={(e) => set("species", e.target.value as Species)}
                >
                  {SPECIES.map((species) => (
                    <option key={species} value={species}>
                      {t(SPECIES_LABEL[species])}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t("Breed")}
              hint={speciesBreeds.length ? undefined : t("No catalogue breeds for this species yet.")}
              error={fieldErrors.breedId}
            >
              {({ id }) => (
                <Select id={id} value={values.breedId} onChange={(e) => set("breedId", e.target.value)}>
                  <option value="">{t("Not listed / mixed")}</option>
                  {speciesBreeds.map((breed) => (
                    <option key={breed.id} value={breed.id}>
                      {breed.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            {!values.breedId && (
              <Field label={t("Breed description")} hint={t("For a mix or a breed not in the list.")}>
                {({ id }) => (
                  <Input
                    id={id}
                    maxLength={80}
                    value={values.breedText}
                    onChange={(e) => set("breedText", e.target.value)}
                    placeholder={t("Collie cross")}
                  />
                )}
              </Field>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Sex")} required>
              {({ id }) => (
                <Select
                  id={id}
                  value={values.sex}
                  onChange={(e) => set("sex", e.target.value as PetFormValues["sex"])}
                >
                  {SEX.map((sex) => (
                    <option key={sex} value={sex}>
                      {sex === "MALE" ? t("Male") : sex === "FEMALE" ? t("Female") : t("Unknown")}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              label={t("Date of birth")}
              hint={t("An estimate is better than nothing.")}
              error={fieldErrors.birthDate}
            >
              {({ id, invalid }) => (
                <div className="space-y-2">
                  <Input
                    id={id}
                    invalid={invalid}
                    type="date"
                    max={new Date().toISOString().slice(0, 10)}
                    value={values.birthDate}
                    onChange={(e) => set("birthDate", e.target.value)}
                  />
                  <Checkbox
                    label={t("This is an estimate")}
                    checked={values.birthDateIsEstimate}
                    onChange={(e) => set("birthDateIsEstimate", e.target.checked)}
                  />
                </div>
              )}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Weight (kg)")} error={fieldErrors.weightKg}>
              {({ id, invalid }) => (
                <Input
                  id={id}
                  invalid={invalid}
                  type="number"
                  step="0.1"
                  min="0"
                  max="2000"
                  value={values.weightKg}
                  onChange={(e) => set("weightKg", e.target.value)}
                />
              )}
            </Field>

            <Field label={t("Colour or markings")}>
              {({ id }) => (
                <Input
                  id={id}
                  maxLength={60}
                  value={values.color}
                  onChange={(e) => set("color", e.target.value)}
                  placeholder={t("Golden, white chest")}
                />
              )}
            </Field>
          </div>

          <Checkbox
            label={t("Neutered or spayed")}
            checked={values.isNeutered}
            onChange={(e) => set("isNeutered", e.target.checked)}
          />
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-display text-lg font-semibold text-fg">{t("Photos")}</h2>
        <p className="mt-1 text-sm text-fg-muted">
          {t("Up to {count}. The first becomes the main photo.", { count: LIMITS.photosPerPet })}
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          {photos.map((photo, index) => (
            <div
              key={photo.id}
              className="group relative size-24 overflow-hidden rounded-[var(--radius-field)] border border-[var(--border)]"
            >
              <Image src={photo.url} alt="" fill sizes="96px" className="object-cover" />
              {index === 0 && (
                <span className="absolute start-1 top-1 rounded-full bg-brand px-1.5 py-0.5 text-[9px] font-bold text-brand-fg">
                  {t("MAIN")}
                </span>
              )}
              <button
                type="button"
                onClick={() => setPhotos((p) => p.filter((x) => x.id !== photo.id))}
                className="absolute end-1 top-1 rounded-full bg-[var(--overlay)] p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={t("Remove photo")}
              >
                <X className="size-3" aria-hidden />
              </button>
            </div>
          ))}

          {photos.length < LIMITS.photosPerPet && (
            <label
              className={cn(
                "flex size-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--radius-field)] border border-dashed border-[var(--border-strong)] text-fg-subtle transition-colors hover:border-brand hover:text-brand",
                uploading && "pointer-events-none opacity-60",
              )}
            >
              {uploading ? (
                <Loader2 className="size-5 animate-spin" aria-hidden />
              ) : (
                <Upload className="size-5" aria-hidden />
              )}
              <span className="text-[10px] font-medium">{uploading ? t("Uploading") : t("Add")}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="sr-only"
                onChange={(e) => {
                  void uploadPhotos(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-display text-lg font-semibold text-fg">{t("Character")}</h2>

        <div className="mt-4 space-y-4">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-fg">
              {t("Temperament")}{" "}
              <span className="font-normal text-fg-subtle">{t("(up to 6)")}</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {TEMPERAMENT_TAGS.map((tag) => {
                const active = values.temperament.includes(tag);
                const full = values.temperament.length >= 6 && !active;
                return (
                  <button
                    key={tag}
                    type="button"
                    disabled={full}
                    aria-pressed={active}
                    onClick={() =>
                      set(
                        "temperament",
                        active
                          ? values.temperament.filter((x) => x !== tag)
                          : [...values.temperament, tag],
                      )
                    }
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm transition-colors disabled:opacity-40",
                      active
                        ? "border-transparent bg-brand-soft font-medium text-brand-soft-fg"
                        : "border-[var(--border)] text-fg-muted hover:border-[var(--border-strong)] hover:text-fg",
                    )}
                  >
                    {t(tag)}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <Field
            label={t("About them")}
            hint={t("Routine, habits, what they are like to live with.")}
            trailing={`${values.description.length}/${LIMITS.descriptionMax}`}
          >
            {({ id }) => (
              <Textarea
                id={id}
                rows={4}
                maxLength={LIMITS.descriptionMax}
                value={values.description}
                onChange={(e) => set("description", e.target.value)}
              />
            )}
          </Field>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-display text-lg font-semibold text-fg">{t("Identification")}</h2>
        <p className="mt-1 text-sm text-fg-muted">
          {t("A microchip number is the strongest proof of ownership there is. It is never shown publicly.")}
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label={t("Microchip number")} error={fieldErrors.microchipId}>
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                maxLength={30}
                value={values.microchipId}
                onChange={(e) => set("microchipId", e.target.value)}
                placeholder="981020012345678"
              />
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("City")}>
              {({ id }) => (
                <Input
                  id={id}
                  maxLength={80}
                  value={values.city}
                  onChange={(e) => set("city", e.target.value)}
                />
              )}
            </Field>
            <Field label={t("Country")}>
              {({ id }) => (
                <Input
                  id={id}
                  maxLength={60}
                  value={values.country}
                  onChange={(e) => set("country", e.target.value)}
                />
              )}
            </Field>
          </div>
        </div>
      </Card>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          {t("Cancel")}
        </Button>
        <Button
          type="submit"
          size="lg"
          loading={submitting}
          loadingText={t("Saving…")}
          disabled={!values.name.trim()}
        >
          {petId ? t("Save changes") : t("Add pet")}
        </Button>
      </div>
    </form>
  );
}
