import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getSettings, DEFAULT_SETTINGS, SETTING_DESCRIPTIONS } from "@/lib/settings";
import { SettingsEditor } from "@/components/admin/settings-editor";
import { PageHeader, Alert, Card, CardHeader } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Platform settings",
  robots: { index: false, follow: false },
};

/**
 * Grouping is for the humans reading the page, not a data model. The source of
 * truth is `SettingsShape`; anything added there and left out of a group below
 * still appears, in "Other".
 */
const GROUPS: { title: string; blurb: string; keys: (keyof typeof DEFAULT_SETTINGS)[] }[] = [
  {
    title: "Commission",
    blurb:
      "Taken from the seller on completion, in basis points (100 = 1%). Changing a rate affects transactions that complete from now on; it never re-prices one that already settled.",
    keys: [
      "commissionPetSaleBps",
      "commissionProductBps",
      "commissionAppointmentBps",
      "commissionBreedingBps",
      "transactionFeeCents",
    ],
  },
  {
    title: "Escrow & disputes",
    blurb:
      "How long money is held and how long someone has to object. Shortening the escrow window does not shorten it for money already held.",
    keys: ["escrowAutoReleaseHours", "disputeWindowDays", "payoutHoldDays", "minPayoutCents"],
  },
  {
    title: "Marketplace",
    blurb: "Listing lifetime and what goes to a human before it goes live.",
    keys: ["listingDurationDays", "manualReviewPriceCents", "reviewAllListings"],
  },
  {
    title: "Free-plan limits",
    blurb:
      "What an unpaid account gets. Everything that makes a transaction safe stays free — these are ceilings on volume, not on protection.",
    keys: ["freeActiveListingLimit", "freeBreedingRequestLimit", "freeSavedSearchLimit"],
  },
  {
    title: "Paid placement",
    blurb: "Prices for featured slots, in cents. Placement is always labelled as paid.",
    keys: ["featuredListing7dCents", "featuredListing30dCents"],
  },
  {
    title: "Platform",
    blurb: "Switches that affect everyone. Handle with care.",
    keys: ["registrationOpen", "maintenanceMode", "defaultCurrency", "supportEmail"],
  },
];

export default async function AdminSettingsPage() {
  await requirePermission("admin:settings");

  const [settings, changes] = await Promise.all([
    getSettings(),
    db.auditLog.findMany({
      where: { action: "admin.setting_changed" },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: {
        id: true,
        summary: true,
        createdAt: true,
        actor: { select: { name: true, handle: true } },
      },
    }),
  ]);

  const grouped = GROUPS.map((group) => ({
    ...group,
    fields: group.keys.map((key) => ({
      key: key as string,
      value: settings[key] as string | number | boolean,
      defaultValue: DEFAULT_SETTINGS[key] as string | number | boolean,
      description: SETTING_DESCRIPTIONS[key],
    })),
  }));

  const covered = new Set(GROUPS.flatMap((g) => g.keys as string[]));
  const others = (Object.keys(DEFAULT_SETTINGS) as (keyof typeof DEFAULT_SETTINGS)[]).filter(
    (k) => !covered.has(k as string),
  );

  if (others.length > 0) {
    grouped.push({
      title: "Other",
      blurb: "Settings that exist in the schema but have not been grouped yet.",
      keys: others,
      fields: others.map((key) => ({
        key: key as string,
        value: settings[key] as string | number | boolean,
        defaultValue: DEFAULT_SETTINGS[key] as string | number | boolean,
        description: SETTING_DESCRIPTIONS[key],
      })),
    });
  }

  return (
    <>
      <PageHeader
        title="Platform settings"
        description="Every commercial rule lives here rather than in the code, so changing a commission rate is an operational decision, not a deployment."
      />

      <Alert tone="warning" className="mt-6" title="These take effect immediately">
        <p className="mt-1 leading-relaxed">
          Values are cached for 30 seconds and then read by every request. A change is recorded in
          the audit log with your name against it.
        </p>
      </Alert>

      <div className="mt-6">
        <SettingsEditor groups={grouped} />
      </div>

      <Card className="mt-8">
        <CardHeader title="Recent changes" description="Append-only." />
        <div className="p-5">
          {changes.length === 0 ? (
            <p className="text-sm text-fg-muted">Nothing has been changed yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {changes.map((change) => (
                <li key={change.id} className="flex items-baseline justify-between gap-4 py-2.5">
                  <span className="text-sm text-fg-muted">
                    <span className="font-medium text-fg">
                      {change.actor?.name ?? "System"}
                    </span>{" "}
                    {change.summary}
                  </span>
                  <time className="shrink-0 text-xs text-fg-subtle tabular">
                    {formatDateTime(change.createdAt)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </>
  );
}
