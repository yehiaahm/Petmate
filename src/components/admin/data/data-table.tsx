"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Copy,
  Download,
  ExternalLink,
  Eye,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/primitives";
import { Pagination } from "@/components/ui/pagination";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { features } from "@/lib/features";
import { fieldOf, getResource, humanize, optionLabel, type FieldDef } from "@/lib/admin/registry";
import { cn } from "@/lib/utils";
import { AdminIcon } from "../icons";
import { Cell, shortId, type RefLabels } from "./cell";

type Row = Record<string, unknown> & { id: string };

export interface TableAccess {
  write: boolean;
  purge: boolean;
  editable: string[];
}

interface Query {
  q: string;
  sort: string | null;
  dir: "asc" | "desc" | null;
  view: "active" | "deleted" | "all";
  limit: number;
  filters: Record<string, string>;
}

type Pending = { action: "delete" | "restore" | "purge" | "set-status"; ids: string[]; value?: string } | null;

const CLINIC_RESOURCES = new Set(["clinics", "appointments"]);

export function DataTable({
  resource,
  rows,
  refs,
  total,
  page,
  pages,
  query,
  access,
  viewCounts,
  filterLabels,
}: {
  resource: string;
  rows: Row[];
  refs: RefLabels;
  total: number;
  page: number;
  pages: number;
  query: Query;
  access: TableAccess;
  viewCounts: { active: number | null; deleted: number | null } | null;
  /** Labels for ref filters that came in through a "related records" link. */
  filterLabels: Record<string, string>;
}) {
  const def = getResource(resource)!;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();
  const [navigating, startTransition] = useTransition();

  const [search, setSearch] = useState(query.q);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);

  const columns = def.columns.map((k) => fieldOf(def, k)).filter((f): f is FieldDef => Boolean(f));
  const selectedIds = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
  const allSelected = rows.length > 0 && selectedIds.length === rows.length;
  const canSelect = access.write;
  const statusEditable = def.status ? access.editable.includes(def.status) : false;
  const statusField = def.status ? fieldOf(def, def.status) : undefined;

  const enumFilters = def.fields.filter(
    (f) => (f.type === "enum" || f.type === "boolean") && f.filter,
  );
  const inlineFilters = enumFilters.slice(0, 3);
  const chipFilters = Object.entries(query.filters).filter(
    ([key]) => !inlineFilters.some((f) => f.key === key),
  );

  // Close the row menu on outside click or Escape.
  useEffect(() => {
    if (!menuFor) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e.type === "mousedown" && (e.target as HTMLElement).closest("[data-row-menu]")) return;
      setMenuFor(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menuFor]);

  function navigate(mutate: (p: URLSearchParams) => void, resetPage = true) {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    if (resetPage) next.delete("page");
    const qs = next.toString();
    setSelected(new Set());
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }

  function onSearchChange(value: string) {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      navigate((p) => (value.trim() ? p.set("q", value.trim()) : p.delete("q")));
    }, 350);
  }

  function toggleSort(key: string) {
    navigate((p) => {
      const same = query.sort === key;
      const dir = same && query.dir === "desc" ? "asc" : "desc";
      p.set("sort", key);
      p.set("dir", dir);
    }, false);
  }

  function setFilter(key: string, value: string) {
    navigate((p) => (value ? p.set(`f.${key}`, value) : p.delete(`f.${key}`)));
  }

  async function runBulk(action: NonNullable<Pending>) {
    setBusy(true);
    try {
      const result = await api.post<{ done: number; failed: { id: string; message: string }[] }>(
        `/api/admin/data/${resource}`,
        action,
      );
      const verb = {
        delete: "archived",
        restore: "restored",
        purge: "permanently deleted",
        "set-status": `set to ${humanize(action.value ?? "")}`,
      }[action.action];
      if (result.failed.length === 0) {
        toast.success(`${result.done} ${result.done === 1 ? def.label.toLowerCase() : def.plural.toLowerCase()} ${verb}`);
      } else {
        toast.error(
          `${result.done} done, ${result.failed.length} failed`,
          result.failed[0]?.message,
        );
      }
      setSelected(new Set());
      setPending(null);
      router.refresh();
    } catch (err) {
      toast.error("That did not go through", err instanceof ApiError ? err.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const exportHref = `/api/admin/data/${resource}/export${params.toString() ? `?${params}` : ""}`;
  const from = total === 0 ? 0 : (page - 1) * query.limit + 1;
  const to = Math.min(total, page * query.limit);
  const hidePublic = CLINIC_RESOURCES.has(resource) && !features.clinics;

  return (
    <div className="surface overflow-hidden shadow-[var(--shadow-subtle)]">
      {/* ---- Toolbar ------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] p-4">
        <div className="relative min-w-0 flex-1 basis-64 xl:max-w-md">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={`Search ${def.plural.toLowerCase()}…`}
            aria-label={`Search ${def.plural.toLowerCase()}`}
            className="h-10 w-full rounded-full border border-[var(--border-strong)] bg-bg-elevated pl-10 pr-4 text-sm text-fg placeholder:text-fg-subtle focus:border-[var(--brand)] focus:outline-none focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--brand)_18%,transparent)]"
          />
        </div>

        {inlineFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {inlineFilters.map((f) => (
              <select
                key={f.key}
                value={query.filters[f.key] ?? ""}
                onChange={(e) => setFilter(f.key, e.target.value)}
                aria-label={`Filter by ${f.label.toLowerCase()}`}
                className={cn(
                  "h-10 cursor-pointer rounded-full border bg-bg-elevated px-3.5 text-sm transition-colors focus:outline-none focus:border-[var(--brand)]",
                  query.filters[f.key] ? "border-[var(--brand)] font-semibold text-brand" : "border-[var(--border-strong)] text-fg-muted",
                )}
              >
                <option value="">{f.label}: all</option>
                {f.type === "boolean" ? (
                  <>
                    <option value="true">{f.label}: yes</option>
                    <option value="false">{f.label}: no</option>
                  </>
                ) : (
                  f.options?.map((o) => (
                    <option key={o} value={o}>
                      {optionLabel(f, o)}
                    </option>
                  ))
                )}
              </select>
            ))}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => startTransition(() => router.refresh())}
            className="flex size-10 items-center justify-center rounded-full border border-[var(--border-strong)] text-fg-muted transition-colors hover:border-[var(--brand)] hover:text-brand"
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw className={cn("size-4", navigating && "animate-spin")} aria-hidden />
          </button>
          <a
            href={exportHref}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--border-strong)] px-4 text-sm font-semibold text-fg transition-colors hover:border-[var(--brand)] hover:text-brand"
            download
          >
            <Download className="size-4" aria-hidden />
            Export CSV
          </a>
        </div>
      </div>

      {(def.softDelete || chipFilters.length > 0 || query.q) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-bg-sunken/50 px-4 py-2.5">
          {def.softDelete && (
            <div role="tablist" aria-label="Which records" className="mr-2 inline-flex rounded-full border border-[var(--border)] bg-bg-elevated p-0.5">
              {(["active", "deleted", "all"] as const).map((v) => {
                const count = v === "active" ? viewCounts?.active : v === "deleted" ? viewCounts?.deleted : null;
                return (
                  <button
                    key={v}
                    type="button"
                    role="tab"
                    aria-selected={query.view === v}
                    onClick={() => navigate((p) => (v === "active" ? p.delete("view") : p.set("view", v)))}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                      query.view === v ? "bg-brand text-brand-fg" : "text-fg-muted hover:text-fg",
                    )}
                  >
                    {v === "active" ? "Active" : v === "deleted" ? (def.key === "sessions" ? "Revoked" : "Archived") : "All"}
                    {typeof count === "number" && <span className="ml-1 opacity-75 tabular">{count.toLocaleString("en-US")}</span>}
                  </button>
                );
              })}
            </div>
          )}

          {query.q && (
            <FilterChip label={`Search: “${query.q}”`} onRemove={() => { setSearch(""); navigate((p) => p.delete("q")); }} />
          )}
          {chipFilters.map(([key, value]) => (
            <FilterChip
              key={key}
              label={`${fieldOf(def, key)?.label ?? key}: ${filterLabels[key] ?? (fieldOf(def, key)?.type === "enum" ? humanize(value) : shortId(value))}`}
              onRemove={() => setFilter(key, "")}
            />
          ))}
          {(chipFilters.length > 0 || query.q || Object.keys(query.filters).length > 0) && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                navigate((p) => {
                  for (const key of [...p.keys()]) if (key.startsWith("f.") || key === "q") p.delete(key);
                });
              }}
              className="text-xs font-semibold text-brand hover:underline"
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {/* ---- Bulk bar -------------------------------------------------------- */}
      {selectedIds.length > 0 && (
        <div className="animate-in-up flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-brand-soft px-4 py-2.5">
          <span className="text-sm font-semibold text-brand-soft-fg">
            {selectedIds.length} selected
          </span>
          <button type="button" onClick={() => setSelected(new Set())} className="text-xs font-semibold text-brand-soft-fg underline-offset-2 hover:underline">
            Clear
          </button>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {statusEditable && statusField?.options && (
              <select
                value=""
                onChange={(e) => e.target.value && setPending({ action: "set-status", ids: selectedIds, value: e.target.value })}
                aria-label="Set status for selected"
                className="h-9 cursor-pointer rounded-full border border-[var(--border-strong)] bg-bg-elevated px-3 text-sm font-medium text-fg"
              >
                <option value="">Set status…</option>
                {statusField.options.map((o) => (
                  <option key={o} value={o}>
                    {humanize(o)}
                  </option>
                ))}
              </select>
            )}
            {def.softDelete && query.view !== "deleted" && (
              <Button size="sm" variant="outline" onClick={() => setPending({ action: "delete", ids: selectedIds })}>
                <Trash2 className="size-4" aria-hidden />
                {def.key === "sessions" ? "Sign out" : "Archive"}
              </Button>
            )}
            {def.softDelete && def.softDelete.restorable !== false && query.view !== "active" && (
              <Button size="sm" variant="outline" onClick={() => setPending({ action: "restore", ids: selectedIds })}>
                <RotateCcw className="size-4" aria-hidden />
                Restore
              </Button>
            )}
            {access.purge && (
              <Button size="sm" variant="danger" onClick={() => setPending({ action: "purge", ids: selectedIds })}>
                <Trash2 className="size-4" aria-hidden />
                Delete permanently
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ---- Table ----------------------------------------------------------- */}
      <div className="relative">
        {navigating && (
          <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-brand-soft" aria-hidden>
            <div className="admin-progress h-full w-1/3 bg-brand" />
          </div>
        )}

        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<AdminIcon name={def.icon} />}
              title={query.q || Object.keys(query.filters).length ? `No ${def.plural.toLowerCase()} match` : `No ${def.plural.toLowerCase()} yet`}
              description={
                query.q || Object.keys(query.filters).length
                  ? "Try a different search or clear the filters."
                  : query.view === "deleted"
                    ? "Nothing has been archived."
                    : "Records appear here as soon as they are created."
              }
            />
          </div>
        ) : (
          <div className={cn("admin-scroll overflow-x-auto transition-opacity", navigating && "opacity-60")}>
            <table className="admin-table w-full min-w-[720px] text-left text-sm">
              <thead className="bg-bg-sunken/60 text-xs uppercase tracking-wide text-fg-subtle">
                <tr>
                  {canSelect && (
                    <th scope="col" className="w-10 py-3 pl-4 pr-1">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = selectedIds.length > 0 && !allSelected;
                        }}
                        onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                        aria-label="Select all on this page"
                        className="size-4 cursor-pointer accent-[var(--brand)]"
                      />
                    </th>
                  )}
                  {columns.map((col, i) => {
                    const sortable = col.type !== "json" && col.type !== "textarea";
                    const active = query.sort === col.key || (!query.sort && def.sort.field === col.key);
                    const dir = query.sort === col.key ? query.dir : def.sort.field === col.key ? def.sort.dir : null;
                    return (
                      <th
                        key={col.key}
                        scope="col"
                        aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
                        className={cn("whitespace-nowrap px-3 py-3 font-semibold", i === 0 && !canSelect && "pl-4")}
                      >
                        {sortable ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(col.key)}
                            className={cn("inline-flex items-center gap-1 uppercase hover:text-fg", active && "text-fg")}
                          >
                            {col.label}
                            {active ? (
                              dir === "asc" ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden />
                            ) : (
                              <ArrowUpDown className="size-3.5 opacity-40" aria-hidden />
                            )}
                          </button>
                        ) : (
                          col.label
                        )}
                      </th>
                    );
                  })}
                  <th scope="col" className="w-12 py-3 pr-4">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rows.map((row) => {
                  const href = `/admin/data/${resource}/${row.id}`;
                  const isSelected = selected.has(row.id);
                  const archived =
                    def.softDelete &&
                    (def.softDelete.value === "now"
                      ? row[def.softDelete.field] != null
                      : row[def.softDelete.field] === def.softDelete.value);
                  const publicPath = !hidePublic && def.publicPath ? def.publicPath(row) : null;

                  return (
                    <tr
                      key={row.id}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("a,button,input,select,label,[data-row-menu]")) return;
                        router.push(href);
                      }}
                      className={cn(
                        "cursor-pointer bg-bg-elevated transition-colors hover:bg-bg-sunken/70",
                        isSelected && "bg-brand-soft/60 hover:bg-brand-soft",
                        archived && "opacity-60",
                      )}
                    >
                      {canSelect && (
                        <td className="py-3 pl-4 pr-1">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (next.has(row.id)) next.delete(row.id);
                                else next.add(row.id);
                                return next;
                              })
                            }
                            aria-label={`Select ${String(row[def.title] ?? row.id)}`}
                            className="size-4 cursor-pointer accent-[var(--brand)]"
                          />
                        </td>
                      )}
                      {columns.map((col, i) => (
                        <td key={col.key} className={cn("max-w-[280px] px-3 py-3 align-middle text-fg", i === 0 && !canSelect && "pl-4")}>
                          {i === 0 && col.type === "ref" ? (
                            // A ref cell is already a link (to the referenced record), and
                            // links cannot nest; the row itself and its menu open this record.
                            <div className="min-w-0 font-semibold">
                              <Cell def={def} field={col} row={row} refs={refs} />
                              <Subtitle def={def} row={row} column={col.key} />
                            </div>
                          ) : i === 0 ? (
                            <Link href={href} className="block min-w-0 font-semibold text-fg hover:text-brand">
                              <span className="block truncate">
                                {row[col.key] == null || row[col.key] === "" ? (
                                  <span className="font-mono text-xs font-normal text-fg-muted">{shortId(row.id)}</span>
                                ) : (
                                  <Cell def={def} field={col} row={row} refs={refs} />
                                )}
                              </span>
                              <Subtitle def={def} row={row} column={col.key} />
                            </Link>
                          ) : (
                            <Cell def={def} field={col} row={row} refs={refs} />
                          )}
                        </td>
                      ))}
                      <td className="relative py-3 pr-4 text-right" data-row-menu>
                        <button
                          type="button"
                          onClick={() => setMenuFor(menuFor === row.id ? null : row.id)}
                          className="rounded-full p-1.5 text-fg-subtle transition-colors hover:bg-bg-inset hover:text-fg"
                          aria-label="Row actions"
                          aria-expanded={menuFor === row.id}
                          aria-haspopup="menu"
                        >
                          <MoreHorizontal className="size-4" aria-hidden />
                        </button>
                        {menuFor === row.id && (
                          <div
                            role="menu"
                            className="animate-in-up absolute right-4 top-11 z-20 w-52 overflow-hidden rounded-[14px] border border-[var(--border)] bg-bg-elevated p-1 text-left shadow-[var(--shadow-pop)]"
                          >
                            <MenuLink href={href} icon={<Eye className="size-4" aria-hidden />} label="Open record" />
                            {publicPath && (
                              <MenuLink href={publicPath} icon={<ExternalLink className="size-4" aria-hidden />} label="View on site" external />
                            )}
                            <MenuButton
                              icon={<Copy className="size-4" aria-hidden />}
                              label="Copy ID"
                              onClick={() => {
                                void navigator.clipboard?.writeText(row.id);
                                toast.info("ID copied");
                                setMenuFor(null);
                              }}
                            />
                            {access.write && def.softDelete && !archived && (
                              <MenuButton
                                icon={<Trash2 className="size-4" aria-hidden />}
                                label={def.key === "sessions" ? "Sign out" : "Archive"}
                                onClick={() => {
                                  setMenuFor(null);
                                  setPending({ action: "delete", ids: [row.id] });
                                }}
                              />
                            )}
                            {access.write && def.softDelete && archived && def.softDelete.restorable !== false && (
                              <MenuButton
                                icon={<RotateCcw className="size-4" aria-hidden />}
                                label="Restore"
                                onClick={() => {
                                  setMenuFor(null);
                                  setPending({ action: "restore", ids: [row.id] });
                                }}
                              />
                            )}
                            {access.purge && (
                              <MenuButton
                                danger
                                icon={<Trash2 className="size-4" aria-hidden />}
                                label="Delete permanently"
                                onClick={() => {
                                  setMenuFor(null);
                                  setPending({ action: "purge", ids: [row.id] });
                                }}
                              />
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---- Footer ---------------------------------------------------------- */}
      <div className="flex flex-col items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3 sm:flex-row">
        <div className="flex items-center gap-3 text-sm text-fg-muted">
          <span className="tabular">
            {total === 0 ? "No records" : `${from.toLocaleString("en-US")}–${to.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`}
          </span>
          <select
            value={query.limit}
            onChange={(e) => navigate((p) => (e.target.value === "25" ? p.delete("limit") : p.set("limit", e.target.value)))}
            aria-label="Rows per page"
            className="h-8 cursor-pointer rounded-full border border-[var(--border)] bg-bg-elevated px-2.5 text-xs text-fg-muted"
          >
            {[25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n} per page
              </option>
            ))}
          </select>
        </div>
        <Pagination page={page} pages={pages} />
      </div>

      <ConfirmDialog
        open={pending !== null}
        onClose={() => !busy && setPending(null)}
        onConfirm={() => pending && void runBulk(pending)}
        loading={busy}
        tone={pending?.action === "restore" || pending?.action === "set-status" ? "primary" : "danger"}
        title={confirmTitle(pending, def.label, def.plural, def.key)}
        description={confirmBody(pending, def.plural)}
        confirmLabel={
          pending?.action === "purge"
            ? "Delete permanently"
            : pending?.action === "restore"
              ? "Restore"
              : pending?.action === "set-status"
                ? "Apply"
                : def.key === "sessions"
                  ? "Sign out"
                  : "Archive"
        }
      />
    </div>
  );
}

