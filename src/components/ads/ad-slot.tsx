import { ExternalLink } from "lucide-react";
import { selectAd } from "@/lib/services/ad.service";
import { getI18n } from "@/lib/i18n/server";
import type { AdSlot as AdSlotName } from "@/lib/constants";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { AdImpression } from "./ad-impression";

/**
 * A paid ad, clearly labelled as one. Renders nothing when no campaign is
 * running for the slot, so a page never shows an empty box or a house ad
 * pretending to be paid.
 */
export async function AdSlot({ slot, className }: { slot: AdSlotName; className?: string }) {
  const ad = await selectAd(slot).catch((e) => {
    // An ad is never worth failing the page it sits on.
    logger.exception("ad selection failed", e, { slot });
    return null;
  });
  if (!ad) return null;
  const { t } = await getI18n();

  return (
    <aside aria-label={t("Sponsored")} className={className}>
      <AdImpression campaignId={ad.id}>
        <a
          href={`/api/ads/click/${ad.id}`}
          rel={ad.external ? "sponsored noopener" : "sponsored"}
          target={ad.external ? "_blank" : undefined}
          className={cn(
            "group flex items-center gap-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-elevated)] p-4 transition-colors hover:border-[var(--border-strong)]",
          )}
        >
          {ad.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- advertiser assets can be on any https host
            <img src={ad.imageUrl} alt="" loading="lazy" className="size-16 shrink-0 rounded-lg object-cover sm:size-20" />
          )}
          <span className="min-w-0 flex-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">{t("Sponsored")}</span>
            <span className="mt-0.5 block font-semibold text-fg group-hover:underline">{ad.headline}</span>
            {ad.body && <span className="mt-0.5 block text-sm text-fg-muted">{ad.body}</span>}
          </span>
          {ad.external && <ExternalLink className="size-4 shrink-0 text-fg-subtle" aria-hidden />}
        </a>
      </AdImpression>
    </aside>
  );
}
