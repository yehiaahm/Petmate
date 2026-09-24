"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { api, ApiError } from "@/lib/api-client";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [expired, setExpired] = useState(false);

  const mismatch = confirm.length > 0 && password !== confirm;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (mismatch) return;

    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    try {
      await api.post("/api/auth", { action: "reset-password", token, password });
      router.push("/login?reset=1");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (/invalid|expired|used/i.test(err.message)) setExpired(true);
        const map: Record<string, string> = {};
        for (const field of err.fields) map[field.field] = field.message;
        setFieldErrors(map);
      } else {
        setError("Something went wrong. Please try again.");
      }
      setSubmitting(false);
    }
  }

  if (expired) {
    return (
      <div className="space-y-4">
        <Alert tone="danger" title="That link is no longer valid">
          {error}
        </Alert>
        <Link
          href="/forgot-password"
          className="block text-center text-sm font-semibold text-brand hover:underline"
        >
          Request a new reset link
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}

      <Field
        label="New password"
        required
        hint="At least 10 characters."
        error={fieldErrors.password}
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            type={show ? "text" : "password"}
            autoComplete="new-password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            trailing={
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="rounded p-0.5 hover:text-fg"
                aria-label={show ? "Hide password" : "Show password"}
              >
                {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
              </button>
            }
          />
        )}
      </Field>

      <Field
        label="Confirm new password"
        required
        error={mismatch ? "Those passwords do not match." : null}
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            type={show ? "text" : "password"}
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        )}
      </Field>

      <Button
        type="submit"
        fullWidth
        size="lg"
        loading={submitting}
        loadingText="Saving…"
        disabled={mismatch || password.length < 10}
      >
        Change password
      </Button>
    </form>
  );
}
