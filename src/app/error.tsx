"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCw, Home, LifeBuoy } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button, ButtonLink } from "@/components/ui/button";
import { reportClientError } from "@/components/monitoring/error-reporter";
import { useI18n } from "@/components/i18n/i18n-provider";

/**
 * Application error boundary.
 *
 * Never shows the user a stack trace or an internal message. `digest` is the
 * one thing worth showing: it is the id that ties what they saw to the entry in
 * our server logs, so support can actually find it.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();
  useEffect(() => {
    // The server already logged it; this records that a user actually saw it.
    console.error("Client error boundary:", error.digest ?? error.message);
    reportClientError(error, "boundary", error.digest);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="container-page py-6">
        <Link href="/" aria-label={t("PetMate home")}>
          <Logo size="sm" />
        </Link>
      </header>

      <main id="main" className="container-page flex flex-1 items-center justify-center py-16">
        <div className="max-w-md text-center">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
            {t("Something went wrong on our side")}
          </h1>

          <p className="mt-3 text-[15px] leading-relaxed text-fg-muted">
            {t("This is not your fault. The problem has been logged and we can see it. Trying again often works, because most of these are temporary.")}
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button onClick={reset}>
              <RotateCw className="size-4" aria-hidden />
              {t("Try again")}
            </Button>
            <ButtonLink href="/" variant="outline">
              <Home className="size-4" aria-hidden />
              {t("Go home")}
            </ButtonLink>
          </div>

          {error.digest && (
            <p className="mt-8 border-t border-[var(--border)] pt-6 text-xs text-fg-subtle">
              {t("Reference")}{" "}
              <code className="rounded bg-bg-sunken px-1.5 py-0.5 font-mono">{error.digest}</code>
              <br />
              {t("Quote this if you contact us and we can find exactly what happened.")}
            </p>
          )}

          <p className="mt-4 text-sm">
            <Link
              href="/support"
              className="inline-flex items-center gap-1.5 text-brand hover:underline"
            >
              <LifeBuoy className="size-3.5" aria-hidden />
              {t("Contact support")}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
