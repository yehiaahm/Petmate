"use client";

import { useState, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

/** Nothing ever changes, so the subscribe callback has nothing to do. */
const subscribeNever = () => () => {};

/**
 * Light/dark toggle.
 *
 * Reads the attribute the blocking head script already set, rather than
 * re-deriving from storage, so the button and the page can never disagree.
 */
export function ThemeToggle({ className }: { className?: string }) {
  // Lazy initialisers, not an effect. The blocking head script has already set
  // the attribute by the time this mounts, so there is nothing to synchronise
  // afterwards — and a setState inside an effect would render twice to reach
  // the same answer.
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "light",
  );

  // "Has hydration finished" is a fact about the environment, not component
  // state. useSyncExternalStore answers false on the server and true on the
  // client without scheduling a second render to get there.
  const mounted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("pm-theme", next);
    } catch {
      // Private mode or blocked storage: the toggle still works this session.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-[var(--radius-field)] text-fg-muted transition-colors hover:bg-bg-sunken hover:text-fg",
        className,
      )}
      aria-label={mounted ? `Switch to ${theme === "dark" ? "light" : "dark"} mode` : "Switch theme"}
    >
      {/* Both icons render; CSS decides. Avoids a hydration mismatch. */}
      <Sun className="size-[18px] dark:hidden" aria-hidden />
      <Moon className="hidden size-[18px] dark:block" aria-hidden />
    </button>
  );
}
