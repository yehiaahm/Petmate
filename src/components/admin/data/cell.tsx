"use client";

import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { Badge, StatusPill } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/money";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { humanize, optionLabel, statusTone, type FieldDef, type ResourceDef } from "@/lib/admin/registry";
import { PLATFORM_CURRENCY } from "@/lib/currency";

export type RefLabels = Record<string, Record<string, string>>;

/** Enum columns whose values are lifecycle states get a status pill; the rest a quiet badge. */
const STATUS_LIKE = new Set(["status", "moderationStatus", "scanStatus", "priority", "outcome"]);

export function shortId(id: string) {
  return id.length > 10 ? `…${id.slice(-8)}` : id;
}

export function formatBps(value: number) {
  return `${(value / 100).toFixed(value % 100 === 0 ? 0 : 2)}%`;
}

/**
 * Renders one value by its field type. Shared by the table and the record
 * page so the same column reads the same way everywhere.
 */
export function Cell({
  def,
  field,
  row,
  refs,
  compact = true,
}: {
  def: ResourceDef;
  field: FieldDef;
  row: Record<string, unknown>;
  refs: RefLabels;
  compact?: boolean;
}) {
  const value = row[field.key];

  if (value === null || value === undefined || value === "") {
    return <span className="text-fg-subtle">—</span>;
  }

  switch (field.type) {
    case "id":
      return (
        <span className="font-mono text-xs text-fg-muted" title={String(value)}>
          {compact ? shortId(String(value)) : String(value)}
        </span>
      );

    case "ref": {
      const id = String(value);
      const label = field.ref ? refs[field.ref]?.[id] : undefined;
      return (
        <Link
          href={`/admin/data/${field.ref}/${id}`}
          className="font-medium text-fg underline-offset-2 hover:text-brand hover:underline"
          onClick={(e) => e.stopPropagation()}
          title={id}
        >
          {label ?? <span className="font-mono text-xs">{shortId(id)}</span>}
        </Link>
      );
    }

    case "enum": {
      const s = String(value);
      return STATUS_LIKE.has(field.key) || field.key === def.status ? (
        <StatusPill tone={statusTone(s)} className="whitespace-nowrap">
          {humanize(s)}
        </StatusPill>
      ) : (
        <Badge size="sm" className="whitespace-nowrap">
          {optionLabel(field, s)}
        </Badge>
      );
    }

    case "money": {
      const currency = field.currencyField ? (row[field.currencyField] as string | undefined) : undefined;
      return <span className="whitespace-nowrap tabular">{formatMoney(Number(value), currency ?? PLATFORM_CURRENCY)}</span>;
    }

    case "bps":
      return <span className="tabular">{formatBps(Number(value))}</span>;

    case "int":
    case "float":
      return <span className="tabular">{Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>;

    case "boolean":
      return value ? (
        <span className="inline-flex items-center gap-1 text-[var(--success)]">
          <Check className="size-4" aria-hidden />
          <span className="sr-only">Yes</span>
          {!compact && "Yes"}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-fg-subtle">
          <Minus className="size-4" aria-hidden />
          <span className="sr-only">No</span>
          {!compact && "No"}
        </span>
      );

    case "datetime": {
      const iso = String(value);
      return compact ? (
        <time dateTime={iso} title={formatDateTime(iso)} className="whitespace-nowrap text-fg-muted" suppressHydrationWarning>
          {relativeTime(iso)}
        </time>
      ) : (
        <time dateTime={iso} className="text-fg" suppressHydrationWarning>
          {formatDateTime(iso)}
          <span className="ml-1.5 text-xs text-fg-subtle">({relativeTime(iso)})</span>
        </time>
      );
    }

    case "json":
      return compact ? (
        <span className="font-mono text-xs text-fg-muted">{"{…}"}</span>
      ) : (
        <pre className="admin-scroll max-h-72 overflow-auto rounded-[10px] bg-bg-sunken p-3 font-mono text-xs leading-relaxed text-fg">
          {String(value)}
        </pre>
      );

    case "url":
      return (
        <a
          href={String(value)}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="break-all text-brand underline-offset-2 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {compact ? truncate(String(value), 40) : String(value)}
        </a>
      );

    default: {
      const s = String(value);
      return compact ? (
        <span title={s.length > 60 ? s : undefined}>{truncate(s, 60)}</span>
      ) : (
        <span className="whitespace-pre-wrap break-words">{s}</span>
      );
    }
  }
}

function truncate(s: string, n: number) {
  const flat = s.replace(/\s+/g, " ");
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
}
