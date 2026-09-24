import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { safeRedirect } from "@/lib/validation/common";
import { RegisterForm } from "@/components/auth/register-form";
import { Alert } from "@/components/ui/primitives";
import { getI18n } from "@/lib/i18n/server";
import { enabledOAuthProviders } from "@/lib/auth/oauth";
import { SocialSignIn } from "@/components/auth/social-sign-in";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t("Create your free account"),
    description: t("Join PetMate to find, adopt and care for pets with verified health records, escrow-protected purchases and vet booking in one place."),
    alternates: { canonical: "/register" },
  };
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [params, { t }] = await Promise.all([searchParams, getI18n()]);
  const next = safeRedirect(params.next, "/dashboard");

  const auth = await getAuth();
  if (auth) redirect(next);

  const settings = await getSettings();

  return (
    <>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
        {t("Create your account")}
      </h1>
      <p className="mt-1.5 text-sm text-fg-muted">
        {t("Already have one?")}{" "}
        <Link
          href={`/login${params.next ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="font-semibold text-brand hover:underline"
        >
          {t("Sign in")}
        </Link>
      </p>

      <div className="mt-8">
        {settings.registrationOpen ? (
          <div className="space-y-5">
            <SocialSignIn
              providers={enabledOAuthProviders()}
              next={next}
              labels={{ google: t("Sign up with Google"), facebook: t("Sign up with Facebook"), or: t("or with your email") }}
            />
            <RegisterForm next={next} />
          </div>
        ) : (
          <Alert tone="warning" title={t("Registrations are paused")}>
            {t("We are not taking new accounts at the moment. Please check back soon.")}
          </Alert>
        )}
      </div>
    </>
  );
}
