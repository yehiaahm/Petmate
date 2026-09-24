import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { DeleteAccount } from "@/components/settings/delete-account";
import { PageHeader, Card, CardHeader, Alert, DataRow } from "@/components/ui/primitives";
import { formatDate } from "@/lib/utils";
import { ROLE_LABEL, type Role } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Account",
  robots: { index: false, follow: false },
};

export default async function AccountSettingsPage() {
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
        title="Account"
        description="What this account is, and how to close it."
      />

      <div className="mt-6 space-y-5">
        <Card>
          <CardHeader title="Summary" />
          <div className="p-5">
            <dl>
              <DataRow label="Member since" value={formatDate(user.createdAt, "long")} />
              <DataRow
                label="Roles"
                value={user.roles
                  .map((r) => ROLE_LABEL[r.role as Role] ?? r.role)
                  .join(", ")}
              />
              <DataRow label="Completed sales" value={user.completedSales} />
              <DataRow label="Completed purchases" value={user.completedBuys} />
            </dl>
          </div>
        </Card>

        <Card className="border-[var(--danger)]/30">
          <CardHeader
            title="Close your account"
            description="This cannot be undone."
          />
          <div className="space-y-4 p-5">
            <div className="text-sm leading-relaxed text-fg-muted">
              <p className="font-medium text-fg">What happens</p>
              <ul className="mt-2 list-disc space-y-1 ps-5">
                <li>Your name, photo, bio, phone number and location are removed.</li>
                <li>Your email address is replaced with a non-routable placeholder.</li>
                <li>Active listings are withdrawn.</li>
                <li>You are signed out everywhere and cannot sign in again.</li>
              </ul>

              <p className="mt-4 font-medium text-fg">What survives, and why</p>
              <ul className="mt-2 list-disc space-y-1 ps-5">
                <li>Invoices and completed transactions — tax and accounting law requires it.</li>
                <li>
                  Reviews you wrote, attributed to a deleted member — removing them would distort
                  the record for the people they were about.
                </li>
                <li>
                  Your pets&rsquo; records follow the animal. If you transferred a pet, the record
                  stayed with the new owner.
                </li>
              </ul>
            </div>

            {blocked > 0 ? (
              <Alert tone="warning" title="You have transactions in progress">
                <p className="mt-1">
                  {openSales > 0 && `${openSales} sale${openSales === 1 ? "" : "s"} in escrow. `}
                  {openPurchases > 0 &&
                    `${openPurchases} purchase${openPurchases === 1 ? "" : "s"} in escrow. `}
                  {openOrders > 0 && `${openOrders} order${openOrders === 1 ? "" : "s"} in transit. `}
                  Closing now would leave the other side with money held against an account that no
                  longer exists. Complete or cancel them first.
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
