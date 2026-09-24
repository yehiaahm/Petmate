import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { listSessions } from "@/lib/services/auth.service";
import { PasswordForm } from "@/components/settings/password-form";
import { SessionList } from "@/components/settings/session-list";
import { PageHeader, Card, CardHeader, DataRow, Badge } from "@/components/ui/primitives";
import { ResendVerification } from "@/components/auth/resend-verification";
import { formatDate, formatDateTime } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Security",
  robots: { index: false, follow: false },
};

export default async function SecuritySettingsPage() {
  const auth = await requireAuth();

  const [sessions, user, recentAuthEvents] = await Promise.all([
    listSessions(auth.user.id, auth.sessionId),
    db.user.findUniqueOrThrow({
      where: { id: auth.user.id },
      select: { email: true, emailVerifiedAt: true, lastLoginAt: true, createdAt: true },
    }),
    db.auditLog.findMany({
      where: {
        actorId: auth.user.id,
        action: {
          in: [
            "auth.login",
            "auth.password_changed",
            "auth.sessions_revoked",
            "auth.password_reset_completed",
            "auth.email_verified",
          ],
        },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, action: true, ip: true, createdAt: true, summary: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Security"
        description="Your password, where you are signed in, and what has happened on this account."
      />

      <div className="mt-6 space-y-5">
        <Card>
          <CardHeader title="Email address" />
          <div className="p-5">
            <dl>
            <DataRow label="Address" value={user.email} />
            <DataRow
              label="Status"
              value={
                user.emailVerifiedAt ? (
                  <Badge tone="success" size="sm">
                    Confirmed {formatDate(user.emailVerifiedAt)}
                  </Badge>
                ) : (
                  <Badge tone="warning" size="sm">
                    Not confirmed
                  </Badge>
                )
              }
            />
            </dl>
            {!user.emailVerifiedAt && (
              <div className="mt-4 max-w-xs">
                <ResendVerification variant="outline" label="Send the link again" />
              </div>
            )}
            <p className="mt-4 text-xs leading-relaxed text-fg-subtle">
              Changing the address on an account is a common account-takeover step, so it is not
              self-service. Contact support and we will verify both addresses.
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Password"
            description="Changing it signs out every other device."
          />
          <div className="p-5">
            <PasswordForm />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Signed-in devices"
            description="If you do not recognise one, revoke it and change your password."
          />
          <div className="p-5">
            <SessionList
              sessions={sessions.map((s) => ({
                id: s.id,
                ip: s.ip,
                device: s.device,
                current: s.current,
                lastSeenAt: s.lastSeenAt ? s.lastSeenAt.toISOString() : null,
                createdAt: s.createdAt.toISOString(),
              }))}
            />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Recent account activity"
            description="Security events we recorded. This log is append-only."
          />
          <div className="p-5">
            {recentAuthEvents.length === 0 ? (
              <p className="text-sm text-fg-muted">Nothing recorded yet.</p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {recentAuthEvents.map((event) => (
                  <li key={event.id} className="flex items-baseline justify-between gap-4 py-2.5">
                    <span className="text-sm text-fg">
                      {AUTH_EVENT_LABEL[event.action] ?? event.action}
                      {event.ip && <span className="ms-2 text-xs text-fg-subtle">{event.ip}</span>}
                    </span>
                    <time
                      dateTime={event.createdAt.toISOString()}
                      className="shrink-0 text-xs text-fg-subtle tabular"
                    >
                      {formatDateTime(event.createdAt)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

const AUTH_EVENT_LABEL: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.password_changed": "Password changed",
  "auth.sessions_revoked": "All other devices signed out",
  "auth.password_reset_completed": "Password reset completed",
  "auth.email_verified": "Email address confirmed",
};
