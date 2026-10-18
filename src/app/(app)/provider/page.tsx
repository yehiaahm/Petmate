import type { Metadata } from "next";
import Link from "next/link";
import { BedDouble, GraduationCap, Plus, Sparkles, Store } from "lucide-react";
import { requireAuth, hasRole } from "@/lib/auth/rbac";
import { listMyProviders } from "@/lib/services/care-provider.service";
import { Badge, Card, EmptyState, PageHeader, StatusPill } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "My pet care businesses", robots: { index: false, follow: false } };

const STATUS_TONE = { PENDING: "warning", ACTIVE: "success", SUSPENDED: "danger", CLOSED: "neutral" } as const;
const STATUS_LABEL = { PENDING: "Awaiting review", ACTIVE: "Live", SUSPENDED: "Suspended", CLOSED: "Closed" } as const;

export default async function ProviderListPage() {
  const auth = await requireAuth();
  const providers = await listMyProviders(auth);
  const isAdmin = hasRole(auth.user, "ADMIN", "SUPER_ADMIN");

  return (
    <div className="container-page max-w-4xl py-8 lg:py-10">
      <PageHeader
        eyebrow="Provider console"
        title="Your pet care businesses"
        description="Pet hotels and training schools you own or work at."
        action={
          <div className="flex flex-wrap gap-2">
            {isAdmin && (
              <ButtonLink href="/provider/new?official=1" variant="outline" size="sm">
                <Sparkles className="size-4" aria-hidden /> New PetMate operation
              </ButtonLink>
            )}
            <ButtonLink href="/provider/new" size="sm">
              <Plus className="size-4" aria-hidden /> Register a business
            </ButtonLink>
          </div>
        }
      />

      {providers.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={<Store className="size-6" aria-hidden />}
          title="No businesses yet"
          description="Run a pet hotel or a training school? List it and take bookings with payment held safely until the job is done."
          action={<ButtonLink href="/provider/new">Register your business</ButtonLink>}
        />
      ) : (
        <ul className="mt-8 space-y-2">
          {providers.map((p) => (
            <li key={p.id}>
              <Link href={`/provider/${p.id}`} className="block">
                <Card interactive className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-fg">
                      {p.name}
                      {p.isOfficial && (
                        <Badge tone="brand" size="sm" icon={<Sparkles className="size-3" aria-hidden />}>
                          PetMate Official
                        </Badge>
                      )}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-fg-muted">
                      {p.city}
                      {p.offersBoarding && (
                        <span className="inline-flex items-center gap-1">
                          <BedDouble className="size-3.5" aria-hidden /> Hotel
                        </span>
                      )}
                      {p.offersTraining && (
                        <span className="inline-flex items-center gap-1">
                          <GraduationCap className="size-3.5" aria-hidden /> Training
                        </span>
                      )}
                      <span className="tabular">{p._count.bookings} bookings</span>
                      {p.ownerUserId !== auth.user.id && <span>· Team member</span>}
                    </p>
                  </div>
                  <StatusPill tone={STATUS_TONE[p.status as keyof typeof STATUS_TONE] ?? "neutral"}>
                    {STATUS_LABEL[p.status as keyof typeof STATUS_LABEL] ?? p.status}
                  </StatusPill>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
