"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Alert, Avatar, Card, CardHeader } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { LIMITS } from "@/lib/constants";

interface Profile {
  name: string;
  handle: string;
  email: string;
  bio: string | null;
  phone: string | null;
  avatarUrl: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  postalCode: string | null;
}

export function ProfileForm({ profile }: { profile: Profile }) {
  const router = useRouter();
  const toast = useToast();

  const [values, setValues] = useState({
    name: profile.name,
    handle: profile.handle,
    bio: profile.bio ?? "",
    country: profile.country ?? "",
    region: profile.region ?? "",
    city: profile.city ?? "",
    postalCode: profile.postalCode ?? "",
  });
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl);
  const [avatarFileId, setAvatarFileId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  async function uploadAvatar(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("purpose", "AVATAR");
      const { file: stored } = await api.upload<{ file: { id: string; url: string } }>(
        "/api/uploads",
        form,
      );
      setAvatarUrl(stored.url);
      setAvatarFileId(stored.id);
      // Not saved yet: the id is attached to the next profile save, so an
      // abandoned form does not change the avatar.
      toast.info("Photo ready", "Save your profile to apply it.");
    } catch (err) {
      toast.error(
        "That image was not accepted",
        err instanceof ApiError ? err.message : "Try a different file.",
      );
    } finally {
      setUploading(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post("/api/account", {
        action: "update-profile",
        name: values.name,
        handle: values.handle,
        bio: values.bio,
        country: values.country || undefined,
        region: values.region || undefined,
        city: values.city || undefined,
        postalCode: values.postalCode || undefined,
        ...(avatarFileId ? { avatarFileId } : {}),
      });
      toast.success("Profile saved");
      setAvatarFileId(null);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) setError(err);
      else toast.error("Could not save", "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const fieldError = (name: string) => error?.fieldError(name);

  return (
    <form onSubmit={save} className="space-y-5" noValidate>
      {error && !error.isValidation && <Alert tone="danger">{error.message}</Alert>}

      <Card>
        <CardHeader title="Public profile" description="Shown on your listings and reviews." />
        <div className="space-y-5 p-5">
          <div className="flex items-center gap-4">
            <Avatar src={avatarUrl} name={values.name || profile.name} size="lg" />
            <div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-[var(--radius-field)] border border-[var(--border-strong)] px-3 py-2 text-sm font-semibold text-fg hover:bg-bg-sunken">
                {uploading ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Camera className="size-4" aria-hidden />
                )}
                {uploading ? "Uploading…" : "Change photo"}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => void uploadAvatar(e.target.files)}
                  disabled={uploading}
                />
              </label>
              <p className="mt-1.5 text-xs text-fg-subtle">JPEG, PNG or WebP.</p>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Name" required error={fieldError("name")}>
              {({ id, invalid }) => (
                <Input
                  id={id}
                  invalid={invalid}
                  value={values.name}
                  onChange={(e) => set("name", e.target.value)}
                  autoComplete="name"
                  required
                />
              )}
            </Field>

            <Field
              label="Handle"
              required
              hint={`petmate.app/u/${values.handle || "your-handle"}`}
              error={fieldError("handle")}
            >
              {({ id, invalid }) => (
                <Input
                  id={id}
                  invalid={invalid}
                  value={values.handle}
                  onChange={(e) => set("handle", e.target.value.toLowerCase())}
                  required
                />
              )}
            </Field>
          </div>

          <Field
            label="About you"
            hint="Buyers read this. Breeders and rescues: say how long you have been doing this."
            error={fieldError("bio")}
            trailing={`${values.bio.length}/${LIMITS.bioMax}`}
          >
            {({ id, invalid }) => (
              <Textarea
                id={id}
                invalid={invalid}
                rows={4}
                maxLength={LIMITS.bioMax}
                value={values.bio}
                onChange={(e) => set("bio", e.target.value)}
              />
            )}
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Contact & location"
          description="Your city is public. Your street address, postcode and phone number are not."
        />
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <Field label="Email address" hint="To change it, contact support.">
            {({ id }) => <Input id={id} value={profile.email} readOnly disabled />}
          </Field>

          <Field label="City" error={fieldError("city")}>
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                value={values.city}
                onChange={(e) => set("city", e.target.value)}
                autoComplete="address-level2"
              />
            )}
          </Field>

          <Field label="Region or state" error={fieldError("region")}>
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                value={values.region}
                onChange={(e) => set("region", e.target.value)}
                autoComplete="address-level1"
              />
            )}
          </Field>

          <Field label="Country" error={fieldError("country")}>
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                value={values.country}
                onChange={(e) => set("country", e.target.value)}
                autoComplete="country-name"
              />
            )}
          </Field>

          <Field label="Postcode" error={fieldError("postalCode")}>
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                value={values.postalCode}
                onChange={(e) => set("postalCode", e.target.value)}
                autoComplete="postal-code"
              />
            )}
          </Field>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" loading={saving} loadingText="Saving…">
          Save changes
        </Button>
      </div>
    </form>
  );
}
