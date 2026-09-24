import Link from "next/link";
import { cn, initials } from "@/lib/utils";

/* ---------------------------------------------------------------------------
 * Surfaces
 * ------------------------------------------------------------------------- */

export function Card({
  className,
  children,
  as: Tag = "div",
  interactive,
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  as?: "div" | "article" | "section" | "li";
  interactive?: boolean;
}) {
  return (
    <Tag
      className={cn("surface", interactive && "surface-lift", className)}
      {...props}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b border-[var(--border)] p-5", className)}>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-fg">{title}</h2>
        {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Badges & status
 * ------------------------------------------------------------------------- */

type BadgeTone =
  | "neutral"
  | "brand"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "info";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-bg-sunken text-fg-muted border-[var(--border)]",
  brand: "bg-brand-soft text-brand-soft-fg border-transparent",
  accent: "bg-accent-soft text-accent-soft-fg border-transparent",
  success: "bg-[var(--success-soft)] text-[var(--success)] border-transparent",
  warning: "bg-[var(--warning-soft)] text-[var(--warning)] border-transparent",
  danger: "bg-[var(--danger-soft)] text-[var(--danger)] border-transparent",
  info: "bg-[var(--info-soft)] text-[var(--info)] border-transparent",
};

export function Badge({
  tone = "neutral",
  children,
  className,
  icon,
  size = "md",
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-medium",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        BADGE_TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/**
 * Status pill with a dot. The dot is redundant with the colour on purpose:
 * colour alone fails for ~8% of men with a colour-vision deficiency, and the
 * shape gives a second channel.
 */
export function StatusPill({
  tone = "neutral",
  children,
  className,
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
  className?: string;
}) {
  const dot: Record<BadgeTone, string> = {
    neutral: "bg-fg-subtle",
    brand: "bg-brand",
    accent: "bg-accent",
    success: "bg-[var(--success)]",
    warning: "bg-[var(--warning)]",
    danger: "bg-[var(--danger)]",
    info: "bg-[var(--info)]",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        BADGE_TONES[tone],
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", dot[tone])} aria-hidden />
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * Avatar
 * ------------------------------------------------------------------------- */

const AVATAR_SIZES = {
  xs: "size-6 text-[10px]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-14 text-base",
  xl: "size-20 text-xl",
} as const;

export function Avatar({
  src,
  name,
  size = "md",
  className,
  ring,
}: {
  src?: string | null;
  name: string;
  size?: keyof typeof AVATAR_SIZES;
  className?: string;
  ring?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-brand-soft font-semibold text-brand-soft-fg",
        AVATAR_SIZES[size],
        ring && "ring-2 ring-[var(--bg)] ring-offset-0",
        className,
      )}
    >
      {src ? (
        // Avatars come from many hosts and are tiny; next/image adds no value
        // here and its loader would need every host allow-listed.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" loading="lazy" decoding="async" />
      ) : (
        <span aria-hidden>{initials(name)}</span>
      )}
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * Feedback states
 * ------------------------------------------------------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-[var(--radius-panel)] border border-dashed border-[var(--border-strong)] px-6 py-14 text-center",
        className,
      )}
    >
      {icon && (
        <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-bg-sunken text-fg-subtle">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-fg">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-fg-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
  icon,
  className,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  title?: string;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  const tones = {
    info: "bg-[var(--info-soft)] text-[var(--info)] border-[var(--info)]/25",
    success: "bg-[var(--success-soft)] text-[var(--success)] border-[var(--success)]/25",
    warning: "bg-[var(--warning-soft)] text-[var(--warning)] border-[var(--warning)]/25",
    danger: "bg-[var(--danger-soft)] text-[var(--danger)] border-[var(--danger)]/25",
  };
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-[var(--radius-field)] border p-3.5 text-sm", tones[tone], className)}
    >
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && "mt-1", "text-[13px] leading-relaxed opacity-90")}>{children}</div>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Structure
 * ------------------------------------------------------------------------- */

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-brand">
            {eyebrow}
          </p>
        )}
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
          {title}
        </h1>
        {description && (
          <div className="mt-2 max-w-2xl text-[15px] text-fg-muted">{description}</div>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function Breadcrumbs({
  items,
}: {
  items: { label: string; href?: string }[];
}) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4 text-sm">
      <ol className="flex flex-wrap items-center gap-1.5 text-fg-muted">
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && (
              <span aria-hidden className="text-fg-subtle">
                /
              </span>
            )}
            {item.href && i < items.length - 1 ? (
              <Link href={item.href} className="hover:text-fg hover:underline">
                {item.label}
              </Link>
            ) : (
              <span className={i === items.length - 1 ? "text-fg" : undefined} aria-current={i === items.length - 1 ? "page" : undefined}>
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Divider({ label, className }: { label?: string; className?: string }) {
  if (!label) return <hr className={cn("border-t border-[var(--border)]", className)} />;
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span className="h-px flex-1 bg-[var(--border)]" />
      <span className="text-xs font-medium uppercase tracking-wider text-fg-subtle">{label}</span>
      <span className="h-px flex-1 bg-[var(--border)]" />
    </div>
  );
}

/** Label/value row used across every detail panel. */
export function DataRow({
  label,
  value,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-2", className)}>
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="text-right text-sm font-medium text-fg">{value}</dd>
    </div>
  );
}

export function Stat({
  label,
  value,
  delta,
  hint,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  delta?: { value: string; positive: boolean };
  hint?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="surface p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-fg-muted">{label}</p>
        {icon && <span className="text-fg-subtle">{icon}</span>}
      </div>
      <p className="mt-2 font-display text-2xl font-semibold tabular text-fg">{value}</p>
      {(delta || hint) && (
        <p className="mt-1 flex items-center gap-1.5 text-xs">
          {delta && (
            <span
              className={cn(
                "font-semibold tabular",
                delta.positive ? "text-[var(--success)]" : "text-[var(--danger)]",
              )}
            >
              {delta.positive ? "▲" : "▼"} {delta.value}
            </span>
          )}
          {hint && <span className="text-fg-subtle">{hint}</span>}
        </p>
      )}
    </div>
  );
}
