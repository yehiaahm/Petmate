import type { Metadata } from "next";
import {
  Dna,
  ShieldX,
  Scale,
  FileHeart,
  MapPin,
  Sparkles,
  BadgeCheck,
  ListChecks,
} from "lucide-react";
import { db } from "@/lib/db";
import { getAuth } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { bpsToPercent } from "@/lib/money";
import { Card, Badge, Alert } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { compactNumber } from "@/lib/utils";
import { WEIGHTS } from "@/lib/breeding/compatibility";

export const metadata: Metadata = {
  title: "Responsible breeding",
  description:
    "A deterministic compatibility engine that checks age, health records, relatedness and distance — and shows its working, factor by factor. Not machine learning, and we do not claim otherwise.",
  alternates: { canonical: "/breeding" },
};

export const revalidate = 3600;

/**
 * The weights come from the engine itself, so this page cannot claim a split
 * the matcher no longer uses. Only the prose lives here.
 */
const FACTORS = [
  {
    key: "health" as const,
    icon: FileHeart,
    title: "Health documentation",
    body: "Vaccinations current, clinic-verified entries present, records recent and continuous. An animal with no paperwork scores low here even if it is perfectly healthy — the factor measures evidence, not wellbeing.",
  },
  {
    key: "breed" as const,
    icon: Dna,
    title: "Breed compatibility",
    body: "Same-breed pairings score highest, related breeds score well, and unrelated crosses score lower without being blocked. Mixed-breed animals are not penalised for lacking a pedigree.",
  },
  {
    key: "age" as const,
    icon: Scale,
    title: "Age suitability",
    body: "Both animals must be above the minimum breeding age for their species, and the score falls away at the older end where the welfare risk rises.",
  },
  {
    key: "distance" as const,
    icon: MapPin,
    title: "Distance",
    body: "A perfect match four hundred miles away is not a practical one. Distance is a real factor, not a filter applied afterwards.",
  },
  {
    key: "temperament" as const,
    icon: Sparkles,
    title: "Temperament",
    body: "Recorded traits on the individual animals, not breed stereotypes. Two animals described as anxious score lower together than either would with a settled partner.",
  },
  {
    key: "verification" as const,
    icon: BadgeCheck,
    title: "Verification",
    body: "Whether each owner is verified and whether the animals' records carry a clinic's signature rather than only the owner's word.",
  },
  {
    key: "preferences" as const,
    icon: ListChecks,
    title: "Stated preferences",
    body: "What each owner said they were looking for, and whether the other animal actually meets it.",
  },
];

const BLOCKERS = [
  "Different species",
  "Two animals of the same sex, or a sex not recorded",
  "Either animal is neutered",
  "Either animal is below the minimum breeding age for its species",
  "The two are closely related on PetMate's lineage records",
];

