"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n/i18n-provider";

/**
 * Mirrors `assessPassword` in lib/auth/password.ts.
 *
 * It exists because the server module imports `server-only` and `node:crypto`,
 * so it cannot be bundled for the browser. Keeping the rules in exactly one
 * client module — rather than a copy inside each form — is what stops the two
 * from drifting: a policy change is a two-file edit, not an N-file hunt.
 */

const COMMON = new Set([
  "password", "123456", "123456789", "12345678", "qwerty", "abc123", "111111",
  "password1", "1234567", "letmein", "welcome", "monkey", "dragon", "sunshine",
  "princess", "football", "iloveyou", "admin", "login", "master", "qwerty123",
  "password123", "petmate", "petmate123", "changeme", "passw0rd", "trustno1",
]);

export interface PasswordAssessment {
  score: number;
  label: string;
  problems: string[];
}

export function assessPasswordClient(password: string, context: string[] = []): PasswordAssessment {
  const problems: string[] = [];
  const pw = password.normalize("NFKC");
  const lower = pw.toLowerCase();

  if (pw.length > 0 && pw.length < 10) problems.push("Use at least 10 characters.");
  if (COMMON.has(lower)) problems.push("That password appears in known breach lists.");
  if (pw.length > 0 && /^(.)\1+$/.test(pw)) problems.push("Avoid repeating a single character.");
  if (/^(0123456789|1234567890|abcdefghij|qwertyuiop)/.test(lower)) {
    problems.push("Avoid keyboard and number sequences.");
  }

  // Compared squashed as well as raw, so "Alex Morgan" also catches
  // "alexmorgan2024". A test on the server side covers the same case.
  const squashed = lower.replace(/[^a-z0-9]/g, "");
  const tokens = new Set<string>();
  for (const entry of context) {
    const value = entry?.toLowerCase().trim();
    if (!value) continue;
    tokens.add(value);
    tokens.add(value.replace(/[^a-z0-9]/g, ""));
    for (const part of value.split(/[^a-z0-9]+/)) {
      if (part.length >= 4) tokens.add(part);
    }
  }
  for (const token of tokens) {
    if (token.length >= 4 && (lower.includes(token) || squashed.includes(token))) {
      problems.push("Do not include your name or email in your password.");
      break;
    }
  }

  let score = 0;
  if (pw.length >= 10) score++;
  if (pw.length >= 14) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  if (problems.length) score = Math.min(score, 1);

  const labels = ["Too weak", "Weak", "Fair", "Strong", "Excellent"] as const;
  return { score, label: labels[Math.max(0, Math.min(4, score))]!, problems };
}

export function PasswordStrength({
  password,
  context = [],
  className,
}: {
  password: string;
  context?: string[];
  className?: string;
}) {
  const { t } = useI18n();
  const strength = useMemo(() => assessPasswordClient(password, context), [password, context]);

  if (!password) return null;

  return (
    <div className={className}>
      <div className="flex gap-1" role="img" aria-label={t("Password strength: {label}", { label: t(strength.label) })}>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              i < strength.score
                ? strength.score <= 1
                  ? "bg-[var(--danger)]"
                  : strength.score === 2
                    ? "bg-[var(--warning)]"
                    : "bg-[var(--success)]"
                : "bg-[var(--border-strong)]",
            )}
          />
        ))}
      </div>
      <p
        className={cn(
          "mt-1.5 text-xs",
          strength.problems.length ? "text-[var(--warning)]" : "text-fg-muted",
        )}
      >
        {t(strength.problems[0] ?? strength.label)}
      </p>
    </div>
  );
}
