import { Bird, Cat, Dog, Heart, Lock, Rabbit, ShieldCheck, Stethoscope, Turtle, type LucideIcon } from "lucide-react";
import { LogoBadge } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { getI18n } from "@/lib/i18n/server";

/**
 * The hero centrepiece: the brand mark draws itself on a floating tile while
 * the animals the product serves orbit around it, and three proof points
 * drift beside it. All CSS — nothing here needs to hydrate.
 *
 * The rings are symmetric, so they need nothing for right-to-left; the proof
 * points sit on logical sides and swap over with the text.
 */
export async function HeroVisual({ className }: { className?: string }) {
  const { t } = await getI18n();
  return (
    <div className={cn("relative mx-auto aspect-square w-full", className)} aria-hidden>
      {/* Glow behind the tile */}
      <div className="absolute inset-[14%] rounded-full bg-[radial-gradient(circle,var(--aurora-1)_0%,transparent_68%)] blur-2xl" />
      <div className="absolute inset-[22%] rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--brand)_22%,transparent)_0%,transparent_70%)] blur-xl" />

      {/* Outer ring */}
      <div className="orbit" style={{ "--orbit-speed": "60s" } as React.CSSProperties}>
        <OrbitIcon icon={Dog} tint="var(--color-sun)" style={{ top: "0%", left: "50%" }} />
        <OrbitIcon icon={Cat} tint="var(--color-grape)" style={{ top: "50%", left: "100%" }} />
        <OrbitIcon icon={Bird} tint="var(--color-sky)" style={{ top: "100%", left: "50%" }} />
        <OrbitIcon icon={Rabbit} tint="var(--color-rose)" style={{ top: "50%", left: "0%" }} />
      </div>

      {/* Inner ring, turning the other way */}
      <div
        className="orbit orbit-reverse"
        style={{ inset: "15%", "--orbit-speed": "42s" } as React.CSSProperties}
      >
        <OrbitIcon icon={Heart} tint="var(--color-coral-500)" small style={{ top: "14.6%", left: "85.4%" }} />
        <OrbitIcon icon={Turtle} tint="var(--color-mint)" small style={{ top: "85.4%", left: "14.6%" }} />
        <OrbitIcon icon={Stethoscope} tint="var(--color-lagoon-500)" small style={{ top: "14.6%", left: "14.6%" }} />
      </div>

      {/* The mark */}
      <div className="absolute inset-[29%] animate-float">
        <LogoBadge
          animated
          className="size-full rounded-[28%] shadow-[0_30px_60px_-20px_rgb(8_40_48/0.55),0_0_0_1px_rgb(255_255_255/0.06)]"
        />
      </div>

      {/* Proof points */}
      <FloatingChip
        icon={ShieldCheck}
        label={t("Vet verified")}
        tint="var(--color-mint)"
        className="start-[-14%] top-[8%] [animation-delay:-2s] sm:start-[-2%] sm:top-[20%]"
      />
      <FloatingChip
        icon={Lock}
        label={t("Escrow protected")}
        tint="var(--color-lagoon-500)"
        className="bottom-[10%] end-[-18%] [animation-delay:-5s] sm:bottom-[16%] sm:end-[-4%]"
      />
      <FloatingChip
        icon={Heart}
        label={t("Loved by owners")}
        tint="var(--color-rose)"
        className="bottom-[2%] start-[6%] hidden sm:flex [animation-delay:-7s]"
      />
    </div>
  );
}

function OrbitIcon({
  icon: Icon,
  tint,
  small = false,
  style,
}: {
  icon: LucideIcon;
  tint: string;
  small?: boolean;
  style: React.CSSProperties;
}) {
  return (
    <span
      className={cn(
        "orbit-item flex items-center justify-center rounded-2xl border border-[var(--glass-border)] shadow-[var(--shadow-card)] backdrop-blur",
        small ? "-m-4 size-8 rounded-xl" : "-m-[22px] size-11",
      )}
      style={{
        ...style,
        color: tint,
        background: `color-mix(in srgb, ${tint} 16%, var(--bg-elevated))`,
      }}
    >
      <Icon className={small ? "size-4" : "size-5"} strokeWidth={2.2} />
    </span>
  );
}

function FloatingChip({
  icon: Icon,
  label,
  tint,
  className,
}: {
  icon: LucideIcon;
  label: string;
  tint: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "glass animate-float-slow absolute flex items-center gap-2 rounded-2xl py-1.5 ps-1.5 pe-3 text-[11px] font-semibold text-fg shadow-[var(--shadow-lift)] sm:text-xs",
        className,
      )}
    >
      <span
        className="flex size-6 items-center justify-center rounded-xl text-white sm:size-7"
        style={{ background: `linear-gradient(135deg, ${tint}, color-mix(in srgb, ${tint} 70%, #000))` }}
      >
        <Icon className="size-3.5" strokeWidth={2.4} />
      </span>
      {label}
    </div>
  );
}
