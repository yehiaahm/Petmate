import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Alert } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
          Invalid reset link
        </h1>
        <div className="mt-6">
          <Alert tone="danger" title="That link is missing its token">
            Reset links expire after an hour and can only be used once. Request a new one.
          </Alert>
        </div>
        <Link
          href="/forgot-password"
          className="mt-6 block text-center text-sm font-semibold text-brand hover:underline"
        >
          Request a new link
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
        Choose a new password
      </h1>
      <p className="mt-1.5 text-sm text-fg-muted">
        Every other signed-in device will be signed out.
      </p>

      <div className="mt-8">
        <ResetPasswordForm token={token} />
      </div>
    </>
  );
}
