import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { DeleteAccount } from "@/components/settings/delete-account";
import { PageHeader, Card, CardHeader, Alert, DataRow } from "@/components/ui/primitives";
import { ROLE_LABEL, type Role } from "@/lib/constants";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
  title: t("Account"),
  robots: { index: false, follow: false },
};
}

export default async function AccountSettingsPage() {
  const { t, fmt } = await getI18n();
  const auth = await requireAuth();

  const [user, blockers] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: auth.user.id },
      select: {
        createdAt: true,
        completedSales: true,
        completedBuys: true,
        roles: { select: { role: true } },
      },
    }),
    // Exactly the counts the server checks before allowing deletion, so the
    // page never offers an action the API is going to refuse.
    Promise.all([
      db.petOrder.count({
        where: {
          sellerId: auth.user.id,
          status: { in: ["IN_ESCROW", "HANDOVER_PENDING", "DISPUTED"] },
        },
      }),
      db.petOrder.count({
        where: {
          buyerId: auth.user.id,
          status: { in: ["IN_ESCROW", "HANDOVER_PENDING", "DISPUTED"] },
        },
      }),
      db.order.count({
        where: { buyerId: auth.user.id, status: { in: ["PAID", "PROCESSING", "SHIPPED"] } },
      }),
    ]),
  ]);

  const [openSales, openPurchases, openOrders] = blockers;
  const blocked = openSales + openPurchases + openOrders;

  return (
    <>
      <PageHeader
        title={t("Account")}
        description={t("What this account is, and how to close it.")}
      />

      <div className="mt-6 space-y-5">
        <Card>
          <CardHeader title={t("Summary")} />
          <div className="p-5">
            <dl>
              <DataRow label={t("Member since")} value={fmt.date(user.createdAt, "long")} />
              <DataRow
                label={t("Roles")}
                value={user.roles
                  .map((r) => t(ROLE_LABEL[r.role as Role] ?? r.role))
                  .join(", ")}
              />
              <DataRow label={t("Completed sales")} value={user.completedSales} />
              <DataRow label={t("Completed purchases")} value={user.completedBuys} />
            </dl>
          </div>
        </Card>

        <Card className="border-[var(--danger)]/30">
          <CardHeader
            title={t("Close your account")}
            description={t("This cannot be undone.")}
          />
          <div className="space-y-4 p-5">
            <div className="text-sm leading-relaxed text-fg-muted">
              <p className="font-medium text-fg">{t("What happens")}</p>
              <ul className="mt-2 list-disc space-y-1 ps-5">
                <li>{t("Your name, photo, bio, phone number and location are removed.")}</li>
                <li>{t("Your email address is replaced with a non-routable placeholder.")}</li>
                <li>{t("Active listings are withdrawn.")}</li>
                <li>{t("You are signed out everywhere and cannot sign in again.")}</li>
              </ul>

              <p className="mt-4 font-medium text-fg">{t("What survives, and why")}</p>
              <ul className="mt-2 list-disc space-y-1 ps-5">
                <li>{t("Invoices and completed transactions — tax and accounting law requires it.")}</li>
                <li>
                  {t("Reviews you wrote, attributed to a deleted member — removing them would distort the record for the people they were about.")}
                </li>
                <li>
                  {t("Your pets’ records follow the animal. If you transferred a pet, the record stayed with the new owner.")}
                </li>
              </ul>
            </div>

            {blocked > 0 ? (
              <Alert tone="warning" title={t("You have transactions in progress")}>
                <p className="mt-1">
                  {openSales > 0 && `${t.plural(openSales, { one: "{count} sale in escrow.", other: "{count} sales in escrow." })} `}
                  {openPurchases > 0 &&
                    `${t.plural(openPurchases, { one: "{count} purchase in escrow.", other: "{count} purchases in escrow." })} `}
                  {openOrders > 0 && `${t.plural(openOrders, { one: "{count} order in transit.", other: "{count} orders in transit." })} `}
                  {t("Closing now would leave the other side with money held against an account that no longer exists. Complete or cancel them first.")}
                </p>
              </Alert>
            ) : (
              <DeleteAccount />
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
