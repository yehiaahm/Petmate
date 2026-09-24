"use client";

import { usePathname } from "next/navigation";
import { splitLocalePath } from "@/lib/i18n/config";

/**
 * The current path without its language prefix.
 *
 * Middleware rewrites /ar/settings to /settings, so the server renders with
 * one path and the browser reports the other. Anything that compares the path
 * (an active nav item) must use this, or the two renders disagree.
 */
export function useAppPathname(): string {
  return splitLocalePath(usePathname() ?? "/").path;
}
