/**
 * Product modules that can be switched off without deleting them.
 *
 * A module that is off is gone from the product, not just from the menu: its
 * pages render the 404 page and its API answers 404, both from the middleware,
 * so no link, bookmark or crafted request reaches it. The code, the tables and
 * the rows stay, so switching a module back on is a configuration change and a
 * rebuild, not a rewrite.
 *
 * These are `NEXT_PUBLIC_` on purpose: the same value has to reach the
 * middleware, server components and client navigation, and Next inlines public
 * variables into all three at build time.
 */

const on = (value: string | undefined) => value === "true" || value === "1";

export const features = {
  /** Veterinary clinics, vet booking and appointments. */
  clinics: on(process.env.NEXT_PUBLIC_FEATURE_CLINICS),
} as const;

/**
 * Path prefixes owned by the clinics module. Matching is by whole segment, so
 * `/clinics` does not also swallow a future `/clinicsomething`.
 */
export const CLINIC_PATH_PREFIXES = [
  "/clinics",
  "/for-clinics",
  "/clinic",
  "/dashboard/appointments",
  "/api/clinics",
  "/api/appointments",
] as const;

export function isDisabledModulePath(pathname: string): boolean {
  if (features.clinics) return false;
  return CLINIC_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
