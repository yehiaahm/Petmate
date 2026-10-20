import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/session";
import { safeRedirect } from "@/lib/validation/common";
import { LoginForm } from "@/components/auth/login-form";
import { getI18n } from "@/lib/i18n/server";
import { enabledOAuthProviders } from "@/lib/auth/oauth";
import { SocialSignIn } from "@/components/auth/social-sign-in";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("Sign in"), description: t("Sign in to your PetMate account."), robots: { index: false, follow: true } };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; registered?: string; verified?: string; reset?: string; oauth?: string; tf?: string }>;
}) {
  const [params, { t }] = await Promise.all([searchParams, getI18n()]);
  const next = safeRedirect(params.next, "/dashboard");

  // Already signed in: go where they were headed rather than showing a form
  // that would just bounce them.
  const auth = await getAuth();
  if (auth) redirect(next);

  // A fixed set of codes from the social sign-in callback; anything else is ignored.
  const oauthProblem: Record<string, string> = {
    expired: t("That sign-in took too long or was started in another browser. Try again."),
    provider: t("We could not confirm your account with that provider. Try again."),
    "no-email": t("Your account with that provider has no confirmed email address. Sign up with your email instead."),
    closed: t("This account cannot be signed in to. Contact support."),
    paused: t("New registrations are paused. Please check back soon."),
    cancelled: t("Sign-in was cancelled."),
  };
  const oauthNotice = params.oauth ? oauthProblem[params.oauth] : undefined;

  const notice = oauthNotice
    ? { tone: "info" as const, text: oauthNotice }
    : params.registered === "1"
      ? { tone: "success" as const, text: t("Account created. Check your inbox to confirm your email, then sign in.") }
      : params.verified === "1"
        ? { tone: "success" as const, text: t("Email confirmed. Sign in to continue.") }
        : params.reset === "1"
          ? { tone: "success" as const, text: t("Password changed. Sign in with your new password.") }
          : null;

  return (
    <>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">{t("Welcome back")}</h1>
      <p className="mt-1.5 text-sm text-fg-muted">
        {t("New here?")}{" "}
        <Link href={`/register${params.next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-brand hover:underline">
          {t("Create a free account")}
        </Link>
      </p>

      <div className="mt-8 space-y-5">
        {!params.tf && (
          <SocialSignIn
            providers={enabledOAuthProviders()}
            next={next}
            labels={{ google: t("Continue with Google"), facebook: t("Continue with Facebook"), or: t("or with your email") }}
          />
        )}
        <LoginForm next={next} notice={notice} initialChallenge={params.tf && params.tf.length <= 200 ? params.tf : null} />
      </div>
    </>
  );
}
