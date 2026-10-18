import type { Metadata } from "next";
import { requireAuth, hasRole } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { Alert, PageHeader } from "@/components/ui/primitives";
import { ResendVerification } from "@/components/auth/resend-verification";
import { ProviderForm, emptyProviderValues } from "@/components/care/provider-form";

export const metadata: Metadata = { title: "Register a pet care business", robots: { index: false, follow: false } };

export default async function NewProviderPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [auth, query] = await Promise.all([requireAuth(), searchParams]);
  const isAdmin = hasRole(auth.user, "ADMIN", "SUPER_ADMIN");
  const official = isAdmin && query.official === "1";

  const user = await db.user.findUniqueOrThrow({
    where: { id: auth.user.id },
    select: { email: true, city: true, country: true, currency: true },
  });

  const initial = { ...emptyProviderValues(user), official };

  return (
    <div className="container-page max-w-3xl py-8 lg:py-10">
      <PageHeader
        eyebrow={official ? "PetMate operations" : "For businesses"}
        title={official ? "Open a PetMate operation" : "Register your pet hotel or training school"}
        description={
          official
            ? "PetMate's own hotel or academy. It is live as soon as it is saved, carries the PetMate Official badge, and every booking is platform revenue."
            : "Free to list. You pay a commission only on completed bookings, and your payment is guaranteed once the job is done."
        }
      />
      {!auth.user.emailVerified ? (
        <Alert tone="warning" className="mt-8" title="Confirm your email first">
          <p>Businesses can only be registered from a confirmed account.</p>
          <div className="mt-2">
            <ResendVerification variant="outline" label="Resend the link" />
          </div>
        </Alert>
      ) : (
        <div className="mt-8">
          <ProviderForm mode="create" initial={initial} canMarkOfficial={isAdmin} />
        </div>
      )}
    </div>
  );
}
