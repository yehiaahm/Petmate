import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Fraunces, Plus_Jakarta_Sans, IBM_Plex_Sans_Arabic, Noto_Kufi_Arabic } from "next/font/google";
import "./globals.css";
import { ThemeScript } from "@/components/theme-script";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { clientEnv } from "@/lib/env";
import { getI18n } from "@/lib/i18n/server";
import { messagesFor } from "@/lib/i18n/messages";
import { ErrorReporter } from "@/components/monitoring/error-reporter";
import { Analytics } from "@/components/analytics/analytics";

/**
 * Fraunces carries the headlines: a soft serif with real character, which reads
 * as editorial and established rather than another geometric-sans startup.
 * Plus Jakarta Sans handles UI text — friendly, but with the tight numerals a
 * marketplace full of prices needs.
 */
const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-fraunces",
  axes: ["SOFT", "WONK", "opsz"],
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jakarta",
  weight: ["400", "500", "600", "700", "800"],
});

/**
 * Arabic has its own pair, chosen for the same jobs: Noto Kufi Arabic is a
 * structured display face for headlines, IBM Plex Sans Arabic a calm UI text
 * face with clear numerals. Neither is preloaded — the CSS only asks for them
 * on an Arabic page, so English visitors never download them.
 */
const kufi = Noto_Kufi_Arabic({
  subsets: ["arabic"],
  display: "swap",
  variable: "--font-arabic-display",
  weight: ["500", "600", "700"],
  preload: false,
});

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  display: "swap",
  variable: "--font-arabic",
  weight: ["400", "500", "600", "700"],
  preload: false,
});

const appUrl = clientEnv.NEXT_PUBLIC_APP_URL;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
  metadataBase: new URL(appUrl),
  title: {
    default: t("PetMate — Find, care for and rehome pets with confidence"),
    template: "%s · PetMate",
  },
  description:
    t("PetMate is where pets get a verified identity. Buy, adopt and find breeding matches from people you can check, keep a lifelong health record, book your vet and shop what your pet needs — in one place."),
  applicationName: "PetMate",
  keywords: [
    "pets for sale",
    "pet adoption",
    "dog breeders",
    "cat adoption",
    "veterinary booking",
    "pet health records",
    "pet supplies",
  ],
  authors: [{ name: "PetMate" }],
  openGraph: {
    type: "website",
    siteName: "PetMate",
    url: appUrl,
    title: "PetMate — the home for everything your pet needs",
    description:
      "Verified pets, verified people. Buy, adopt, breed, treat and care for pets with a record that follows them for life.",
  },
  twitter: {
    card: "summary_large_image",
    title: "PetMate",
    description: "Verified pets, verified people, one lifelong record.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  manifest: "/manifest.webmanifest",
  alternates: { canonical: "/" },
};
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf9f5" },
    { media: "(prefers-color-scheme: dark)", color: "#121110" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [{ locale, dir, t }, requestHeaders] = await Promise.all([getI18n(), headers()]);
  const nonce = requestHeaders.get("x-nonce") ?? undefined;

  return (
    <html
      lang={locale}
      dir={dir}
      suppressHydrationWarning
      className={`${fraunces.variable} ${jakarta.variable} ${kufi.variable} ${plexArabic.variable}`}
    >
      <head>
        <ThemeScript nonce={nonce} />
      </head>
      <body className="min-h-dvh bg-bg text-fg antialiased">
        <a href="#main" className="skip-link">
          {t("Skip to main content")}
        </a>
        <I18nProvider locale={locale} messages={messagesFor(locale)}>
          <ToastProvider>{children}</ToastProvider>
          <ErrorReporter />
          <Analytics />
        </I18nProvider>
      </body>
    </html>
  );
}
