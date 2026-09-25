"use client";

import { forwardRef, useId } from "react";
import { AlertCircle, Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n/i18n-provider";

/**
 * Form controls.
 *
 * Every control is wired to a real <label>, and errors are tied through
 * aria-describedby + aria-invalid so assistive tech reports them. Error state
 * is never communicated by colour alone: there is always an icon and text.
 */

const CONTROL_BASE =
  "w-full rounded-[var(--radius-field)] border bg-bg-elevated px-3.5 text-[15px] text-fg placeholder:text-fg-subtle transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-0 focus:border-transparent disabled:cursor-not-allowed disabled:bg-bg-sunken disabled:opacity-70";

export interface FieldProps {
  label?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => React.ReactNode;
  className?: string;
  /** Right-aligned text next to the label, e.g. a character counter. */
  trailing?: React.ReactNode;
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
  trailing,
}: FieldProps) {
  const { t } = useI18n();
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      {(label || trailing) && (
        <div className="flex items-baseline justify-between gap-3">
          {label && (
            <label htmlFor={id} className="text-sm font-medium text-fg">
              {label}
              {required && (
                <span className="ms-0.5 text-[var(--danger)]" aria-hidden>
                  *
                </span>
              )}
              {required && <span className="sr-only"> {t("(required)")}</span>}
            </label>
          )}
          {trailing && <span className="text-xs text-fg-subtle tabular">{trailing}</span>}
        </div>
      )}

      {children({ id, describedBy, invalid: Boolean(error) })}

      {hint && !error && (
        <p id={hintId} className="text-xs text-fg-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="flex items-start gap-1.5 text-xs font-medium text-[var(--danger)]">
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, leading, trailing, ...props },
  ref,
) {
  const control = (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL_BASE,
        "h-11",
        invalid ? "border-[var(--danger)]" : "border-[var(--border-strong)]",
        leading && "ps-10",
        trailing && "pe-10",
        className,
      )}
      {...props}
    />
  );

  if (!leading && !trailing) return control;

  return (
    <div className="relative">
      {leading && (
        <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-fg-subtle">
          {leading}
        </span>
      )}
      {control}
      {trailing && (
        <span className="absolute end-3 top-1/2 -translate-y-1/2 text-fg-subtle">{trailing}</span>
      )}
    </div>
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className, invalid, rows = 4, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL_BASE,
        "resize-y py-2.5 leading-relaxed",
        invalid ? "border-[var(--danger)]" : "border-[var(--border-strong)]",
        className,
      )}
      {...props}
    />
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }
>(function Select({ className, invalid, children, ...props }, ref) {
  return (
    <div className="relative">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          CONTROL_BASE,
          "h-11 cursor-pointer appearance-none pe-10",
          invalid ? "border-[var(--danger)]" : "border-[var(--border-strong)]",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
        aria-hidden
      />
    </div>
  );
});

export const Checkbox = forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { label: React.ReactNode; hint?: string }
>(function Checkbox({ className, label, hint, id: providedId, ...props }, ref) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <span className="relative mt-0.5 flex size-5 shrink-0">
        <input
          ref={ref}
          id={id}
          type="checkbox"
          className="peer size-5 cursor-pointer appearance-none rounded-[6px] border border-[var(--border-strong)] bg-bg-elevated transition-colors checked:border-brand checked:bg-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:opacity-50"
          {...props}
        />
        <Check
          className="pointer-events-none absolute inset-0 m-auto size-3.5 text-brand-fg opacity-0 peer-checked:opacity-100"
          aria-hidden
        />
      </span>
      <label htmlFor={id} className="cursor-pointer select-none text-sm leading-snug text-fg">
        {label}
        {hint && <span className="mt-0.5 block text-xs text-fg-muted">{hint}</span>}
      </label>
    </div>
  );
});

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  name,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  name?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium text-fg">
          {label}
        </label>
        {description && <p className="mt-0.5 text-xs text-fg-muted">{description}</p>}
      </div>
      <button
        id={id}
        name={name}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50",
          checked ? "bg-brand" : "bg-[var(--border-strong)]",
        )}
      >
        <span
          className={cn(
            // Anchored to the start edge explicitly: a button centres its
            // content, so an un-inset knob started mid-track and the "on"
            // translate pushed it off the end of the switch.
            "absolute start-0 top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform duration-200",
            checked ? "translate-x-5.5 rtl:-translate-x-5.5" : "translate-x-0.5 rtl:-translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

/**
 * A switch with no visible label, for grids and table cells where the row and
 * column headings already say what it controls. The accessible name still has
 * to be explicit, so `label` is required and rendered as `aria-label`.
 */
export function ToggleSwitch({
  checked,
  onChange,
  label,
  disabled,
  name,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  name?: string;
}) {
  return (
    <button
      name={name}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50",
        checked ? "bg-brand" : "bg-[var(--border-strong)]",
      )}
    >
      <span
        className={cn(
          "absolute start-0 top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform duration-200",
          checked ? "translate-x-5.5 rtl:-translate-x-5.5" : "translate-x-0.5 rtl:-translate-x-0.5",
        )}
      />
    </button>
  );
}

/** Segmented control. Used wherever a select would hide 2-4 important choices. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: { value: T; label: string; icon?: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
    className?: string;
}) {
  // Option labels often come from shared constants, so translate them here.
  const { t } = useI18n();
  return (
    <div
      role="radiogroup"
      aria-label={t(label)}
      className={cn(
        "inline-flex w-full rounded-[var(--radius-field)] border border-[var(--border)] bg-bg-sunken p-1",
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-[calc(var(--radius-field)-2px)] px-3 py-2 text-sm font-medium transition-all duration-150",
              active
                ? "bg-bg-elevated text-fg shadow-[var(--shadow-subtle)]"
                : "text-fg-muted hover:text-fg",
            )}
          >
                        {o.icon}
            {t(o.label)}
          </button>
        );
      })}
    </div>
  );
}
