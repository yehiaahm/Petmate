import { forwardRef } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant =
  | "primary"
  | "accent"
  | "secondary"
  | "outline"
  | "ghost"
  | "danger"
  | "link";
type Size = "sm" | "md" | "lg" | "icon" | "icon-sm";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-brand text-brand-fg hover:bg-brand-hover shadow-[var(--shadow-subtle)] active:translate-y-px",
  accent:
    "bg-accent text-accent-fg hover:bg-accent-hover shadow-[var(--shadow-subtle)] active:translate-y-px",
  secondary:
    "bg-bg-sunken text-fg hover:bg-bg-inset border border-[var(--border)]",
  outline:
    "border border-[var(--border-strong)] bg-transparent text-fg hover:bg-bg-sunken",
  ghost: "text-fg-muted hover:bg-bg-sunken hover:text-fg",
  danger:
    "bg-[var(--danger)] text-white hover:brightness-110 shadow-[var(--shadow-subtle)]",
  link: "text-brand underline-offset-4 hover:underline p-0 h-auto",
};

const SIZES: Record<Size, string> = {
  // 44px tall: the minimum comfortable touch target, not 32px.
  sm: "h-9 px-3 text-sm gap-1.5 rounded-[var(--radius-field)]",
  md: "h-11 px-4 text-sm gap-2 rounded-[var(--radius-field)]",
  lg: "h-12 px-6 text-base gap-2 rounded-xl",
  icon: "size-11 rounded-[var(--radius-field)]",
  "icon-sm": "size-9 rounded-[var(--radius-field)]",
};

const BASE =
  "inline-flex items-center justify-center font-semibold whitespace-nowrap transition-all duration-150 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Announced while `loading` is true, so the state is not colour-only. */
  loadingText?: string;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = "primary",
    size = "md",
    loading = false,
    loadingText,
    fullWidth,
    disabled,
    children,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && "w-full", className)}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {loading && loadingText ? loadingText : children}
    </button>
  );
});

export interface ButtonLinkProps extends React.ComponentPropsWithoutRef<typeof Link> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
}

/** Anything that navigates is an anchor. Middle-click and "open in new tab" work. */
export function ButtonLink({
  className,
  variant = "primary",
  size = "md",
  fullWidth,
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      className={cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && "w-full", className)}
      {...props}
    />
  );
}
