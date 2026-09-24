import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { env, isProduction } from "@/lib/env";
import { relativeTime } from "@/lib/utils";
import { Card, Badge, EmptyState, PageHeader, Alert } from "@/components/ui/primitives";
import { Mail } from "lucide-react";

export const metadata: Metadata = {
  title: "Development mailbox",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The development mailbox.
 *
 * With `EMAIL_PROVIDER=outbox` nothing is actually delivered — messages sit in
 * the `EmailMessage` table. This renders them so verification and reset links
 * are usable locally without wiring up a real provider.
 *
 * It 404s in production and whenever a real provider is configured. It is not
 * a feature; it is a development tool that must never be reachable on a
 * deployment that sends real mail.
 */
export default async function MailboxPage() {
  if (isProduction() || env().EMAIL_PROVIDER !== "outbox") notFound();

  const messages = await db.emailMessage.findMany({
    orderBy: { createdAt: "desc" },
    take: 40,
    select: {
      id: true,
      to: true,
      subject: true,
      text: true,
      template: true,
      status: true,
      createdAt: true,
    },
  });

  return (
    <div className="container-page max-w-4xl py-10">
      <PageHeader
        eyebrow="Development only"
        title="Mailbox"
        description="Messages queued by the outbox provider. Nothing here was delivered to a real inbox."
      />

      <div className="mt-6">
        <Alert tone="warning" title="This page does not exist in production">
          It returns 404 when NODE_ENV is production or a real email provider is configured.
        </Alert>
      </div>

      {messages.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={<Mail className="size-6" aria-hidden />}
            title="No messages yet"
            description="Register an account or request a password reset to see mail appear here."
          />
        </div>
      ) : (
        <ul className="mt-8 space-y-3">
          {messages.map((message) => {
            // Surface any link in the body so it can be clicked directly.
            const links = [...message.text.matchAll(/https?:\/\/[^\s]+/g)].map((m) => m[0]);

            return (
              <li key={message.id}>
                <Card as="article" className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-display text-base font-semibold text-fg">
                        {message.subject}
                      </h2>
                      <p className="mt-0.5 text-sm text-fg-muted">
                        To {message.to} · {relativeTime(message.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      {message.template && (
                        <Badge tone="neutral" size="sm">
                          {message.template}
                        </Badge>
                      )}
                      <Badge tone={message.status === "SENT" ? "success" : "warning"} size="sm">
                        {message.status}
                      </Badge>
                    </div>
                  </div>

                  <pre className="mt-3 whitespace-pre-wrap break-words rounded-[var(--radius-field)] bg-bg-sunken p-3 font-mono text-xs leading-relaxed text-fg-muted">
                    {message.text}
                  </pre>

                  {links.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {links.map((link) => (
                        <a
                          key={link}
                          href={link}
                          className="inline-flex items-center gap-1.5 rounded-[var(--radius-field)] bg-brand px-3 py-1.5 text-xs font-semibold text-brand-fg hover:bg-brand-hover"
                        >
                          Open link
                        </a>
                      ))}
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
