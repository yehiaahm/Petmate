import type { Metadata } from "next";
import { listPlans } from "@/lib/services/subscription.service";
import { getSettings } from "@/lib/settings";
import { getAuth } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { bpsToPercent } from "@/lib/money";
import { Card, Badge } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { PlanGrid } from "@/components/billing/plan-grid";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
  title: t("Plans & pricing"),
  description:
    t("PetMate is free to use for buying, adopting, messaging and booking a vet. Paid plans add capacity, visibility and professional tools for breeders, shops and clinics."),
  alternates: { canonical: "/pricing" },
};
}

export const revalidate = 600;

export default async function PricingPage() {
  const { t } = await getI18n();
  const [plans, settings, auth] = await Promise.all([listPlans(), getSettings(), getAuth()]);

  const current = auth
    ? await db.subscription.findFirst({
        where: { userId: auth.user.id, status: { in: ["ACTIVE", "TRIALING"] } },
        select: { plan: { select: { code: true } } },
      })
    : null;

  const commissions = [
    { label: "Pet sales", bps: settings.commissionPetSaleBps },
    { label: "Products", bps: settings.commissionProductBps },
    { label: "Veterinary bookings", bps: settings.commissionAppointmentBps },
    { label: "Paid breeding arrangements", bps: settings.commissionBreedingBps },
  ];

  return (
    <div className="container-page py-12 lg:py-16">
      <div className="mx-auto max-w-2xl text-center">
        <Badge tone="brand">{t("Pricing")}</Badge>
        <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-fg sm:text-5xl">
          {t("Free to buy, adopt and book")}
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-fg-muted">
          {t("Everything needed to complete a transaction is free forever: messaging, escrow-protected purchases, vet booking and unlimited health records. A marketplace that taxes its own liquidity does not grow.")}
        </p>
        <p className="mt-2 text-[15px] text-fg-muted">
          {t("Paid plans sell capacity, visibility and professional tooling — not access.")}
        </p>
      </div>

      <div className="mt-12">
        <PlanGrid
          plans={plans.map((plan) => ({
            id: plan.id,
            code: plan.code,
            name: plan.name,
            tagline: plan.tagline,
            audience: plan.audience,
            priceMonthlyCents: plan.priceMonthlyCents,
            priceYearlyCents: plan.priceYearlyCents,
            currency: plan.currency,
            features: plan.featureList,
          }))}
          currentPlanCode={current?.plan.code ?? t("free")}
          signedIn={Boolean(auth)}
        />
      </div>

      <section className="mx-auto mt-20 max-w-3xl">
        <h2 className="text-center font-display text-3xl font-semibold tracking-tight text-fg">
          {t("How PetMate makes money")}
        </h2>
        <p className="mt-3 text-center text-[15px] leading-relaxed text-fg-muted">
          {t("We take a commission on completed transactions. If nothing sells, we earn nothing, which means our incentive is the same as yours: transactions that actually complete and do not end in a dispute.")}
        </p>

        <Card className="mt-6 p-6">
          <dl className="divide-y divide-[var(--border)]">
            {commissions.map((item) => (
              <div key={item.label} className="flex items-baseline justify-between gap-4 py-3">
                <dt className="text-sm text-fg-muted">{t(item.label)}</dt>
                <dd className="font-display text-lg font-semibold tabular text-fg">
                  {bpsToPercent(item.bps)}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-4 border-t border-[var(--border)] pt-4">
            <p className="text-sm leading-relaxed text-fg-muted">
              {t("Commission is taken from the seller when a transaction completes, not from the buyer at checkout. Paid plans reduce it. Featured placements and advertising are the only other charges, and both are optional and always labelled.")}
            </p>
          </div>
        </Card>
      </section>

      <section className="mx-auto mt-16 max-w-3xl">
        <h2 className="text-center font-display text-2xl font-semibold tracking-tight text-fg">
          {t("Questions people actually ask")}
        </h2>

        <div className="mt-6 space-y-3">
          {[
            {
              q: "Is there any charge to adopt or rehome?",
              a: "No. Adoption listings and applications are free, and PetMate takes no commission on an adoption fee. Rehoming responsibly should never cost more than not bothering.",
            },
            {
              q: "What do I actually lose on the free plan?",
              a: "Capacity, not capability. Three active listings instead of more, five breeding requests a month instead of unlimited, three saved-search alerts. Every transaction feature works the same.",
            },
            {
              q: "When is the commission taken?",
              a: "When the transaction completes. For a pet sale that is when escrow releases, after both parties confirm the handover. If a sale falls through, no commission is charged.",
            },
            {
              q: "Can I cancel at any time?",
              a: "Yes, and you keep the plan until the end of the period you have paid for. Nothing is deleted when you drop to free — listings beyond the free limit are paused, not removed.",
            },
            {
              q: "Do clinics pay to be listed?",
              a: "No. A clinic can list, take bookings and write health records on the free tier; we take a commission on paid bookings. Clinic Pro adds multi-vet calendars, analytics and a lower commission.",
            },
          ].map((item) => (
            <details key={item.q} className="surface group p-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                <span className="font-display text-base font-semibold text-fg">{t(item.q)}</span>
                <span className="shrink-0 text-fg-subtle transition-transform group-open:rotate-45" aria-hidden>
                  +
                </span>
              </summary>
              <p className="mt-3 text-[15px] leading-relaxed text-fg-muted">{t(item.a)}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-16 max-w-2xl text-center">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">
          {t("Not sure which one?")}
        </h2>
        <p className="mt-2 text-[15px] text-fg-muted">
          {t("Start free. Every plan can be changed or cancelled whenever you like, and you only hit a limit when you are actually using the product enough to need more.")}
        </p>
        <div className="mt-6">
          <ButtonLink href={auth ? "/dashboard" : "/register"} size="lg">
            {auth ? t("Go to dashboard") : t("Create a free account")}
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}
