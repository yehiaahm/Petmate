import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
  title: t("Reset your password"),
  robots: { index: false, follow: true },
};
}

export default async function ForgotPasswordPage() {
  const { t } = await getI18n();
  return (
    <>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
        {t("Reset your password")}
      </h1>
      <p className="mt-1.5 text-sm text-fg-muted">
        {t("Enter your email and we will send you a link to choose a new one.")}
      </p>

      <div className="mt-8">
        <ForgotPasswordForm />
      </div>

      <p className="mt-6 text-center text-sm text-fg-muted">
        {t("Remembered it?")}{" "}
        <Link href="/login" className="font-semibold text-brand hover:underline">
          {t("Sign in")}
        </Link>
      </p>
    </>
  );
}
