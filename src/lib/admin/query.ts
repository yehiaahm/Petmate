import type { ListQuery, ListView } from "./data.service";

/**
 * One parser for list parameters, used by the list page (searchParams) and the
 * API (URLSearchParams) alike, so a URL copied from the browser and a request
 * made by a script return the same rows.
 *
 *   ?q=bella&sort=createdAt&dir=asc&page=2&view=deleted&f.status=ACTIVE
 */

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function get(params: Params, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

function keys(params: Params): string[] {
  return params instanceof URLSearchParams ? [...new Set(params.keys())] : Object.keys(params);
}

export const PAGE_SIZES = [25, 50, 100] as const;

export function parseListParams(params: Params): ListQuery {
  const page = Math.min(10_000, Math.max(1, Number.parseInt(get(params, "page") ?? "1", 10) || 1));
  const rawLimit = Number.parseInt(get(params, "limit") ?? "25", 10);
  const limit = (PAGE_SIZES as readonly number[]).includes(rawLimit) ? rawLimit : 25;
  const dir = get(params, "dir") === "asc" ? "asc" : get(params, "dir") === "desc" ? "desc" : undefined;
  const view = (["active", "deleted", "all"] as const).find((v) => v === get(params, "view")) as ListView | undefined;

  const filters: Record<string, string> = {};
  for (const key of keys(params)) {
    if (!key.startsWith("f.")) continue;
    const value = get(params, key);
    const field = key.slice(2);
    if (value && /^[a-zA-Z]{1,40}$/.test(field)) filters[field] = value.slice(0, 120);
  }

  return {
    q: get(params, "q")?.slice(0, 100) || undefined,
    page,
    limit,
    sort: get(params, "sort")?.slice(0, 40) || undefined,
    dir,
    view,
    filters,
  };
}
