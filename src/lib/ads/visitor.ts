import "server-only";
import { createHash } from "node:crypto";

/**
 * A stable, anonymous key for one browser, used only to count an ad once per
 * visitor: a hash of the CSRF cookie every visitor already carries, or of the
 * network address when there is none. It identifies nobody and is not stored.
 */
export function adVisitorKey(request: Request, ip: string | null): string {
  const cookie = request.headers.get("cookie") ?? "";
  const token = /(?:^|;\s*)pm_csrf=([^;]+)/.exec(cookie)?.[1];
  return createHash("sha256").update(token ?? `ip:${ip ?? "unknown"}`).digest("hex").slice(0, 32);
}
