import { BedDouble, GraduationCap } from "lucide-react";
import { searchProviders } from "@/lib/services/care-provider.service";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { CareFilters } from "@/components/care/care-filters";
import { ProviderCard } from "@/components/care/provider-card";
import { SPECIES, TRAINING_LEVEL_LABEL, type Species, type TrainingLevel } from "@/lib/constants";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const COPY = {
  BOARDING: {
    eyebrow: "Pet hotels",
    title: "Find a pet hotel",
    description:
      "Real rooms with real availability, photo updates during the stay, and optional pickup and drop-off by the hotel's own team. Your payment is held until the stay is done.",
    empty: "No pet hotels match those filters",
    icon: BedDouble,
  },
  TRAINING: {
    eyebrow: "Dog training",
    title: "Find a dog trainer",
    description:
      "Structured programmes from puppy school to behaviour work, booked into the trainers' real diary. Notes after every session, at a centre or at your home.",
    empty: "No trainers match those filters",
    icon: GraduationCap,
  },
} as const;

/** Shared by /boarding and /training: one search engine, two front doors. */
export async function CareSearch({ kind, searchParams }: { kind: "BOARDING" | "TRAINING"; searchParams: SearchParams }) {
  const raw = await searchParams;
  const one = (key: string) => {
    const value = raw[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const num = (key: string) => {
    const value = Number(one(key));
    return one(key) != null && Number.isFinite(value) ? value : undefined;
  };
  const species = one("species");

  const results = await searchProviders({
    kind,
    query: one("q")?.slice(0, 200),
    city: one("city")?.slice(0, 80),
    lat: num("lat"),
    lng: num("lng"),
    radiusKm: num("radius"),
    species: species && (SPECIES as readonly string[]).includes(species) ? (species as Species) : undefined,
    transport: one("transport") === "true",
    inHome: one("inHome") === "true",
    sort: one("sort") as "recommended" | "rating" | "price" | "distance" | undefined,
    page: num("page") ?? 1,
    limit: 20,
  });

  const pages = Math.max(1, Math.ceil(results.total / results.limit));
  const copy = COPY[kind];
  const Icon = copy.icon;

  return (
    <div className="container-page py-8 lg:py-12">
      <PageHeader eyebrow={copy.eyebrow} title={copy.title} description={copy.description} />

      <div className="mt-8 grid gap-8 lg:grid-cols-[16rem_1fr]">
        <div className="lg:sticky lg:top-24 lg:h-fit">
          <CareFilters kind={kind} resultCount={results.total} />
        </div>

        <div className="min-w-0">
          {results.items.length === 0 ? (
            <EmptyState
              icon={<Icon className="size-6" aria-hidden />}
              title={copy.empty}
              description="Try another city, widen the distance or clear a filter. New providers join every week."
              action={
                <div className="flex flex-wrap justify-center gap-3">
                  <ButtonLink href={kind === "BOARDING" ? "/boarding" : "/training"} variant="outline">
                    Clear filters
                  </ButtonLink>
                  <ButtonLink href="/for-providers">List your business</ButtonLink>
                </div>
              }
            />
          ) : (
            <>
              <ul className="space-y-3">
                {results.items.map((p) => (
                  <li key={p.id}>
                    <ProviderCard
                      kind={kind}
                      provider={{
                        ...p,
                        highlights:
                          kind === "BOARDING"
                            ? p.units.map((u) => ({ id: u.id, label: u.name, priceCents: u.nightlyCents }))
                            : p.programs.map((g) => ({
                                id: g.id,
                                label: `${TRAINING_LEVEL_LABEL[g.level as TrainingLevel] ?? g.name} · ${g.sessionsCount}×`,
                                priceCents: g.priceCents,
                              })),
                      }}
                    />
                  </li>
                ))}
              </ul>
              <Pagination page={results.page} pages={pages} className="mt-10" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
