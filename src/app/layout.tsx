import type { Metadata, Viewport } from "next";
import { Fraunces, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { ThemeScript } from "@/components/theme-script";
import { ToastProvider } from "@/components/ui/toast";
import { clientEnv } from "@/lib/env";

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

const appUrl = clientEnv.NEXT_PUBLIC_APP_URL;

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: "PetMate — Find, care for and rehome pets with confidence",
    template: "%s · PetMate",
  },
  description:
    "PetMate is where pets get a verified identity. Buy, adopt and find breeding matches from people you can check, keep a lifelong health record, book your vet and shop what your pet needs — in one place.",
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf9f5" },
    { media: "(prefers-color-scheme: dark)", color: "#121110" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${fraunces.variable} ${jakarta.variable}`}>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-dvh bg-bg text-fg antialiased">
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
