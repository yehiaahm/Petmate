import type { Metadata } from "next";
import { Gift, Users } from "lucide-react";
import { requireAuth } from "@/lib/auth/rbac";
import { getReferralDashboard } from "@/lib/services/referral.service";
import { getI18n } from "@/lib/i18n/server";
import { bpsToPercent } from "@/lib/money";
import { PageHeader, Card, CardHeader, Stat, StatusPill, EmptyState, Alert } from "@/components/ui/primitives";
import { InviteLink } from "@/components/referrals/invite-link";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("Invite friends"), robots: { index: false, follow: false } };
}

export default async function ReferralsPage() {
  const [auth, { t, fmt }] = await Promise.all([requireAuth(), getI18n()]);
  const data = await getReferralDashboard(auth);

  const reward = fmt.money(data.rewardCents);
  const welcome = t("{percent} off (up to {max})", {
    percent: bpsToPercent(data.welcomeBps),
    max: fmt.money(data.welcomeMaxCents),
  });
  const statusLabel: Record<string, string> = {
    PENDING: t("Waiting for their first order"),
    REWARDED: t("Rewarded"),
    VOID: t("Not eligible"),
  };

  return (
    <div className="container-page max-w-3xl py-8 lg:py-10">
      <PageHeader
        eyebrow={t("Invite friends")}
        title={t("Give {percent} off, get {reward}", { percent: bpsToPercent(data.welcomeBps), reward })}
        description={t("Friends who join with your link get {welcome} their first order from the store. When it has been delivered, {reward} goes into your wallet.", { welcome, reward })}
      />

      {!data.enabled && (
        <Alert tone="info" className="mt-6">
          {t("Invitations are paused at the moment. Links you already shared still work for sign-up.")}
        </Alert>
      )}

      <Card className="mt-6">
        <CardHeader title={t("Your invite link")} />
        <div className="p-5">
          <InviteLink
            link={data.link}
            message={t("I use PetMate for my pets — here's {welcome} your first order:", { welcome })}
          />
        </div>
      </Card>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Stat label={t("Friends who joined")} value={fmt.number(data.referrals.length)} />
        <Stat label={t("Earned so far")} value={fmt.money(data.earnedCents)} />
      </div>

      <Card className="mt-4">
        <CardHeader
          title={t("People you invited")}
          description={t("The reward is paid two weeks after their first order of {min} or more is delivered, once their phone number is verified.", {
            min: fmt.money(data.minOrderCents),
          })}
        />
        <div className="p-5">
          {data.referrals.length === 0 ? (
            <EmptyState icon={<Users className="size-6" aria-hidden />} title={t("No one yet")} description={t("Share your link on WhatsApp — it takes a second.")} />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {data.referrals.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-fg">{r.name}</p>
                    <p className="text-xs text-fg-subtle">{t("Joined {date}", { date: fmt.date(r.createdAt) })}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.status === "REWARDED" && (
                      <span className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--success)] tabular">
                        <Gift className="size-4" aria-hidden />+{fmt.money(r.rewardCents)}
                      </span>
                    )}
                    <StatusPill tone={r.status === "REWARDED" ? "success" : r.status === "VOID" ? "neutral" : "warning"}>
                      {statusLabel[r.status] ?? r.status}
                    </StatusPill>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
