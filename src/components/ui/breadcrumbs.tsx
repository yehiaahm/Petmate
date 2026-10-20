"use client";

import Link from "next/link";
import { useI18n } from "@/components/i18n/i18n-provider";

export function Breadcrumbs({
  items,
}: {
  items: { label: string; href?: string }[];
}) {
  const { t } = useI18n();
  return (
    <nav aria-label={t("Breadcrumb")} className="mb-4 text-sm">
      <ol className="flex flex-wrap items-center gap-1.5 text-fg-muted">
        {items.map((item, i) => (
          <li key={`${t(item.label)}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && (
              <span aria-hidden className="text-fg-subtle">
                /
              </span>
            )}
            {item.href && i < items.length - 1 ? (
              <Link href={item.href} className="hover:text-fg hover:underline">
                {t(item.label)}
              </Link>
            ) : (
              <span className={i === items.length - 1 ? "text-fg" : undefined} aria-current={i === items.length - 1 ? "page" : undefined}>
                {t(item.label)}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