export default async function BreedingLandingPage() {
  const [auth, settings, profiles, litters, species] = await Promise.all([
    getAuth(),
    getSettings(),
    db.breedingProfile.count({ where: { status: "ACTIVE" } }),
    db.litter.count(),
    // Species lives on the pet, not the breeding profile, so the distinct
    // count is taken from the pets those profiles point at.
    db.pet.groupBy({
      by: ["species"],
      where: { breedingProfile: { status: "ACTIVE" }, deletedAt: null },
      _count: true,
    }),
  ]);

  const maxWeight = Math.max(...Object.values(WEIGHTS));
  const totalWeight = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

  return (
    <div className="container-page py-12 lg:py-16">
      <div className="mx-auto max-w-2xl text-center">
        <Badge tone="brand">Breeding</Badge>
        <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-fg sm:text-5xl">
          A match you can argue with
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-fg-muted">
          Most breeding decisions are made on a photo and a phone call. PetMate scores a pairing
          against the records both animals actually have, refuses the ones that should not happen,
          and shows you every factor behind the number.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <ButtonLink href={auth ? "/dashboard/breeding" : "/register?next=/dashboard/breeding"} size="lg">
            {auth ? "Open breeding matches" : "Create a free account"}
          </ButtonLink>
          <ButtonLink href="/pets?intent=BREEDING" variant="outline" size="lg">
            Browse available studs
          </ButtonLink>
        </div>
      </div>

      <dl className="mx-auto mt-14 grid max-w-2xl grid-cols-3 gap-px overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--border)]">
        {[
          { label: "Active breeding profiles", value: profiles },
          { label: "Litters recorded", value: litters },
          { label: "Species represented", value: species.length },
        ].map((stat) => (
          <div key={stat.label} className="bg-bg-elevated px-4 py-5 text-center">
            <dd className="font-display text-2xl font-semibold tabular text-fg">
              {compactNumber(stat.value)}
            </dd>
            <dt className="mt-0.5 text-xs text-fg-muted">{stat.label}</dt>
          </div>
        ))}
      </dl>

      <Alert
        tone="info"
        className="mx-auto mt-10 max-w-3xl"
        title="This is a rule engine, not machine learning"
      >
        <p className="mt-1 leading-relaxed">
          Every number the matcher produces comes from a weighted rule you can read on this page.
          It does not learn, it does not predict, and calling it AI would be a lie that happens to
          sell better. Because it is deterministic, the same two animals always score the same, and
          any score can be traced to the facts that produced it.
        </p>
      </Alert>

      <section className="mx-auto mt-14 max-w-4xl">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">
          What goes into the score
        </h2>
        <p className="mt-2 max-w-2xl text-[15px] text-fg-muted">
          {FACTORS.length} factors, each capped at the weight shown, adding up to {totalWeight}
          points before the total is normalised to 100.
        </p>

        <ul className="mt-6 space-y-3">
          {[...FACTORS]
            .map((factor) => ({ ...factor, weight: WEIGHTS[factor.key] }))
            .sort((a, b) => b.weight - a.weight)
            .map((factor) => (
            <li key={factor.title}>
              <Card className="flex gap-4 p-5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-soft-fg">
                  <factor.icon className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <h3 className="font-display text-lg font-semibold text-fg">{factor.title}</h3>
                    <span className="shrink-0 text-sm font-semibold tabular text-brand">
                      {factor.weight} pts
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{factor.body}</p>
                  <div
                    className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-sunken"
                    role="presentation"
                  >
                    <div
                      className="h-full rounded-full bg-brand"
                      style={{ width: `${(factor.weight / maxWeight) * 100}%` }}
                    />
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto mt-14 max-w-3xl">
        <h2 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight text-fg">
          <ShieldX className="size-5 text-[var(--danger)]" aria-hidden />
          What we refuse outright
        </h2>
        <p className="mt-2 text-[15px] leading-relaxed text-fg-muted">
          These are not penalties that a high score elsewhere can outweigh. A pairing that hits any
          of them scores zero and cannot be arranged through PetMate.
        </p>
        <ul className="mt-5 space-y-2">
          {BLOCKERS.map((blocker) => (
            <li
              key={blocker}
              className="flex items-start gap-2.5 rounded-[var(--radius-field)] border border-[var(--danger)]/20 bg-[var(--danger-soft)]/40 px-4 py-2.5 text-[15px] text-fg"
            >
              <ShieldX className="mt-0.5 size-4 shrink-0 text-[var(--danger)]" aria-hidden />
              {blocker}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm leading-relaxed text-fg-muted">
          Close relatedness is the one worth dwelling on. Doubling up on a recent ancestor is where
          most of the real welfare harm in hobby breeding comes from, and it is invisible without a
          lineage record — which is exactly what PetMate keeps. The absence of a block is not
          approval: our records only know what has been entered.
        </p>
      </section>

      <section className="mx-auto mt-14 max-w-3xl">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">How it works</h2>
        <ol className="mt-5 space-y-3">
          {[
            {
              title: "Add the animal, then a breeding profile",
              body: "The profile says what you are looking for and what terms you will accept. It is separate from a listing, so an animal available for breeding is not advertised for sale.",
            },
            {
              title: "Matches are scored both ways",
              body: "A pairing has one score, computed from both animals' records. Neither owner sees a different number from the other.",
            },
            {
              title: "Send a request with the working attached",
              body: "The other owner sees the same factor breakdown you do, so the conversation starts from evidence rather than from a sales pitch.",
            },
            {
              title: "Agree terms in writing",
              body: `Stud fee, ownership of the litter, and what happens if it does not take. Paid arrangements settle through PetMate at ${bpsToPercent(settings.commissionBreedingBps)} commission; free arrangements cost nothing.`,
            },
            {
              title: "Record the litter",
              body: "Offspring are linked to both parents, so the next owner inherits a pedigree that can be followed rather than one that is claimed.",
            },
          ].map((step, i) => (
            <li key={step.title}>
              <Card className="flex gap-4 p-5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-brand-fg tabular">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold text-fg">{step.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-fg-muted">{step.body}</p>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <Alert tone="warning" className="mx-auto mt-14 max-w-3xl" title="What this does not do">
        <p className="mt-1 leading-relaxed">
          It is not genetic testing and not veterinary advice. It cannot see a heritable condition
          that nobody has recorded, and it does not know your local licensing rules — complying
          with those is yours to do. Screen the parents properly with a vet before you breed
          anything.
        </p>
      </Alert>

      <section className="mx-auto mt-14 max-w-2xl text-center">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">
          Ready to look?
        </h2>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <ButtonLink href={auth ? "/dashboard/breeding" : "/register?next=/dashboard/breeding"}>
            {auth ? "Open breeding matches" : "Create a free account"}
          </ButtonLink>
          <ButtonLink href="/trust" variant="outline">
            How we keep this safe
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}
