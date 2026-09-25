import type { Metadata } from "next";
import { db } from "@/lib/db";
import { Badge, Card } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { compactNumber } from "@/lib/utils";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
  title: t("About PetMate"),
  description:
    t("PetMate exists because buying, adopting and breeding pets is one of the least protected transactions people make. We are building the record that makes it checkable."),
  alternates: { canonical: "/about" },
};
}

export const revalidate = 3600;

export default async function AboutPage() {
  const { t } = await getI18n();
  const [pets, records, clinics] = await Promise.all([
    db.pet.count({ where: { deletedAt: null } }),
    db.healthRecord.count({ where: { deletedAt: null } }),
    db.clinic.count({ where: { status: "ACTIVE", deletedAt: null } }),
  ]);

  return (
    <div className="container-page py-12 lg:py-16">
      <div className="mx-auto max-w-2xl">
        <Badge tone="brand">{t("About us")}</Badge>
        <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-fg sm:text-5xl">
          {t("Pets deserve a record")}
        </h1>

        <div className="mt-8 space-y-5 text-[17px] leading-relaxed text-fg-muted">
          <p>
            {t("Most pets change hands with a photo, a phone number and a promise. The buyer has no way to check whether the vaccinations happened, whether the seller has done this before, or whether the animal is what the listing says it is. The seller has no way to prove any of it. Both of them are asked to trust a stranger with several hundred pounds and a living animal.")}
          </p>

          <p>
            {t("That is not a technology problem in an interesting sense. It is a missing record. The vaccination card is paper in a drawer. The vet’s notes are in the vet’s system. The seller’s history is in a Facebook group that will be gone in two years. Nothing connects, so nothing can be verified, so everyone falls back on instinct.")}
          </p>

          <p className="text-fg">
            <strong className="font-semibold">
              {t("PetMate gives every animal one durable record and makes it follow them for life.")}
            </strong>{" "}
            {t("Who owns them. What a licensed clinic — not the seller — has actually recorded. Who bred them, and who their parents were. When they changed hands and under what terms.")}
          </p>

          <p>
            {t("Once that record exists, a lot of things that were previously impossible become ordinary. A buyer can tell a documented animal from a claimed one. A responsible breeder can prove they are one. A rescue can ask the questions that matter and compare answers instead of reading a hundred paragraphs. A vet becomes part of the animal’s history rather than a separate appointment. And money can sit in escrow until both people agree the handover happened, because there is finally something concrete to agree about.")}
          </p>

          <p>
            {t("We are deliberate about what we do not do. We do not claim a rule engine is machine learning. We do not show a health score and imply it is a diagnosis — it measures how well documented an animal is, which is a different and more honest thing. We do not paywall the features that make a transaction safe, because a marketplace that taxes its own liquidity does not grow. And when a payment happens outside PetMate, we say plainly that we cannot help.")}
          </p>
        </div>

        <dl className="mt-10 grid grid-cols-3 gap-px overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--border)]">
          {[
            { label: "Pet records", value: pets },
            { label: "Health entries", value: records },
            { label: "Verified clinics", value: clinics },
          ].map((stat) => (
            <div key={stat.label} className="bg-bg-elevated px-4 py-5 text-center">
              <dd className="font-display text-2xl font-semibold tabular text-fg">
                {compactNumber(stat.value)}
              </dd>
              <dt className="mt-0.5 text-xs text-fg-muted">{t(stat.label)}</dt>
            </div>
          ))}
        </dl>

        <Card className="mt-10 p-6">
          <h2 className="font-display text-xl font-semibold text-fg">{t("What we are building toward")}</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-fg-muted">
            {t("A person should be able to find a pet, verify who they are dealing with, complete the purchase safely, register the animal, keep their health record, book their vet, buy their food, find a responsible breeding match years later, and eventually pass the whole record on to the next owner — without leaving one account or re-entering a single fact.")}
          </p>
          <p className="mt-3 text-[15px] leading-relaxed text-fg-muted">
            {t("Every feature we ship is judged against whether it moves an animal further along that line.")}
          </p>
        </Card>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="/register" size="lg">
            {t("Create a free account")}
          </ButtonLink>
          <ButtonLink href="/trust" variant="outline" size="lg">
            {t("How we keep you safe")}
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
