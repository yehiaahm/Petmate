import type { NextConfig } from "next";

/**
 * Security headers applied to every response.
 *
 * The Content-Security-Policy is not here: it carries a per-request nonce, so
 * it is set in `src/middleware.ts` instead. Everything below is static and
 * belongs in the config. See docs/SECURITY.md.
 */
const isProd = process.env.NODE_ENV === "production";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Permissions-Policy",
    // Geolocation is used by the "near me" search, with an explicit prompt.
    value: "camera=(), microphone=(), payment=(), usb=(), geolocation=(self)",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isProd
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,

  // Traces the files the server actually needs, so the container image ships
  // the app instead of node_modules. See the Dockerfile.
  output: "standalone",

  // Never ship a build that does not typecheck.
  typescript: { ignoreBuildErrors: false },

  experimental: {
    optimizePackageImports: ["lucide-react"],
  },

  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "**.public.blob.vercel-storage.com" },
      { protocol: "https", hostname: "**.amazonaws.com" },
    ],
    deviceSizes: [360, 480, 640, 828, 1080, 1280, 1600, 1920],
    imageSizes: [48, 64, 96, 128, 200, 256, 384],
  },

  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // Uploaded files are user content: never let a browser sniff them into
        // an executable type, and never let them be framed.
        source: "/uploads/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Content-Disposition", value: "inline" },
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },

  async redirects() {
    return [
      { source: "/marketplace", destination: "/pets", permanent: true },
      { source: "/shop", destination: "/store", permanent: true },
    ];
  },
};

export default nextConfig;
