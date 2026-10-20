import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Alert } from "@/components/ui/primitives";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
  title: t("Choose a new password"),
  robots: { index: false, follow: false },
};
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { t } = await getI18n();
  const { token } = await searchParams;

  if (!token) {
    return (
      <>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
          {t("Invalid reset link")}
        </h1>
        <div className="mt-6">
          <Alert tone="danger" title={t("That link is missing its token")}>
            {t("Reset links expire after an hour and can only be used once. Request a new one.")}
          </Alert>
        </div>
        <Link
          href="/forgot-password"
          className="mt-6 block text-center text-sm font-semibold text-brand hover:underline"
        >
          {t("Request a new link")}
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
        {t("Choose a new password")}
      </h1>
      <p className="mt-1.5 text-sm text-fg-muted">
        {t("Every other signed-in device will be signed out.")}
      </p>

      <div className="mt-8">
        <ResetPasswordForm token={token} />
      </div>
    </>
  );
}
