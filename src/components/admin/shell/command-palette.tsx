"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CornerDownLeft, Loader2, Search } from "lucide-react";
import { api } from "@/lib/api-client";
import { humanize, statusTone, type IconName } from "@/lib/admin/registry";
import { cn } from "@/lib/utils";
import { StatusPill } from "@/components/ui/primitives";
import { AdminIcon, type NavIconName } from "../icons";
import type { NavSection } from "./admin-shell";

interface SearchGroup {
  resource: string;
  label: string;
  icon: IconName;
  items: { id: string; title: string; subtitle: string | null; status: string | null }[];
}

interface Entry {
  key: string;
  href: string;
  title: string;
  hint?: string | null;
  icon: NavIconName;
  status?: string | null;
  group: string;
}

/**
 * Command palette: jump to any page, or find any record by name, email,
 * order number or reference. Results come from one server query across every
 * table the signed-in role can read, so it never offers a record the caller
 * would then be refused.
 */
export function CommandPalette({
  open,
  onClose,
  sections,
}: {
  open: boolean;
  onClose: () => void;
  sections: NavSection[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState<{ q: string; groups: SearchGroup[] }>({ q: "", groups: [] });
  const listRef = useRef<HTMLDivElement>(null);

  const term = query.trim();

  useEffect(() => {
    if (!open || term.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .get<{ groups: SearchGroup[] }>(`/api/admin/search?q=${encodeURIComponent(term)}`, controller.signal)
        .then((res) => setRemote({ q: term, groups: res.groups }))
        .catch(() => {
          if (!controller.signal.aborted) setRemote({ q: term, groups: [] });
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, term]);

  useEffect(() => {
    if (!open) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [open]);

  const loading = term.length >= 2 && remote.q !== term;

  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    if (term.length >= 2 && remote.q === term) {
      for (const group of remote.groups) {
        for (const item of group.items) {
          out.push({
            key: `${group.resource}:${item.id}`,
            href: `/admin/data/${group.resource}/${item.id}`,
            title: item.title,
            hint: item.subtitle && item.subtitle !== item.title ? humanizeMaybe(item.subtitle) : null,
            icon: group.icon,
            status: item.status,
            group: group.label,
          });
        }
      }
    }

    const needle = term.toLowerCase();
    for (const section of sections) {
      for (const item of section.items) {
        if (needle && !`${item.label} ${section.title}`.toLowerCase().includes(needle)) continue;
        out.push({
          key: `page:${item.href}`,
          href: item.href,
          title: item.label,
          hint: section.title,
          icon: item.icon,
          group: "Go to",
        });
      }
    }
    return out;
  }, [remote, sections, term]);

  if (!open) return null;

  const clamped = Math.min(active, Math.max(0, entries.length - 1));

  function go(entry: Entry | undefined) {
    if (!entry) return;
    onClose();
    router.push(entry.href);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = Math.min(entries.length - 1, clamped + 1);
      setActive(next);
      scrollIntoView(next);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const next = Math.max(0, clamped - 1);
      setActive(next);
      scrollIntoView(next);
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(entries[clamped]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  function scrollIntoView(index: number) {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }

  let lastGroup = "";

  return (
    <div className="fixed inset-0 z-[75] flex items-start justify-center p-3 pt-[10vh] sm:p-6 sm:pt-[12vh]">
      <div className="animate-fade absolute inset-0 bg-[var(--overlay)] backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search the console"
        className="animate-in-up relative flex max-h-[72vh] w-full max-w-2xl flex-col overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border)] bg-bg-elevated shadow-[var(--shadow-pop)]"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-5">
          {loading ? (
            <Loader2 className="size-5 shrink-0 animate-spin text-brand" aria-hidden />
          ) : (
            <Search className="size-5 shrink-0 text-fg-subtle" aria-hidden />
          )}
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="Search records or jump to a page…"
            className="h-16 w-full bg-transparent text-base text-fg placeholder:text-fg-subtle focus:outline-none"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={entries[clamped] ? `palette-${clamped}` : undefined}
            aria-autocomplete="list"
          />
          <kbd className="admin-kbd hidden sm:inline-flex">Esc</kbd>
        </div>

        <div ref={listRef} id="palette-results" role="listbox" className="admin-scroll flex-1 overflow-y-auto p-2">
          {entries.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-fg-muted">
              {loading ? "Searching…" : `Nothing matches “${term}”.`}
            </p>
          ) : (
            entries.map((entry, index) => {
              const header = entry.group !== lastGroup ? entry.group : null;
              lastGroup = entry.group;
              return (
                <div key={entry.key}>
                  {header && (
                    <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-subtle first:pt-1">
                      {header}
                    </p>
                  )}
                  <button
                    type="button"
                    id={`palette-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={index === clamped}
                    onMouseMove={() => index !== clamped && setActive(index)}
                    onClick={() => go(entry)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left transition-colors",
                      index === clamped ? "bg-brand-soft" : "hover:bg-bg-sunken",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-[var(--border)]",
                        index === clamped ? "bg-bg-elevated text-brand" : "bg-bg-sunken text-fg-muted",
                      )}
                    >
                      <AdminIcon name={entry.icon} className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">{entry.title}</span>
                      {entry.hint && <span className="block truncate text-xs text-fg-muted">{entry.hint}</span>}
                    </span>
                    {entry.status && (
                      <StatusPill tone={statusTone(entry.status)} className="hidden sm:inline-flex">
                        {humanize(entry.status)}
                      </StatusPill>
                    )}
                    {index === clamped ? (
                      <CornerDownLeft className="size-4 shrink-0 text-brand" aria-hidden />
                    ) : (
                      <ArrowRight className="size-4 shrink-0 text-fg-subtle opacity-0" aria-hidden />
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="hidden items-center gap-4 border-t border-[var(--border)] px-5 py-2.5 text-xs text-fg-muted sm:flex">
          <span className="flex items-center gap-1.5">
            <kbd className="admin-kbd">↑</kbd>
            <kbd className="admin-kbd">↓</kbd>
            to move
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="admin-kbd">Enter</kbd>
            to open
          </span>
          <span className="ml-auto">Searches names, emails, references and order numbers</span>
        </div>
      </div>
    </div>
  );
}

function humanizeMaybe(value: string): string {
  return /^[A-Z][A-Z_]+$/.test(value) ? humanize(value) : value;
}
