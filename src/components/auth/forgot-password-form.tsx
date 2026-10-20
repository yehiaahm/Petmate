"use client";

import { useState } from "react";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { api, ApiError } from "@/lib/api-client";
import { useI18n } from "@/components/i18n/i18n-provider";
import { RichText } from "@/components/i18n/rich-text";

export function ForgotPasswordForm() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await api.post("/api/auth", { action: "forgot-password", email });
      // The server answers identically whether or not the address exists, and
      // so does this screen. Confirming an address here would be a free
      // account-enumeration tool.
      setSent(true);
    } catch (err) {
      // Only a rate limit or a malformed address reaches here.
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[var(--success-soft)] text-[var(--success)]">
          <MailCheck className="size-6" aria-hidden />
        </div>
        <h2 className="font-display text-lg font-semibold text-fg">{t("Check your inbox")}</h2>
        <p className="text-sm leading-relaxed text-fg-muted">
          <RichText
            text={t("If {email} has a PetMate account, a reset link is on its way. It expires in one hour and can only be used once.")}
            values={{ email: <span className="font-medium text-fg">{email}</span> }}
          />
        </p>
        <Button variant="outline" fullWidth onClick={() => setSent(false)}>
          {t("Use a different address")}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}

      <Field label={t("Email address")} required>
        {({ id, invalid }) => (
          <Input
            id={id}
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

      <Button type="submit" fullWidth size="lg" loading={submitting} loadingText={t("Sending…")}>
        {t("Send reset link")}
      </Button>
    </form>
  );
}
