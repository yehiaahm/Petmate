import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/rbac";
import { listMyCampaigns, adPricing } from "@/lib/services/ad.service";
import { getI18n } from "@/lib/i18n/server";
import { PageHeader } from "@/components/ui/primitives";
import { CampaignManager } from "@/components/ads/campaign-manager";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("Advertising"), robots: { index: false, follow: false } };
}

export default async function AdvertisingPage() {
  const [auth, { t }] = await Promise.all([requireAuth(), getI18n()]);
  const [campaigns, pricing] = await Promise.all([listMyCampaigns(auth), adPricing()]);

  return (
    <div className="container-page py-8 lg:py-10">
      <PageHeader
        eyebrow={t("Advertising")}
        title={t("Your campaigns")}
        description={t("Ads are shown by placement, never by who is looking: advertisers get no personal data about PetMate members.")}
      />
      <div className="mt-6">
        <CampaignManager
          pricing={pricing}
          campaigns={campaigns.map((c) => ({
            id: c.id,
            name: c.name,
            slot: c.slot,
            status: c.status,
            headline: c.headline,
            body: c.body,
            budgetCents: c.budgetCents,
            spentCents: c.spentCents,
            returnedCents: c.returnedCents,
            currency: c.currency,
            impressions: c.impressions,
            plannedImpressions: c.plannedImpressions,
            clicks: c.clicks,
            ctr: c.ctr,
            startAt: c.startAt.toISOString(),
            endAt: c.endAt.toISOString(),
            reviewNote: c.reviewNote,
          }))}
        />
      </div>
    </div>
  );
}
