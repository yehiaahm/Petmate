import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { safeRedirect } from "@/lib/validation/common";
import { RegisterForm } from "@/components/auth/register-form";
import { Alert } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Create your free account",
  description:
    "Join PetMate to find, adopt and care for pets with verified health records, escrow-protected purchases and vet booking in one place.",
  alternates: { canonical: "/register" },
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = safeRedirect(params.next, "/dashboard");

  const auth = await getAuth();
  if (auth) redirect(next);

  const settings = await getSettings();

  return (
    <>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
        Create your account
      </h1>
      <p className="mt-1.5 text-sm text-fg-muted">
        Already have one?{" "}
        <Link
          href={`/login${params.next ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="font-semibold text-brand hover:underline"
        >
          Sign in
        </Link>
      </p>

      <div className="mt-8">
        {settings.registrationOpen ? (
          <RegisterForm next={next} />
        ) : (
          <Alert tone="warning" title="Registrations are paused">
            We are not taking new accounts at the moment. Please check back soon.
          </Alert>
        )}
      </div>
    </>
  );
}
