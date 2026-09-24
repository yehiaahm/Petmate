import type { MetadataRoute } from "next";
import { clientEnv, isProduction } from "@/lib/env";

/**
 * robots.txt
 *
 * Non-production deployments disallow everything: a staging copy of a
 * marketplace competing with production in search results is a real and
 * surprisingly common own goal.
 */
export default function robots(): MetadataRoute.Robots {
  const base = clientEnv.NEXT_PUBLIC_APP_URL;

  if (!isProduction()) {
    return {
      rules: [{ userAgent: "*", disallow: "/" }],
    };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/dashboard/",
          "/settings/",
          "/messages/",
          "/admin/",
          "/clinic/",
          "/sell/",
          "/checkout/",
          "/notifications",
          "/dev/",
          // Filtered permutations are infinite and thin; the canonical
          // category pages carry the value.
          "/pets?*",
          "/store?*",
          "/clinics?*",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
