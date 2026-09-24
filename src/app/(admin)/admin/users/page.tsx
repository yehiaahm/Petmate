import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { UserAdmin } from "@/components/admin/user-admin";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Members",
  robots: { index: false, follow: false },
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  await requirePermission("admin:users");
  const params = await searchParams;

  const query = (params.q ?? "").trim().toLowerCase().slice(0, 80);
  const status = params.status && params.status !== "ALL" ? params.status : null;

  const users = await db.user.findMany({
    where: {
      deletedAt: null,
      ...(status ? { status } : {}),
      ...(query
        ? {
            OR: [
              { emailNormalized: { contains: query } },
              { handle: { contains: query } },
              { name: { contains: query } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      name: true,
      handle: true,
      email: true,
      status: true,
      statusReason: true,
      trustScore: true,
      completedSales: true,
      completedBuys: true,
      emailVerifiedAt: true,
      createdAt: true,
      lastSeenAt: true,
      roles: { select: { role: true } },
      _count: { select: { listings: true, pets: true, reportsFiled: true } },
    },
  });

  return (
    <>
      <PageHeader
        title="Members"
        description="Search by name, handle or email. Suspending an account stops it listing, messaging and transacting — it does not delete anything or forfeit money owed."
      />

      <div className="mt-6">
        <UserAdmin
          initialQuery={params.q ?? ""}
          initialStatus={params.status ?? "ALL"}
          users={users.map((u) => ({
            id: u.id,
            name: u.name,
            handle: u.handle,
            email: u.email,
            status: u.status,
            statusReason: u.statusReason,
            trustScore: u.trustScore,
            completedSales: u.completedSales,
            completedBuys: u.completedBuys,
            emailVerified: u.emailVerifiedAt !== null,
            createdAt: u.createdAt.toISOString(),
            lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
            roles: u.roles.map((r) => r.role),
            listingCount: u._count.listings,
            petCount: u._count.pets,
            reportsFiled: u._count.reportsFiled,
          }))}
        />
      </div>
    </>
  );
}
