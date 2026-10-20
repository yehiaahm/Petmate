import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/session";
import { permissionsFor } from "@/lib/auth/rbac";
import { ROLE_LABEL } from "@/lib/constants";
import { RESOURCES, RESOURCE_GROUPS, type ResourceGroup } from "@/lib/admin/registry";
import { getQueueCounts } from "@/lib/admin/overview.service";
import { AdminShell, type NavItem, type NavSection } from "@/components/admin/shell/admin-shell";
import type { NavIconName } from "@/components/admin/icons";
import "./admin.css";

export const metadata: Metadata = {
  title: { default: "Control center", template: "%s · PetMate Control center" },
  robots: { index: false, follow: false },
};

const GROUP_ICON: Record<ResourceGroup, NavIconName> = {
  People: "users",
  Marketplace: "tag",
  Services: "stethoscope",
  Commerce: "store",
  Money: "landmark",
  "Trust & safety": "shield",
  Community: "messages",
  System: "cog",
};

/**
 * Staff console.
 *
 * Authorisation is enforced here as well as in every API the console calls,
 * because a page guard alone only hides a screen — it does not stop anyone
 * calling the endpoint behind it. A non-staff visitor is sent to the dashboard
 * rather than shown a "forbidden" page, which would confirm the console exists.
 *
 * The navigation is built from the caller's permissions, so a moderator never
 * sees a finance link they would only be refused at.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuth();
  if (!auth) redirect("/login?next=/admin");

  const permissions = permissionsFor(auth.user.roles);
  if (!permissions.has("admin:read")) redirect("/dashboard");

  const counts = await getQueueCounts();
  const can = (p: Parameters<typeof permissions.has>[0]) => permissions.has(p);

  const operations: NavItem[] = [];
  if (can("admin:moderation")) {
    operations.push({ href: "/admin/moderation", label: "Moderation", icon: "shield", badge: counts.moderation });
    operations.push({ href: "/admin/support", label: "Support inbox", icon: "lifebuoy", badge: counts.tickets });
  }
  if (can("admin:finance")) {
    operations.push({ href: "/admin/finance", label: "Finance", icon: "landmark", badge: counts.payouts });
  }

  const dataSections: NavSection[] = RESOURCE_GROUPS.map((group) => ({
    title: group,
    icon: GROUP_ICON[group],
    collapsible: true,
    items: RESOURCES.filter((r) => r.group === group && permissions.has(r.read)).map((r) => ({
      href: `/admin/data/${r.key}`,
      label: r.plural,
      icon: r.icon,
    })),
  })).filter((s) => s.items.length > 0);

  const platform: NavItem[] = [{ href: "/admin/data", label: "All tables", icon: "database", exact: true }];
  if (can("admin:settings")) {
    platform.push({
      href: "/admin/system",
      label: "System health",
      icon: "health",
      badge: counts.failedJobs + counts.failedEmails,
    });
    platform.push({ href: "/admin/settings", label: "Settings", icon: "settings" });
  }

  const sections: NavSection[] = [
    { title: "Overview", items: [{ href: "/admin", label: "Dashboard", icon: "dashboard", exact: true }] },
    ...(operations.length ? [{ title: "Operations", items: operations }] : []),
    { title: "Data", items: [] },
    ...dataSections,
    { title: "Platform", items: platform },
  ];

  const topRole = (["SUPER_ADMIN", "ADMIN", "MODERATOR"] as const).find((r) => auth.user.roles.includes(r));

  return (
    <AdminShell
      sections={sections}
      user={{
        name: auth.user.name,
        email: auth.user.email,
        handle: auth.user.handle,
        avatarUrl: auth.user.avatarUrl,
        roleLabel: topRole ? ROLE_LABEL[topRole] : "Staff",
      }}
    >
      {children}
    </AdminShell>
  );
}
