import { getI18n } from "@/lib/i18n/server";
import { LogoMark } from "./logo";

/**
 * Shown while a page's data loads. The mark draws itself, so a wait reads as
 * the brand doing something rather than a blank screen — and it appears the
 * instant a link is tapped, which is most of what "fast" feels like.
 */
export async function PageLoader() {
  const { t } = await getI18n();
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-5" role="status">
      <div className="relative">
        <div
          className="absolute inset-0 -z-10 scale-150 rounded-full bg-[radial-gradient(circle,var(--aurora-1),transparent_70%)] blur-xl"
          aria-hidden
        />
        <LogoMark animated className="w-28 animate-float" />
      </div>
      <div className="flex gap-1.5" aria-hidden>
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className="size-2 rounded-full bg-brand [animation:float_1s_ease-in-out_infinite]"
            style={{ animationDelay: `${dot * 140}ms` }}
          />
        ))}
      </div>
      <span className="sr-only">{t("Loading…")}</span>
    </div>
  );
}
