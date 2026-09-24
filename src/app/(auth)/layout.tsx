import Link from "next/link";
import { BadgeCheck, Lock, Stethoscope } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { getI18n } from "@/lib/i18n/server";

/**
 * Auth layout.
 *
 * A split: the form on one side, the reason to bother on the other. The right
 * panel is hidden below `lg` rather than stacked, because on a phone the only
 * thing that matters is getting to the first field.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getI18n();
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col">
        <header className="flex items-center justify-between p-6">
          <Link href="/" aria-label={t("PetMate home")}>
            <Logo size="sm" />
          </Link>
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <ThemeToggle />
          </div>
        </header>

        <main id="main" className="flex flex-1 items-center justify-center px-6 pb-16">
          <div className="w-full max-w-sm">{children}</div>
        </main>
      </div>

      <aside className="relative hidden overflow-hidden bg-[var(--color-pine-700)] lg:flex lg:flex-col lg:justify-center">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(80% 60% at 20% 10%, color-mix(in srgb, #ffffff 14%, transparent) 0%, transparent 60%), radial-gradient(70% 70% at 90% 90%, color-mix(in srgb, var(--color-ember-400) 22%, transparent) 0%, transparent 55%)",
          }}
          aria-hidden
        />

        <div className="relative mx-auto max-w-md px-12 py-16">
          <h2 className="font-display text-3xl font-semibold leading-tight text-white">
            {t("The pet record that outlives the transaction")}
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-[color-mix(in_srgb,#ffffff_78%,transparent)]">
            {t("Most pets change hands with a photo, a phone number and a promise. PetMate replaces that with a record anyone can check — and keeps working long after the sale.")}
          </p>

          <ul className="mt-10 space-y-6">
            {[
              {
                icon: BadgeCheck,
                title: t("Verification that means something"),
                body: t("A vaccination entered by a clinic is marked differently from one typed in by a seller."),
              },
              {
                icon: Lock,
                title: t("Escrow on every purchase"),
                body: t("Money is held until you have met the animal and you both confirm the handover."),
              },
              {
                icon: Stethoscope,
                title: t("Your vet, in the same place"),
                body: t("Book a real appointment and the results land in your pet's timeline automatically."),
              },
            ].map((item) => (
              <li key={item.title} className="flex gap-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/12 text-white">
                  <item.icon className="size-[18px]" aria-hidden />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-[color-mix(in_srgb,#ffffff_70%,transparent)]">
                    {item.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
