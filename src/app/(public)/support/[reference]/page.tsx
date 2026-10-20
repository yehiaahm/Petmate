import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAuth } from "@/lib/auth/session";
import { isAppError } from "@/lib/errors";
import {
  getSupportTicket,
  isSupportStaff,
  SUPPORT_TOPIC_LABEL,
  type SupportTopic,
} from "@/lib/services/support.service";
import { SupportThread, type ThreadTicket } from "@/components/support/support-thread";
import { Breadcrumbs } from "@/components/ui/primitives";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
  title: t("Support request"),
  // A ticket is private to two parties; it has no business in an index.
  robots: { index: false, follow: false },
};
}

const REFERENCE = /^SUP-[A-Z0-9]{4,16}$/;

export default async function SupportTicketPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { t } = await getI18n();
  const [{ reference }, auth] = await Promise.all([params, getAuth()]);

  const ref = reference.toUpperCase();
  if (!REFERENCE.test(ref)) notFound();

  const staff = isSupportStaff(auth);

  // Signed in: render the thread on the server. Signed out: the client
  // component asks for the email the ticket was opened with, because the
  // reference alone is a weak secret.
  let ticket: ThreadTicket | null = null;
  if (auth) {
    try {
      const found = await getSupportTicket(ref, {
        userId: auth.user.id,
        email: auth.user.email,
        isStaff: staff,
      });
      ticket = {
        ...found,
        createdAt: found.createdAt.toISOString(),
        lastReplyAt: found.lastReplyAt.toISOString(),
        messages: found.messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
      };
    } catch (error) {
      // Someone else's ticket and a nonexistent one look identical here, which
      // is the point: signing in must not turn the URL into a lookup oracle.
      if (!isAppError(error) || error.code !== "NOT_FOUND") throw error;
      notFound();
    }
  }

  return (
    <div className="container-page max-w-3xl py-10 lg:py-14">
      <Breadcrumbs items={[{ label: "Support", href: "/support" }, { label: ref }]} />

      {ticket ? (
        <>
          <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight text-fg">
            {ticket.subject}
          </h1>
          <p className="mt-1.5 text-sm text-fg-subtle">
            {SUPPORT_TOPIC_LABEL[ticket.topic as SupportTopic] ?? ticket.topic} ·{" "}
            <span className="font-mono">{ticket.reference}</span>
          </p>
        </>
      ) : (
        <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight text-fg">
          {t("Your support request")}
        </h1>
      )}

      <div className="mt-8">
        <SupportThread
          reference={ref}
          initialTicket={ticket}
          signedIn={Boolean(auth)}
          isStaff={staff}
        />
      </div>
    </div>
  );
}
