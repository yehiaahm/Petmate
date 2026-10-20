import Link from "next/link";
import { BadgeCheck, BedDouble, Lock } from "lucide-react";
import { Logo, LogoBadge, Wordmark } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { getI18n } from "@/lib/i18n/server";
import { RichText } from "@/components/i18n/rich-text";

/**
 * Auth layout.
 *
 * A split: the form on one side, the reason to bother on the other. The brand
 * panel is hidden below `lg` rather than stacked, because on a phone the only
 * thing that matters is getting to the first field — so phones get the mark
 * drawing itself above the form instead, which costs no scrolling.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getI18n();
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="relative isolate flex flex-col overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10 lg:hidden" aria-hidden>
          <div className="blob -start-24 -top-24 size-72 bg-[var(--color-lagoon-400)] opacity-30" />
          <div className="blob -end-24 top-24 size-64 bg-[var(--color-ocean-400)] opacity-20 [animation-delay:-7s]" />
        </div>

        <header className="flex items-center justify-between p-5 sm:p-6">
          <Link href="/" aria-label={t("PetMate home")} className="rounded-xl">
            <Logo size="sm" />
          </Link>
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <ThemeToggle />
          </div>
        </header>

        <main id="main" className="flex flex-1 items-center justify-center px-6 pb-16">
          <div className="w-full max-w-sm">
            <div className="enter mb-8 flex justify-center lg:hidden">
              <LogoBadge animated className="size-24 rounded-[1.75rem] shadow-[var(--shadow-lift)]" />
            </div>
            <div className="enter" style={{ "--d": "120ms" } as React.CSSProperties}>
              {children}
            </div>
          </div>
        </main>
      </div>

      <aside
        data-theme="dark"
        className="relative isolate hidden overflow-hidden bg-bg lg:m-3 lg:flex lg:flex-col lg:justify-center lg:rounded-[2rem]"
      >
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
          <div className="blob -start-20 -top-20 size-96 bg-[var(--color-lagoon-500)] opacity-35" />
          <div className="blob -bottom-24 -end-16 size-96 bg-[var(--color-ocean-500)] opacity-30 [animation-delay:-8s]" />
          <div className="blob bottom-1/3 start-1/3 size-64 bg-[var(--color-grape)] opacity-15 [animation-delay:-14s]" />
          <div className="dot-grid absolute inset-0" />
        </div>

        <div className="relative mx-auto max-w-md px-12 py-16">
          <div className="flex items-center gap-4">
            <LogoBadge animated className="size-20 animate-float rounded-[1.5rem] shadow-[0_24px_50px_-18px_rgb(0_0_0/0.8)]" />
            <Wordmark className="text-2xl" />
          </div>

          <h2 className="mt-10 text-4xl font-bold leading-[1.1] text-white">
            <RichText
              text={t("The pet record that {highlight}")}
              values={{ highlight: <span className="text-gradient">{t("outlives the sale")}</span> }}
            />
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-fg-muted">
            {t("Most pets change hands with a photo, a phone number and a promise. PetMate replaces that with a record anyone can check — and keeps working long after the sale.")}
          </p>

          <ul className="mt-10 space-y-3">
            {[
              {
                icon: BadgeCheck,
                tint: "var(--color-mint)",
                title: t("Verification that means something"),
                body: t("A vaccination entered by a clinic is marked differently from one typed in by a seller."),
              },
              {
                icon: Lock,
                tint: "var(--color-lagoon-400)",
                title: t("Escrow on every purchase"),
                body: t("Money is held until you have met the animal and you both confirm the handover."),
              },
              {
                icon: BedDouble,
                tint: "var(--color-sky)",
                title: t("Care while you're away"),
                body: t("Pet hotels and trainers with real availability, photo updates and pickup from your door."),
              },
            ].map((item, index) => (
              <li
                key={item.title}
                className="enter glass flex gap-4 rounded-2xl p-4"
                style={{ "--d": `${300 + index * 120}ms` } as React.CSSProperties}
              >
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl text-white"
                  style={{
                    background: `linear-gradient(140deg, ${item.tint}, color-mix(in srgb, ${item.tint} 60%, #000))`,
                  }}
                >
                  <item.icon className="size-5" aria-hidden />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-fg-muted">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
