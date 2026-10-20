import { Badge } from "@/components/ui/primitives";
import { getI18n } from "@/lib/i18n/server";

export interface LegalSection {
  heading: string;
  paragraphs: (string | string[])[];
}

/**
 * Shared layout for the legal pages.
 *
 * These documents are templates that a lawyer has to review before launch, and
 * the page says so rather than implying they have been. Shipping unreviewed
 * boilerplate as if it were legal advice would be worse than shipping nothing.
 */
export async function LegalPage({
  title,
  updated,
  intro,
  sections,
}: {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
}) {
  const { t } = await getI18n();
  return (
    <div className="container-page max-w-3xl py-12 lg:py-16">
      <Badge tone="neutral">{t("Legal")}</Badge>
      <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-fg">{title}</h1>
      <p className="mt-2 text-sm text-fg-subtle">{t("Last updated {date}", { date: updated })}</p>

      <div className="mt-6 rounded-[var(--radius-card)] border border-[var(--warning)]/30 bg-[var(--warning-soft)] p-4 text-sm leading-relaxed text-[var(--warning)]">
        <strong className="font-semibold">{t("Template, not legal advice.")}</strong> {t("This document describes how PetMate actually works, but it has not been reviewed by a qualified lawyer and is not tailored to any jurisdiction. Have it reviewed before operating commercially.")}
      </div>

      <p className="mt-8 text-[17px] leading-relaxed text-fg-muted">{t(intro)}</p>

      <nav aria-label={t("Contents")} className="mt-8 rounded-[var(--radius-card)] bg-bg-sunken p-5">
        <h2 className="text-sm font-semibold text-fg">{t("Contents")}</h2>
        <ol className="mt-3 space-y-1.5">
          {sections.map((section, index) => (
            <li key={section.heading}>
              <a
                href={`#section-${index + 1}`}
                className="text-sm text-fg-muted hover:text-fg hover:underline"
              >
                {index + 1}. {t(section.heading)}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-10 space-y-10">
        {sections.map((section, index) => (
          <section key={section.heading} id={`section-${index + 1}`} className="scroll-mt-24">
            <h2 className="font-display text-xl font-semibold text-fg">
              {index + 1}. {t(section.heading)}
            </h2>
            <div className="mt-3 space-y-3">
              {section.paragraphs.map((paragraph, i) =>
                Array.isArray(paragraph) ? (
                  <ul key={i} className="list-disc space-y-1.5 ps-5">
                    {paragraph.map((item) => (
                      <li key={item} className="text-[15px] leading-relaxed text-fg-muted">
                                                {t(item)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p key={i} className="text-[15px] leading-relaxed text-fg-muted">
                                        {t(paragraph)}
                  </p>
                ),
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
