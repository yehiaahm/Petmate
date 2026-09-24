import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/rbac";
import { getSettings } from "@/lib/settings";
import { bpsToPercent } from "@/lib/money";
import { ClinicRegistration } from "@/components/clinics/clinic-registration";
import { PageHeader, Breadcrumbs, Alert } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Register a clinic",
  robots: { index: false, follow: false },
};

export default async function NewClinicPage() {
  const auth = await requireAuth();
  const settings = await getSettings();

  return (
    <div className="container-page max-w-2xl py-8 lg:py-10">
      <Breadcrumbs
        items={[
          { label: "Clinic console", href: "/clinic" },
          { label: "Register" },
        ]}
      />

      <PageHeader
        title="Register your clinic"
        description="A person checks your registration number before the clinic goes live. That check is the whole reason the clinic-verified badge on a health record means anything."
      />

      <Alert tone="info" className="mt-6" title="What it costs">
        <p className="mt-1 leading-relaxed">
          Nothing to register and no monthly fee. PetMate takes{" "}
          {bpsToPercent(settings.commissionAppointmentBps)} of each completed booking. Writing
          health records is free and always will be.
        </p>
      </Alert>

      <div className="mt-6">
        <ClinicRegistration
          defaultEmail={auth.user.email}
          defaultCity={auth.user.city}
          defaultCountry={auth.user.country}
        />
      </div>
    </div>
  );
}
