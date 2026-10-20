"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAppPathname } from "@/components/i18n/use-app-pathname";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  X,
} from "lucide-react";
import { LogoBadge } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Avatar } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { getResource } from "@/lib/admin/registry";
import { cn } from "@/lib/utils";
import { AdminIcon, type NavIconName } from "../icons";
import { CommandPalette } from "./command-palette";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIconName;
  badge?: number;
  exact?: boolean;
}

export interface NavSection {
  title: string;
  items: NavItem[];
  /** Collapsible groups start closed unless they contain the current page. */
  collapsible?: boolean;
  icon?: NavIconName;
}

export interface ShellUser {
  name: string;
  email: string;
  handle: string;
  avatarUrl: string | null;
  roleLabel: string;
}

// ---------------------------------------------------------------------------
// Sidebar collapse, remembered per browser. Storage can be unavailable
// (private windows, blocked site data), so it falls back to memory.
// ---------------------------------------------------------------------------

const COLLAPSE_KEY = "pm-admin-sidebar";
const COLLAPSE_EVENT = "pm-admin-sidebar-change";
let collapsedMemory = false;

function readCollapsed(): boolean {
  try {
    const stored = window.localStorage.getItem(COLLAPSE_KEY);
    return stored === null ? collapsedMemory : stored === "1";
  } catch {
    return collapsedMemory;
  }
}

function writeCollapsed(value: boolean) {
  collapsedMemory = value;
  try {
    window.localStorage.setItem(COLLAPSE_KEY, value ? "1" : "0");
  } catch {
    // Memory fallback already holds it.
  }
  window.dispatchEvent(new Event(COLLAPSE_EVENT));
}

function subscribeCollapsed(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(COLLAPSE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(COLLAPSE_EVENT, callback);
  };
}

function isActive(pathname: string, item: NavItem) {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function AdminShell({
  sections,
  user,
  children,
}: {
  sections: NavSection[];
  user: ShellUser;
  children: React.ReactNode;
}) {
  const pathname = useAppPathname();
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // ⌘K / Ctrl+K anywhere, and "/" when not typing, open the palette.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "");
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (event.key === "/" && !typing) {
        event.preventDefault();
        setPaletteOpen(true);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const sidebar = (
    <SidebarContents
      sections={sections}
      pathname={pathname}
      collapsed={collapsed}
      onNavigate={() => setMobileOpen(false)}
    />
  );

  return (
    <div className="admin-root min-h-dvh bg-bg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[90] focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-brand-fg"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-[var(--border)] bg-bg-elevated transition-[width] duration-200 ease-[var(--ease-out-soft)] lg:flex",
          collapsed ? "w-[76px]" : "w-[268px]",
        )}
        aria-label="Console navigation"
      >
        <div className={cn("flex h-16 shrink-0 items-center gap-2.5 border-b border-[var(--border)]", collapsed ? "justify-center px-2" : "px-4")}>
          <Link href="/admin" className="flex min-w-0 items-center gap-2.5" aria-label="Console home">
            <LogoBadge className="size-9 shrink-0 rounded-[11px]" />
            {!collapsed && (
              <span className="min-w-0">
                <span className="block font-display text-[15px] font-bold leading-tight text-fg">PetMate</span>
                <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
                  Control center
                </span>
              </span>
            )}
          </Link>
        </div>

        {sidebar}

        <div className="shrink-0 border-t border-[var(--border)] p-2">
          <button
            type="button"
            onClick={() => writeCollapsed(!collapsed)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-sm text-fg-muted transition-colors hover:bg-bg-sunken hover:text-fg",
              collapsed && "justify-center px-0",
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen className="size-4" aria-hidden /> : <PanelLeftClose className="size-4" aria-hidden />}
            {!collapsed && "Collapse"}
          </button>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true" aria-label="Console navigation">
          <div className="animate-fade absolute inset-0 bg-[var(--overlay)] backdrop-blur-sm" onClick={() => setMobileOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 flex w-[min(300px,86vw)] flex-col bg-bg-elevated shadow-[var(--shadow-pop)]">
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--border)] px-4">
              <Link href="/admin" className="flex items-center gap-2.5" onClick={() => setMobileOpen(false)}>
                <LogoBadge className="size-9 rounded-[11px]" />
                <span className="font-display text-[15px] font-bold text-fg">Control center</span>
              </Link>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-full p-2 text-fg-muted hover:bg-bg-sunken hover:text-fg"
                aria-label="Close navigation"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <SidebarContents
              sections={sections}
              pathname={pathname}
              collapsed={false}
              onNavigate={() => setMobileOpen(false)}
            />
          </div>
        </div>
      )}

      <div className={cn("flex min-h-dvh flex-col transition-[padding] duration-200", collapsed ? "lg:pl-[76px]" : "lg:pl-[268px]")}>
        <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] backdrop-blur-xl">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="-ml-1 rounded-full p-2 text-fg-muted hover:bg-bg-sunken hover:text-fg lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="size-5" aria-hidden />
            </button>

            <Breadcrumbs pathname={pathname} />

            <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                className="group flex h-10 items-center gap-2.5 rounded-full border border-[var(--border-strong)] bg-bg-elevated px-3 text-sm text-fg-subtle shadow-[var(--shadow-subtle)] transition-colors hover:border-[var(--brand)] hover:text-fg sm:w-64 2xl:w-80"
                aria-label="Search the console"
              >
                <Search className="size-4 shrink-0" aria-hidden />
                <span className="hidden truncate sm:inline">Search members, orders, tickets…</span>
                <span className="ml-auto hidden items-center gap-1 sm:flex">
                  <kbd className="admin-kbd">Ctrl</kbd>
                  <kbd className="admin-kbd">K</kbd>
                </span>
              </button>
              <Link
                href="/"
                className="hidden h-10 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm font-medium text-fg-muted transition-colors hover:bg-bg-sunken hover:text-fg xl:inline-flex"
              >
                <ExternalLink className="size-4" aria-hidden />
                View site
              </Link>
              <ThemeToggle />
              <ShellUserMenu user={user} />
            </div>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} sections={sections} />
    </div>
  );
}