function confirmTitle(p: Pending, label: string, plural: string, key: string) {
  if (!p) return "";
  const what = p.ids.length === 1 ? `this ${label.toLowerCase()}` : `${p.ids.length} ${plural.toLowerCase()}`;
  switch (p.action) {
    case "purge":
      return `Permanently delete ${what}?`;
    case "restore":
      return `Restore ${what}?`;
    case "set-status":
      return `Set ${what} to ${humanize(p.value ?? "")}?`;
    default:
      return key === "sessions" ? `Sign out ${what}?` : `Archive ${what}?`;
  }
}

function confirmBody(p: Pending, plural: string) {
  if (!p) return "";
  switch (p.action) {
    case "purge":
      return "This removes the rows from the database and cannot be undone. Anything that cascades from them is removed too. Prefer archiving unless you must erase the data.";
    case "restore":
      return "The records become visible again exactly as they were before they were archived.";
    case "set-status":
      return `The status changes immediately. This edits the records directly — side effects of the normal flow (emails, refunds, payouts) do not run.`;
    default:
      return `Archived ${plural.toLowerCase()} disappear from the product but stay in the database, and can be restored at any time from the Archived view.`;
  }
}

function Subtitle({ def, row, column }: { def: NonNullable<ReturnType<typeof getResource>>; row: Row; column: string }) {
  const value = def.subtitle && def.subtitle !== column ? row[def.subtitle] : null;
  if (typeof value !== "string" || !value) return null;
  return (
    <span className="mt-0.5 block truncate text-xs font-normal text-fg-muted">
      {/^[A-Z][A-Z_]+$/.test(value) ? humanize(value) : value}
    </span>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--brand)]/40 bg-brand-soft py-0.5 pl-2.5 pr-1 text-xs font-medium text-brand-soft-fg">
      {label}
      <button type="button" onClick={onRemove} className="rounded-full p-0.5 hover:bg-bg-elevated" aria-label={`Remove filter ${label}`}>
        <X className="size-3" aria-hidden />
      </button>
    </span>
  );
}

function MenuLink({ href, icon, label, external }: { href: string; icon: React.ReactNode; label: string; external?: boolean }) {
  return (
    <Link
      role="menuitem"
      href={href}
      target={external ? "_blank" : undefined}
      className="flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-sm text-fg-muted hover:bg-bg-sunken hover:text-fg"
    >
      {icon}
      {label}
    </Link>
  );
}

function MenuButton({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      role="menuitem"
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-sm",
        danger ? "text-[var(--danger)] hover:bg-[var(--danger-soft)]" : "text-fg-muted hover:bg-bg-sunken hover:text-fg",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
