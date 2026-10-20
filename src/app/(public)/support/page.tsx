import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, Scale, BookOpen, Clock } from "lucide-react";
import { getAuth } from "@/lib/auth/session";
import { HELP_ARTICLES } from "@/lib/support-articles";
import { HelpArticles } from "@/components/support/help-articles";
import { ContactForm } from "@/components/support/contact-form";
import { TicketLookup } from "@/components/support/ticket-lookup";
import { Card, Badge, Alert } from "@/components/ui/primitives";
import { SUPPORT_TOPICS, SUPPORT_TOPIC_LABEL } from "@/lib/support-topics";
import { clientEnv } from "@/lib/env";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
  title: t("Help & support"),
  description:
    t("Answers about escrow, refunds, verification, health records and safety — plus a way to reach a person."),
  alternates: { canonical: "/support" },
};
}

const topics = SUPPORT_TOPICS.map((value) => ({ value, label: SUPPORT_TOPIC_LABEL[value] }));

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string }>;
}) {
  const { t } = await getI18n();
  // Translated once here, so the search box, the categories and the FAQ
  // structured data all work in the reader's language.
  const articles = HELP_ARTICLES.map((article) => ({
    ...article,
    category: t(article.category),
    question: t(article.question),
    answer: article.answer.map((paragraph) => t(paragraph)),
  }));
  const [auth, params] = await Promise.all([getAuth(), searchParams]);

  const defaultTopic =
    params.topic && SUPPORT_TOPICS.includes(params.topic as (typeof SUPPORT_TOPICS)[number])
      ? params.topic
      : undefined;

  return (
    <div className="container-page py-12 lg:py-16">
      <div className="mx-auto max-w-2xl text-center">
        <Badge tone="brand">{t("Help centre")}</Badge>
        <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-fg sm:text-5xl">
          {t("How can we help?")}
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-fg-muted">
          {t("Most answers are below. If yours is not, a person reads every message — you do not need an account to send one.")}
        </p>
      </div>

      <div className="mx-auto mt-10 grid max-w-3xl gap-3 sm:grid-cols-3">
        {[
          {
            icon: ShieldAlert,
            title: "An animal is at risk",
            body: "Report it from the listing or profile. Welfare reports jump the queue.",
            href: "/trust",
            cta: "How reporting works",
          },
          {
            icon: Scale,
            title: "A transaction went wrong",
            body: "Open a dispute from the order. Escrow freezes while it is reviewed.",
            href: "/dashboard/orders",
            cta: "Go to my orders",
          },
          {
            icon: BookOpen,
            title: "Rules and policies",
            body: "What is allowed, what is not, and what we do with your data.",
            href: "/terms",
            cta: "Read the terms",
          },
        ].map((item) => (
          <Card key={item.title} className="flex flex-col p-5">
            <item.icon className="size-5 text-brand" aria-hidden />
            <h2 className="mt-3 text-[15px] font-semibold text-fg">{t(item.title)}</h2>
            <p className="mt-1.5 flex-1 text-sm leading-relaxed text-fg-muted">{t(item.body)}</p>
            <Link
              href={item.href}
              className="mt-3 text-sm font-medium text-brand hover:underline"
            >
              {t(item.cta)} →
            </Link>
          </Card>
        ))}
      </div>

      <section className="mx-auto mt-14 max-w-3xl">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">
          {t("Common questions")}
        </h2>
        <div className="mt-5">
          <HelpArticles articles={articles} />
        </div>
      </section>

      <section id="contact" className="mx-auto mt-14 max-w-3xl scroll-mt-24">
        <div className="grid gap-6 lg:grid-cols-[1fr_280px] lg:items-start">
          <ContactForm
            topics={topics}
            defaultTopic={defaultTopic}
            identity={auth ? { name: auth.user.name, email: auth.user.email } : null}
          />

          <div className="space-y-4">
            <Card className="p-5">
              <div className="flex items-center gap-2">
                <Clock className="size-4 text-fg-subtle" aria-hidden />
                <h3 className="text-sm font-semibold text-fg">{t("Response times")}</h3>
              </div>
              <dl className="mt-3 space-y-2 text-sm">
                {[
                  ["Animal welfare", "Same day"],
                  ["Payments & escrow", "Within 1 working day"],
                  ["Everything else", "1–2 working days"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-3">
                    <dt className="text-fg-muted">{t(label!)}</dt>
                    <dd className="text-end font-medium text-fg">{t(value!)}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs leading-relaxed text-fg-subtle">
                {t("These are targets, not a contractual guarantee. If something is genuinely urgent, say so in the subject line.")}
              </p>
            </Card>

            <TicketLookup signedIn={Boolean(auth)} />

            <Alert tone="warning" title={t("We will never ask for")}>
              <p className="mt-1 text-sm leading-relaxed">
                {t("Your password, a card number, a one-time code, or remote access to your device. Anyone claiming to be PetMate support and asking for those is not.")}
              </p>
            </Alert>
          </div>
        </div>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            url: `${clientEnv.NEXT_PUBLIC_APP_URL}/support`,
            mainEntity: articles.map((article) => ({
              "@type": "Question",
              name: article.question,
              acceptedAnswer: { "@type": "Answer", text: article.answer.join(" ") },
            })),
          }),
        }}
      />
    </div>
  );
}