function SidebarContents({
  sections,
  pathname,
  collapsed,
  onNavigate,
}: {
  sections: NavSection[];
  pathname: string;
  collapsed: boolean;
  onNavigate: () => void;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  return (
    <nav className="admin-scroll flex-1 overflow-y-auto px-2 py-3">
      {sections.map((section) => {
        const containsActive = section.items.some((i) => isActive(pathname, i));
        const expanded = !section.collapsible || collapsed || containsActive || open.has(section.title);
        const total = section.items.reduce((a, i) => a + (i.badge ?? 0), 0);

        return (
          <div key={section.title} className="mb-1">
            {section.collapsible && !collapsed ? (
              <button
                type="button"
                onClick={() =>
                  setOpen((prev) => {
                    const next = new Set(prev);
                    if (next.has(section.title)) next.delete(section.title);
                    else next.add(section.title);
                    return next;
                  })
                }
                aria-expanded={expanded}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-sm font-medium transition-colors",
                  containsActive ? "text-fg" : "text-fg-muted hover:bg-bg-sunken hover:text-fg",
                )}
              >
                {section.icon && <AdminIcon name={section.icon} className="size-4 shrink-0" />}
                <span className="flex-1 truncate">{section.title}</span>
                {!expanded && total > 0 && <NavBadge count={total} />}
                {expanded ? (
                  <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
                ) : (
                  <ChevronRight className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
                )}
              </button>
            ) : (
              !collapsed && (
                <p className="px-3 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">
                  {section.title}
                </p>
              )
            )}

            {collapsed && <div className="mx-3 my-2 h-px bg-[var(--border)]" aria-hidden />}

            {expanded && (
              <ul className={cn("space-y-0.5", section.collapsible && !collapsed && "ml-3 border-l border-[var(--border)] pl-2")}>
                {section.items.map((item) => {
                  const active = isActive(pathname, item);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        title={collapsed ? item.label : undefined}
                        className={cn(
                          "relative flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-sm font-medium transition-colors",
                          collapsed && "justify-center px-0",
                          active
                            ? "bg-brand-soft text-brand-soft-fg"
                            : "text-fg-muted hover:bg-bg-sunken hover:text-fg",
                        )}
                      >
                        <AdminIcon name={item.icon} className="size-4 shrink-0" />
                        {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                        {item.badge ? (
                          collapsed ? (
                            <span className="absolute right-3 top-1.5 size-2 rounded-full bg-accent ring-2 ring-[var(--bg-elevated)]" aria-label={`${item.badge} waiting`} />
                          ) : (
                            <NavBadge count={item.badge} />
                          )
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function NavBadge({ count }: { count: number }) {
  return (
    <span className="min-w-5 rounded-full bg-accent px-1.5 text-center text-[11px] font-bold leading-5 text-accent-fg tabular">
      {count > 99 ? "99+" : count}
      <span className="sr-only"> waiting</span>
    </span>
  );
}

const SEGMENT_LABELS: Record<string, string> = {
  admin: "Control center",
  data: "Data",
  moderation: "Moderation",
  support: "Support",
  finance: "Finance",
  settings: "Settings",
  system: "System health",
};

function Breadcrumbs({ pathname }: { pathname: string }) {
  const parts = pathname.split("/").filter(Boolean);
  const crumbs: { href: string; label: string }[] = [];
  let href = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    href += `/${part}`;
    const previous = parts[i - 1];
    let label = SEGMENT_LABELS[part];
    if (!label && previous === "data") label = getResource(part)?.plural ?? part;
    if (!label && parts[i - 2] === "data") label = "Record";
    crumbs.push({ href, label: label ?? part });
  }

  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 md:block">
      <ol className="flex items-center gap-1.5 text-sm">
        {crumbs.map((crumb, i) => (
          <li
            key={crumb.href}
            className={cn("min-w-0 items-center gap-1.5", i === crumbs.length - 1 ? "flex" : "hidden xl:flex")}
          >
            {i > 0 && <ChevronRight className="hidden size-3.5 shrink-0 text-fg-subtle xl:block" aria-hidden />}
            {i === crumbs.length - 1 ? (
              <span className="truncate font-semibold text-fg" aria-current="page">
                {crumb.label}
              </span>
            ) : (
              <Link href={crumb.href} className="truncate text-fg-muted hover:text-fg">
                {crumb.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function ShellUserMenu({ user }: { user: ShellUser }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function signOut() {
    setSigningOut(true);
    try {
      await api.post("/api/auth", { action: "logout" });
      router.push("/");
      router.refresh();
    } catch {
      toast.error("We could not sign you out", "Please try again.");
      setSigningOut(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-full p-0.5 transition-shadow hover:shadow-[0_0_0_3px_var(--brand-soft)]"
        aria-label="Account menu"
      >
        <Avatar src={user.avatarUrl} name={user.name} size="sm" />
      </button>

      {open && (
        <div
          role="menu"
          className="animate-in-up absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-bg-elevated shadow-[var(--shadow-pop)]"
        >
          <div className="border-b border-[var(--border)] p-4">
            <p className="truncate text-sm font-semibold text-fg">{user.name}</p>
            <p className="truncate text-xs text-fg-muted">{user.email}</p>
            <span className="mt-2 inline-flex rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-soft-fg">
              {user.roleLabel}
            </span>
          </div>
          <div className="p-1.5">
            <Link
              role="menuitem"
              href={`/u/${user.handle}`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-sm text-fg-muted hover:bg-bg-sunken hover:text-fg"
            >
              <AdminIcon name="users" className="size-4" />
              Public profile
            </Link>
            <Link
              role="menuitem"
              href="/dashboard"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-sm text-fg-muted hover:bg-bg-sunken hover:text-fg"
            >
              <ExternalLink className="size-4" aria-hidden />
              Back to PetMate
            </Link>
            <button
              role="menuitem"
              type="button"
              disabled={signingOut}
              onClick={() => void signOut()}
              className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-sm text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-60"
            >
              <LogOut className="size-4" aria-hidden />
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
