"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Checkbox } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { api, ApiError } from "@/lib/api-client";
import { PasswordStrength, assessPasswordClient } from "@/components/auth/password-strength";
import { cn } from "@/lib/utils";

type Role = "USER" | "BREEDER" | "SELLER" | "CLINIC_ADMIN";

const ROLE_OPTIONS: { value: Role; label: string; description: string }[] = [
  { value: "USER", label: "I have pets", description: "Find, adopt, book vets, keep records" },
  { value: "BREEDER", label: "I breed", description: "Listings, breeding matches, litters" },
  { value: "SELLER", label: "I sell products", description: "Open a shop on the store" },
  { value: "CLINIC_ADMIN", label: "I run a clinic", description: "Take bookings, write records" },
];

/**
 * Registration.
 *
 * The strength meter mirrors the server's policy rather than inventing its
 * own, so the bar shown while typing is the bar that is actually enforced.
 */
export function RegisterForm({ next }: { next: string }) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("USER");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const strength = useMemo(
    () => assessPasswordClient(password, [name, email.split("@")[0] ?? ""]),
    [password, name, email],
  );

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    try {
      await api.post("/api/auth", {
        action: "register",
        name,
        email,
        password,
        role: role === "USER" ? undefined : role,
        acceptedTerms,
      });

      router.push(`/login?registered=1${next !== "/dashboard" ? `&next=${encodeURIComponent(next)}` : ""}`);
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
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {error && (
        <Alert tone="danger" title="Could not create your account">
          {error}
        </Alert>
      )}

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-fg">What brings you here?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {ROLE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setRole(option.value)}
              aria-pressed={role === option.value}
              className={cn(
                "relative rounded-[var(--radius-field)] border p-3 text-start transition-colors",
                role === option.value
                  ? "border-brand bg-brand-soft"
                  : "border-[var(--border-strong)] hover:border-[var(--border-strong)] hover:bg-bg-sunken",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-fg">{option.label}</span>
                {role === option.value && <Check className="size-4 shrink-0 text-brand" aria-hidden />}
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-fg-muted">
                {option.description}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-fg-subtle">
          You can add any of these later — one account does everything.
        </p>
      </fieldset>

      <Field label="Your name" required error={fieldErrors.name}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            name="name"
            autoComplete="name"
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={role === "CLINIC_ADMIN" ? "Dr Leila Farouk" : "Alex Morgan"}
          />
        )}
      </Field>

      <Field label="Email address" required error={fieldErrors.email}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        )}
      </Field>

      <Field
        label="Password"
        required
        error={fieldErrors.password}
        hint="At least 10 characters. Length beats symbols."
      >
        {({ id, describedBy, invalid }) => (
          <div className="space-y-2">
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              type={showPassword ? "text" : "password"}
              name="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              trailing={
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="rounded p-0.5 hover:text-fg"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                </button>
              }
            />

            <PasswordStrength
              password={password}
              context={[name, email.split("@")[0] ?? ""]}
            />
          </div>
        )}
      </Field>

      {/* The visible label contains links, which breaks the accessible name
          computation into "I agree to the and". An explicit aria-label keeps
          the announced text complete without changing what is on screen. */}
      <Checkbox
        aria-label="I agree to the terms of service and the privacy policy"
        label={
          <>
            I agree to the{" "}
            <Link href="/terms" className="font-medium text-brand underline">
              terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="font-medium text-brand underline">
              privacy policy
            </Link>
          </>
        }
        checked={acceptedTerms}
        onChange={(e) => setAcceptedTerms(e.target.checked)}
        required
      />
      {fieldErrors.acceptedTerms && (
        <p className="text-xs font-medium text-[var(--danger)]">{fieldErrors.acceptedTerms}</p>
      )}

      <Button
        type="submit"
        fullWidth
        size="lg"
        loading={submitting}
        loadingText="Creating your account…"
        disabled={!acceptedTerms || strength.problems.length > 0 || !name || !email}
      >
        Create free account
      </Button>
    </form>
  );
}
