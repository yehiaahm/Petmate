import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { Badge, Card, EmptyState } from "@/components/ui/primitives";
import { SPECIES, SPECIES_LABEL, type Species } from "@/lib/constants";
import { clientEnv } from "@/lib/env";
import { PawPrint } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
  title: t("Breed directory"),
  description:
    t("Every breed on PetMate, with typical size, lifespan, care level and how many are listed right now. Written to help you choose honestly, not to sell you one."),
  alternates: { canonical: "/breeds" },
};
}

export const revalidate = 3600;

const CARE_LEVEL_LABEL: Record<string, string> = { LOW: "low care", MODERATE: "moderate care", HIGH: "high care" };

const CARE_TONE: Record<string, "success" | "warning" | "danger"> = {
  LOW: "success",
  MODERATE: "warning",
  HIGH: "danger",
};

export default async function BreedsPage({
  searchParams,
}: {
  searchParams: Promise<{ species?: string }>;
}) {
  const { t } = await getI18n();
  const params = await searchParams;
  const selected = SPECIES.includes(params.species as Species)
    ? (params.species as Species)
    : null;

  const breeds = await db.breed.findMany({
    where: selected ? { species: selected } : {},
    orderBy: [{ species: "asc" }, { popularity: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      species: true,
      sizeClass: true,
      lifespanMinY: true,
      lifespanMaxY: true,
      careLevel: true,
      hypoallergenic: true,
      originCountry: true,
      _count: {
        select: {
          pets: { where: { deletedAt: null } },
        },
      },
    },
  });

  // Which species actually have breeds, so the filter never offers an empty tab.
  const populated = await db.breed.groupBy({ by: ["species"], _count: true });
  const availableSpecies = SPECIES.filter((s) => populated.some((p) => p.species === s));

  const grouped = new Map<string, typeof breeds>();
  for (const breed of breeds) {
    const list = grouped.get(breed.species) ?? [];
    list.push(breed);
    grouped.set(breed.species, list);
  }

  return (
    <div className="container-page py-12 lg:py-16">
      <div className="mx-auto max-w-2xl text-center">
        <Badge tone="brand">{t("Breed directory")}</Badge>
        <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-fg sm:text-5xl">
          {t("Know what you are taking on")}
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-fg-muted">
          {t("Typical size, lifespan and how much work each breed actually is — including the parts that put people off. An animal returned in six months is the expensive kind of mistake.")}
        </p>
      </div>

      <nav aria-label={t("Filter by species")} className="mt-10 flex flex-wrap justify-center gap-2">
        <Link
          href="/breeds"
          aria-current={selected === null ? "page" : undefined}
          className={
            selected === null
              ? "rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-fg"
              : "rounded-full border border-[var(--border)] px-4 py-2 text-sm font-medium text-fg-muted hover:border-[var(--border-strong)] hover:text-fg"
          }
        >
          {t("All species")}
        </Link>
        {availableSpecies.map((species) => (
          <Link
            key={species}
            href={`/breeds?species=${species}`}
            aria-current={selected === species ? "page" : undefined}
            className={
              selected === species
                ? "rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-fg"
                : "rounded-full border border-[var(--border)] px-4 py-2 text-sm font-medium text-fg-muted hover:border-[var(--border-strong)] hover:text-fg"
            }
          >
            {t(SPECIES_LABEL[species])}
          </Link>
        ))}
      </nav>

      {breeds.length === 0 ? (
        <EmptyState
          className="mx-auto mt-10 max-w-lg"
          icon={<PawPrint className="size-5" aria-hidden />}
          title={t("No breeds catalogued yet")}
          description={t("The directory fills as breeds are added. Mixed-breed animals can still be listed with free-text breed.")}
        />
      ) : (
        <div className="mx-auto mt-10 max-w-5xl space-y-12">
          {[...grouped.entries()].map(([species, list]) => (
            <section key={species}>
              <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">
                {t(SPECIES_LABEL[species as Species])}
                <span className="ms-2 text-base font-normal text-fg-subtle tabular">
                  {list.length}
                </span>
              </h2>

              <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((breed) => (
                  <li key={breed.id}>
                    <Link href={`/breeds/${breed.slug}`} className="block h-full">
                      <Card interactive className="flex h-full flex-col p-4">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="font-display text-base font-semibold text-fg">
                            {breed.name}
                          </h3>
                          {breed.careLevel && (
                            <Badge tone={CARE_TONE[breed.careLevel] ?? "neutral"} size="sm">
                              {t(CARE_LEVEL_LABEL[breed.careLevel] ?? breed.careLevel)}
                            </Badge>
                          )}
                        </div>

                        <dl className="mt-2.5 space-y-1 text-xs text-fg-muted">
                          {breed.sizeClass && (
                            <div className="flex gap-1.5">
                              <dt className="text-fg-subtle">{t("Size")}</dt>
                              <dd className="capitalize">{t(breed.sizeClass.toLowerCase())}</dd>
                            </div>
                          )}
                          {breed.lifespanMinY && breed.lifespanMaxY && (
                            <div className="flex gap-1.5">
                              <dt className="text-fg-subtle">{t("Lifespan")}</dt>
                              <dd className="tabular">
                                {t("{min}–{max} years", { min: breed.lifespanMinY, max: breed.lifespanMaxY })}
                              </dd>
                            </div>
                          )}
                          {breed.originCountry && (
                            <div className="flex gap-1.5">
                              <dt className="text-fg-subtle">{t("Origin")}</dt>
                              <dd>{breed.originCountry}</dd>
                            </div>
                          )}
                        </dl>

                        <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
                          {breed.hypoallergenic && (
                            <Badge tone="info" size="sm">
                              {t("Low allergen")}
                            </Badge>
                          )}
                          <span className="text-xs text-fg-subtle tabular">
                            {t("{count} registered", { count: breed._count.pets })}
                          </span>
                        </div>
                      </Card>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: "PetMate breed directory",
            url: `${clientEnv.NEXT_PUBLIC_APP_URL}/breeds`,
            hasPart: breeds.slice(0, 50).map((b) => ({
              "@type": "WebPage",
              name: b.name,
              url: `${clientEnv.NEXT_PUBLIC_APP_URL}/breeds/${b.slug}`,
            })),
          }),
        }}
      />
    </div>
  );
}
