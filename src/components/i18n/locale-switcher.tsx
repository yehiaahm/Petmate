"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Languages } from "lucide-react";
import { LOCALES, LOCALE_COOKIE, LOCALE_NAME, localizedPath, splitLocalePath, type Locale } from "@/lib/i18n/config";
import { api } from "@/lib/api-client";
import { useI18n } from "./i18n-provider";
import { cn } from "@/lib/utils";

/**
 * Switches language.
 *
 * The choice is stored in a cookie (for every later page) and, when signed
 * in, on the account (so emails and messages arrive in it too). A page reached
 * through a `/ar` or `/en` link keeps that prefix in its URL, so switching
 * there navigates to the other prefix; otherwise a refresh re-renders in place.
 */
export function LocaleSwitcher({
  signedIn = false,
  className,
}: {
  signedIn?: boolean;
  className?: string;
}) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();

  const next: Locale = LOCALES.find((l) => l !== locale) ?? "en";

  function choose() {
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    if (signedIn) {
      // Best effort: the cookie already carries the choice for this browser.
      void api.post("/api/account", { action: "set-locale", locale: next }).catch(() => undefined);
    }

    // The browser may be on either `/pets` or `/ar/pets` for the same page;
    // strip any prefix before adding the new one.
    const { path } = splitLocalePath(pathname);
    const query = search.toString();
    const target = localizedPath(next, `${path}${query ? `?${query}` : ""}`);
    startTransition(() => {
      router.replace(target);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={choose}
      disabled={pending}
      lang={next}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-field)] px-2.5 text-sm font-medium text-fg-muted transition-colors hover:bg-bg-sunken hover:text-fg disabled:opacity-60",
        className,
      )}
      aria-label={t("Change language to {language}", { language: LOCALE_NAME[next] })}
    >
      <Languages className="size-4" aria-hidden />
      {LOCALE_NAME[next]}
    </button>
  );
}
