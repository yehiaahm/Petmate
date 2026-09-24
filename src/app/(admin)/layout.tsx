import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/session";
import { permissionsFor } from "@/lib/auth/rbac";
import { Header } from "@/components/shell/header";
import { AdminNav } from "@/components/admin/admin-nav";

/**
 * Staff console.
 *
 * Authorisation is enforced here as well as in every API the console calls,
 * because a page guard alone only hides a screen — it does not stop anyone
 * calling the endpoint behind it. A non-staff visitor is sent to the dashboard
 * rather than shown a "forbidden" page, which would confirm the console exists.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuth();
  if (!auth) redirect("/login?next=/admin");

  if (!permissionsFor(auth.user.roles).has("admin:read")) redirect("/dashboard");

  const permissions = permissionsFor(auth.user.roles);

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <Header />
      <div className="container-page flex-1 py-6 lg:py-8">
        <div className="grid gap-6 lg:grid-cols-[200px_1fr] lg:items-start">
          <AdminNav
            can={{
              moderation: permissions.has("admin:moderation"),
              users: permissions.has("admin:users"),
              finance: permissions.has("admin:finance"),
              settings: permissions.has("admin:settings"),
            }}
          />
          <main id="main" className="min-w-0">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
