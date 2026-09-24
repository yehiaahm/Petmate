"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { useI18n } from "@/components/i18n/i18n-provider";
import { api, ApiError } from "@/lib/api-client";

export function LoginForm({
  next,
  notice,
}: {
  next: string;
  notice: { tone: "success" | "info"; text: string } | null;
}) {
  const { t } = useI18n();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function fail(err: unknown) {
    if (err instanceof ApiError) {
      setError(err.message);
      const map: Record<string, string> = {};
      for (const field of err.fields) map[field.field] = field.message;
      setFieldErrors(map);
    } else {
      setError(t("Something went wrong. Please try again."));
    }
    setSubmitting(false);
  }

  function done() {
    // A full refresh so every server component picks up the new session.
    router.push(next);
    router.refresh();
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    try {
      const result = await api.post<{ twoFactorRequired?: boolean; challenge?: string }>("/api/auth", {
        action: "login",
        email,
        password,
      });
      if (result.twoFactorRequired && result.challenge) {
        setChallenge(result.challenge);
        setPassword("");
        setSubmitting(false);
        return;
      }
      done();
    } catch (err) {
      fail(err);
    }
  }

  async function onSubmitCode(event: React.FormEvent) {
    event.preventDefault();
    if (!challenge) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/api/auth", { action: "login-2fa", challenge, code });
      done();
    } catch (err) {
      // An expired or exhausted challenge sends them back to the password.
      if (err instanceof ApiError && /password again/i.test(err.message)) setChallenge(null);
      fail(err);
    }
  }

  if (challenge) {
    return (
      <form onSubmit={onSubmitCode} className="space-y-5" noValidate>
        <Alert tone="info" icon={<ShieldCheck className="size-4" aria-hidden />} title={t("Two-step sign-in")}>
          {useBackup
            ? t("Enter one of the backup codes you saved when you turned on two-step sign-in.")
            : t("Open your authenticator app and enter the six-digit code for PetMate.")}
        </Alert>

        {error && (
          <Alert tone="danger" title={t("Could not sign in")}>
            {error}
          </Alert>
        )}

        <Field label={useBackup ? t("Backup code") : t("Code")} required>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              autoFocus
              dir="ltr"
              inputMode={useBackup ? "text" : "numeric"}
              autoComplete="one-time-code"
              maxLength={useBackup ? 11 : 7}
              value={code}
              onChange={(e) => setCode(useBackup ? e.target.value : e.target.value.replace(/[^\d ]/g, ""))}
              className="tracking-widest"
              placeholder={useBackup ? "abcde-12345" : "123 456"}
            />
          )}
        </Field>

        <Button type="submit" fullWidth size="lg" loading={submitting} loadingText={t("Checking…")} disabled={code.trim().length < 6}>
          {t("Verify and sign in")}
        </Button>

        <div className="flex flex-wrap justify-between gap-2 text-sm">
          <button
            type="button"
            className="text-brand hover:underline"
            onClick={() => {
              setUseBackup((b) => !b);
              setCode("");
            }}
          >
            {useBackup ? t("Use the authenticator app instead") : t("Lost your phone? Use a backup code")}
          </button>
          <button
            type="button"
            className="text-fg-muted hover:underline"
            onClick={() => {
              setChallenge(null);
              setCode("");
              setError(null);
            }}
          >
            {t("Start again")}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      {error && (
        <Alert tone="danger" title={t("Could not sign in")}>
          {error}
        </Alert>
      )}

      <Field label={t("Email address")} required error={fieldErrors.email}>
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
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        )}
      </Field>

      <Field
        label={t("Password")}
        required
        error={fieldErrors.password}
        trailing={
          <Link href="/forgot-password" className="text-brand hover:underline">
            {t("Forgot it?")}
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
                aria-label={showPassword ? t("Hide password") : t("Show password")}
              >
                {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
              </button>
            }
          />
        )}
      </Field>

      <Button type="submit" fullWidth size="lg" loading={submitting} loadingText={t("Signing in…")}>
        {t("Sign in")}
      </Button>

      <p className="text-center text-xs leading-relaxed text-fg-subtle">
        {t("By signing in you agree to our")}{" "}
        <Link href="/terms" className="underline hover:text-fg-muted">
          {t("terms")}
        </Link>{" "}
        {t("and")}{" "}
        <Link href="/privacy" className="underline hover:text-fg-muted">
          {t("privacy policy")}
        </Link>
        .
      </p>
    </form>
  );
}
