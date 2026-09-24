import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Stethoscope, Info } from "lucide-react";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/rbac";
import { getHealthTimeline, listVaccines, healthScoreLabel } from "@/lib/services/health.service";
import { Breadcrumbs, PageHeader, Card, StatusPill, Alert } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { HealthTimeline } from "@/components/pets/health-timeline";
import type { Species } from "@/lib/constants";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const pet = await db.pet.findUnique({ where: { id }, select: { name: true } });
  return {
    title: pet ? `${pet.name} — health record` : "Health record",
    robots: { index: false, follow: false },
  };
}

export default async function PetHealthPage({ params }: { params: Params }) {
  const { id } = await params;
  const auth = await requireAuth();

  // Throws 404 for anyone who is not the owner, staff, or a clinic that has
  // treated this animal.
  const timeline = await getHealthTimeline(id, auth);
  if (!timeline) notFound();

  const vaccines = await listVaccines(timeline.pet.species as Species);
  const health = healthScoreLabel(timeline.pet.healthScore);

  return (
    <div className="container-page max-w-4xl py-8">
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "My pets", href: "/dashboard/pets" },
          { label: timeline.pet.name, href: `/dashboard/pets/${id}` },
          { label: "Health" },
        ]}
      />

      <PageHeader
        eyebrow="Lifelong record"
        title={`${timeline.pet.name}'s health record`}
        description="This record follows the animal for life. If they are ever rehomed or sold through PetMate, it goes with them."
        action={
          <ButtonLink href="/clinics" variant="outline">
            <Stethoscope className="size-4" aria-hidden />
            Book a vet
          </ButtonLink>
        }
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Documentation
          </p>
          <p className="mt-1 font-display text-2xl font-semibold tabular text-fg">
            {timeline.pet.healthScore}
          </p>
          <StatusPill tone={health.tone} className="mt-1.5">
            {health.label}
          </StatusPill>
        </Card>

        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Clinic verified
          </p>
          <p className="mt-1 font-display text-2xl font-semibold tabular text-fg">
            {timeline.summary.clinicVerifiedCount}
          </p>
          <p className="mt-1.5 text-xs text-fg-muted">
            of {timeline.records.length} {timeline.records.length === 1 ? "entry" : "entries"}
          </p>
        </Card>

        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">Overdue</p>
          <p
            className={`mt-1 font-display text-2xl font-semibold tabular ${
              timeline.summary.overdueCount > 0 ? "text-[var(--danger)]" : "text-fg"
            }`}
          >
            {timeline.summary.overdueCount}
          </p>
          <p className="mt-1.5 text-xs text-fg-muted">
            {timeline.summary.vaccinationsUpToDate ? "Vaccinations current" : "Check vaccinations"}
          </p>
        </Card>
      </div>

      {timeline.summary.ownerReportedCount > 0 && timeline.summary.clinicVerifiedCount === 0 && (
        <div className="mt-5">
          <Alert tone="info" icon={<Info className="size-4" aria-hidden />}>
            Every entry here is self-reported. Booking through PetMate means the clinic writes
            directly into this record, and those entries carry a verified mark that buyers trust.
          </Alert>
        </div>
      )}

      <div className="mt-8">
        <HealthTimeline
          petId={id}
          petName={timeline.pet.name}
          records={timeline.records}
          reminders={timeline.reminders}
          vaccines={vaccines}
        />
      </div>
    </div>
  );
}
