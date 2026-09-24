"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { api, ApiError } from "@/lib/api-client";

export function LoginForm({
  next,
  notice,
}: {
  next: string;
  notice: { tone: "success" | "info"; text: string } | null;
}) {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    try {
      await api.post("/api/auth", { action: "login", email, password });

      // A full refresh so every server component picks up the new session.
      router.push(next);
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
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      {error && (
        <Alert tone="danger" title="Could not sign in">
          {error}
        </Alert>
      )}

      <Field label="Email address" required error={fieldErrors.email}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            type="email"
            name="email"
            autoComplete="email"
            autoFocus
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
        trailing={
          <Link href="/forgot-password" className="text-brand hover:underline">
            Forgot it?
          </Link>
        }
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            type={showPassword ? "text" : "password"}
            name="password"
            autoComplete="current-password"
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
        )}
      </Field>

      <Button type="submit" fullWidth size="lg" loading={submitting} loadingText="Signing in…">
        Sign in
      </Button>

      <p className="text-center text-xs leading-relaxed text-fg-subtle">
        By signing in you agree to our{" "}
        <Link href="/terms" className="underline hover:text-fg-muted">
          terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline hover:text-fg-muted">
          privacy policy
        </Link>
        .
      </p>
    </form>
  );
}
