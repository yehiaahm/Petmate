import { cn } from "@/lib/utils";

/**
 * The mark.
 *
 * A paw pad drawn as a shield: the shape says "pet", the silhouette says
 * "protected". It reads at 20px in a nav bar and at 200px on a landing page,
 * which is the only real test a logo has to pass.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={cn("size-8", className)}
      aria-hidden
      focusable="false"
    >
      <path
        d="M16 2.5 4.5 6.8v9.4c0 6.6 4.7 11.5 11.5 13.3 6.8-1.8 11.5-6.7 11.5-13.3V6.8L16 2.5Z"
        fill="currentColor"
      />
      {/* Toes */}
      <ellipse cx="11" cy="12.4" rx="1.85" ry="2.5" className="fill-[var(--bg)]" />
      <ellipse cx="16" cy="11.1" rx="1.95" ry="2.65" className="fill-[var(--bg)]" />
      <ellipse cx="21" cy="12.4" rx="1.85" ry="2.5" className="fill-[var(--bg)]" />
      {/* Pad */}
      <path
        d="M16 15.6c3.15 0 5.55 2.25 5.55 4.85 0 2.2-1.9 3.6-5.55 3.6s-5.55-1.4-5.55-3.6c0-2.6 2.4-4.85 5.55-4.85Z"
        className="fill-[var(--bg)]"
      />
    </svg>
  );
}

export function Logo({
  className,
  showWordmark = true,
  size = "md",
}: {
  className?: string;
  showWordmark?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = {
    sm: { mark: "size-6", text: "text-lg" },
    md: { mark: "size-8", text: "text-xl" },
    lg: { mark: "size-11", text: "text-3xl" },
  };

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark className={cn(sizes[size].mark, "text-brand")} />
      {showWordmark && (
        <span
          className={cn(
            "font-display font-semibold tracking-tight text-fg",
            sizes[size].text,
          )}
        >
          PetMate
        </span>
      )}
    </span>
  );
}
