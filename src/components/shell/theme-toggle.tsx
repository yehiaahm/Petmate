"use client";

import { useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
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

  function apply(next: "light" | "dark") {
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("pm-theme", next);
    } catch {
      // Private mode or blocked storage: the toggle still works this session.
    }
  }

  function toggle(event: React.MouseEvent<HTMLButtonElement>) {
    const next = theme === "dark" ? "light" : "dark";
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!document.startViewTransition || reduced) {
      apply(next);
      return;
    }

    // The new theme grows out of the button as a circle. A view transition
    // snapshots the old page, so nothing has to animate colour by colour.
    const rect = event.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));

    const transition = document.startViewTransition(() => {
      flushSync(() => apply(next));
    });
    void transition.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        {
          duration: 650,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        "relative inline-flex size-10 items-center justify-center overflow-hidden rounded-full text-fg-muted transition-[color,background-color,transform] duration-200 hover:bg-bg-sunken hover:text-fg active:scale-90",
        className,
      )}
      aria-label={mounted ? `Switch to ${theme === "dark" ? "light" : "dark"} mode` : "Switch theme"}
    >
      {/* Both icons render; CSS decides. Avoids a hydration mismatch. */}
      <Sun
        className="size-[18px] transition-[transform,opacity] duration-500 ease-[var(--ease-spring)] dark:-rotate-90 dark:scale-0 dark:opacity-0"
        aria-hidden
      />
      <Moon
        className="absolute size-[18px] rotate-90 scale-0 opacity-0 transition-[transform,opacity] duration-500 ease-[var(--ease-spring)] dark:rotate-0 dark:scale-100 dark:opacity-100"
        aria-hidden
      />
    </button>
  );
}
