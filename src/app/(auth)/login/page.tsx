import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/session";
import { safeRedirect } from "@/lib/validation/common";
import { LoginForm } from "@/components/auth/login-form";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("Sign in"), description: t("Sign in to your PetMate account."), robots: { index: false, follow: true } };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; registered?: string; verified?: string; reset?: string }>;
}) {
  const [params, { t }] = await Promise.all([searchParams, getI18n()]);
  const next = safeRedirect(params.next, "/dashboard");

  // Already signed in: go where they were headed rather than showing a form
  // that would just bounce them.
  const auth = await getAuth();
  if (auth) redirect(next);

  const notice =
    params.registered === "1"
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

      <div className="mt-8">
        <LoginForm next={next} notice={notice} />
      </div>
    </>
  );
}
