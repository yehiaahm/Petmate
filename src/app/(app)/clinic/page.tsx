import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Stethoscope, Plus, Clock, AlertTriangle } from "lucide-react";
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { PageHeader, Card, Badge, EmptyState, Alert } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
  title: t("Clinic console"),
  robots: { index: false, follow: false },
};
}

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  ACTIVE: "success",
  PENDING: "warning",
  SUSPENDED: "danger",
  CLOSED: "neutral",
};

export default async function ClinicIndexPage() {
  const { t, fmt } = await getI18n();
  const auth = await requireAuth();

  // Ownership and membership both count: a vet who works at a clinic gets the
  // console, they just cannot move its money.
  const clinics = await db.clinic.findMany({
    where: {
      deletedAt: null,
      OR: [{ ownerUserId: auth.user.id }, { members: { some: { userId: auth.user.id } } }],
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      city: true,
      country: true,
      createdAt: true,
      ownerUserId: true,
      _count: { select: { appointments: true, vets: true, services: true } },
    },
  });

  // One clinic is the common case; skip the chooser entirely.
  if (clinics.length === 1 && clinics[0]) redirect(`/clinic/${clinics[0].id}`);

  return (
    <div className="container-page max-w-3xl py-8 lg:py-10">
      <PageHeader
        title={t("Clinic console")}
        description={t("Calendars, patients and earnings for the practices you are part of.")}
        action={
          <ButtonLink href="/clinic/new">
            <Plus className="size-4" aria-hidden />
            {t("Register a clinic")}
          </ButtonLink>
        }
      />

      <div className="mt-6">
        {clinics.length === 0 ? (
          <EmptyState
            icon={<Stethoscope className="size-5" aria-hidden />}
            title={t("You are not part of a clinic yet")}
            description={t("Register one and we will verify the licence before it goes live. That check is what makes the clinic-verified badge on health records mean anything.")}
            action={<ButtonLink href="/clinic/new">{t("Register your clinic")}</ButtonLink>}
          />
        ) : (
          <ul className="space-y-3">
            {clinics.map((clinic) => (
              <li key={clinic.id}>
                <Link href={`/clinic/${clinic.id}`} className="block">
                  <Card interactive className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-[15px] font-semibold text-fg">{clinic.name}</h2>
                          <Badge tone={STATUS_TONE[clinic.status] ?? "neutral"} size="sm">
                            {clinic.status.toLowerCase()}
                          </Badge>
                          {clinic.ownerUserId !== auth.user.id && (
                            <Badge tone="neutral" size="sm">
                              {t("staff")}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-sm text-fg-muted">
                          {[clinic.city, clinic.country].filter(Boolean).join(", ") ||
                            t("Location not set")}
                        </p>
                        <p className="mt-0.5 text-xs text-fg-subtle tabular">
                          {t.plural(clinic._count.appointments, { one: "{count} appointment", other: "{count} appointments" })} ·{" "}
                          {t.plural(clinic._count.vets, { one: "{count} vet", other: "{count} vets" })} ·{" "}
                          {t.plural(clinic._count.services, { one: "{count} service", other: "{count} services" })} ·{" "}
                          {t("registered {date}", { date: fmt.date(clinic.createdAt) })}
                        </p>
                      </div>
                    </div>

                    {clinic.status === "PENDING" && (
                      <Alert
                        tone="warning"
                        className="mt-3"
                        icon={<Clock className="size-4" aria-hidden />}
                      >
                        <p>
                          {t("Waiting on licence verification. You can set up services, vets and hours now; the clinic appears in search the moment it clears.")}
                        </p>
                      </Alert>
                    )}

                    {clinic.status === "SUSPENDED" && (
                      <Alert
                        tone="danger"
                        className="mt-3"
                        icon={<AlertTriangle className="size-4" aria-hidden />}
                      >
                        <p>
                          {t("Suspended. Existing appointments stand, but no new bookings can be made. Contact support to appeal.")}
                        </p>
                      </Alert>
                    )}
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
