import type { Metadata } from "next";
import { CheckCircle2, XCircle } from "lucide-react";
import { verifyEmail } from "@/lib/services/auth.service";
import { isAppError } from "@/lib/errors";
import { ButtonLink } from "@/components/ui/button";
import { ResendVerification } from "@/components/auth/resend-verification";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
  title: t("Confirm your email"),
  robots: { index: false, follow: false },
};
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { t } = await getI18n();
  const { token } = await searchParams;

  if (!token) {
    return (
      <Result
        ok={false}
        title={t("Missing confirmation token")}
        body={t("That link looks incomplete. Open the link from your email again, or request a new one.")}
      />
    );
  }

  // Verification is a one-shot server action; doing it here means the link
  // works from any mail client without JavaScript.
  //
  // The try/catch resolves to plain data and the JSX is built after it. React
  // may retry a render, and JSX constructed inside a catch block hides the
  // error from an error boundary that should have seen it.
  let outcome: { ok: boolean; title: string; body: string };
  try {
    await verifyEmail(token);
    outcome = {
      ok: true,
      title: "Email confirmed",
      body: "Your account is verified. You can message sellers, list a pet and make purchases.",
    };
  } catch (error) {
    outcome = {
      ok: false,
      title: "That link did not work",
      body: isAppError(error)
        ? error.message
        : "Something went wrong confirming your email. Request a new link.",
    };
  }

  return <Result ok={outcome.ok} title={outcome.title} body={outcome.body} />;
}

async function Result({ ok, title, body }: { ok: boolean; title: string; body: string }) {
  const { t } = await getI18n();
  return (
    <div className="text-center">
      <div
        className={`mx-auto flex size-12 items-center justify-center rounded-full ${
          ok ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--danger-soft)] text-[var(--danger)]"
        }`}
      >
        {ok ? <CheckCircle2 className="size-6" aria-hidden /> : <XCircle className="size-6" aria-hidden />}
      </div>

      <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight text-fg">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-fg-muted">{body}</p>

      <div className="mt-8 space-y-3">
        {ok ? (
          <ButtonLink href="/login?verified=1" fullWidth size="lg">
            {t("Sign in")}
          </ButtonLink>
        ) : (
          <>
            <ResendVerification />
            <ButtonLink href="/login" variant="outline" fullWidth>
              {t("Back to sign in")}
            </ButtonLink>
          </>
        )}
      </div>
    </div>
  );
}
