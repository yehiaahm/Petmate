import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { listSessions } from "@/lib/services/auth.service";
import { PasswordForm } from "@/components/settings/password-form";
import { SessionList } from "@/components/settings/session-list";
import { PageHeader, Card, CardHeader, DataRow, Badge } from "@/components/ui/primitives";
import { ResendVerification } from "@/components/auth/resend-verification";
import { TwoFactorPanel } from "@/components/settings/two-factor-panel";
import { getTwoFactorStatus } from "@/lib/services/two-factor.service";
import { listLinkedAccounts } from "@/lib/services/oauth.service";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("Security"), robots: { index: false, follow: false } };
}

export default async function SecuritySettingsPage() {
  const [auth, { t, fmt }] = await Promise.all([requireAuth(), getI18n()]);

  const AUTH_EVENT_LABEL: Record<string, string> = {
    "auth.login": t("Signed in"),
    "auth.password_changed": t("Password changed"),
    "auth.sessions_revoked": t("All other devices signed out"),
    "auth.password_reset_completed": t("Password reset completed"),
    "auth.email_verified": t("Email address confirmed"),
    "auth.two_factor_enabled": t("Two-step sign-in turned on"),
    "auth.two_factor_disabled": t("Two-step sign-in turned off"),
    "auth.backup_codes_regenerated": t("New backup codes made"),
  };

  const [sessions, user, recentAuthEvents, twoFactor, linked] = await Promise.all([
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
            "auth.two_factor_enabled",
            "auth.two_factor_disabled",
            "auth.backup_codes_regenerated",
          ],
        },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, action: true, ip: true, createdAt: true, summary: true },
    }),
    getTwoFactorStatus(auth.user.id),
    listLinkedAccounts(auth.user.id),
  ]);
  const providerName: Record<string, string> = { GOOGLE: "Google", FACEBOOK: "Facebook" };

  return (
    <>
      <PageHeader
        title={t("Security")}
        description={t("Your password, where you are signed in, and what has happened on this account.")}
      />

      <div className="mt-6 space-y-5">
        <Card>
          <CardHeader title={t("Email address")} />
          <div className="p-5">
            <dl>
            <DataRow label={t("Address")} value={user.email} />
            <DataRow
              label={t("Status")}
              value={
                user.emailVerifiedAt ? (
                  <Badge tone="success" size="sm">
                    {t("Confirmed {date}", { date: fmt.date(user.emailVerifiedAt) })}
                  </Badge>
                ) : (
                  <Badge tone="warning" size="sm">
                    {t("Not confirmed")}
                  </Badge>
                )
              }
            />
            </dl>
            {!user.emailVerifiedAt && (
              <div className="mt-4 max-w-xs">
                <ResendVerification variant="outline" label={t("Send the link again")} />
              </div>
            )}
            <p className="mt-4 text-xs leading-relaxed text-fg-subtle">
              {t("Changing the address on an account is a common account-takeover step, so it is not self-service. Contact support and we will verify both addresses.")}
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader
            title={t("Password")}
            description={t("Changing it signs out every other device.")}
          />
          <div className="p-5">
            <PasswordForm />
          </div>
        </Card>

        <Card>
          <CardHeader
            title={t("Two-step sign-in")}
            description={t("After your password, you also enter a code from an app on your phone, so a leaked password alone cannot open your account or your wallet.")}
          />
          <div className="p-5">
            <TwoFactorPanel enabled={twoFactor.enabled} backupCodesLeft={twoFactor.backupCodesLeft} />
          </div>
        </Card>

        {linked.length > 0 && (
          <Card>
            <CardHeader
              title={t("Connected sign-in")}
              description={t("You can also sign in with these accounts. Two-step sign-in, if on, still applies.")}
            />
            <div className="p-5">
              <dl>
                {linked.map((account) => (
                  <DataRow
                    key={account.id}
                    label={providerName[account.provider] ?? account.provider}
                    value={
                      <span className="text-sm">
                        {account.email} ·{" "}
                        <span className="text-fg-subtle">{t("last used {date}", { date: fmt.date(account.lastUsedAt) })}</span>
                      </span>
                    }
                  />
                ))}
              </dl>
            </div>
          </Card>
        )}

        <Card>
          <CardHeader
            title={t("Signed-in devices")}
            description={t("If you do not recognise one, revoke it and change your password.")}
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
            title={t("Recent account activity")}
            description={t("Security events we recorded. This log is append-only.")}
          />
          <div className="p-5">
            {recentAuthEvents.length === 0 ? (
              <p className="text-sm text-fg-muted">{t("Nothing recorded yet.")}</p>
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
                      {fmt.dateTime(event.createdAt)}
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
