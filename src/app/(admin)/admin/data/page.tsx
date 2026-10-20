import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Lock } from "lucide-react";
import { requireStaff } from "@/lib/auth/rbac";
import { RESOURCE_GROUPS } from "@/lib/admin/registry";
import { accessFor, countRecords, readableResources } from "@/lib/admin/data.service";
import { PageHeader } from "@/components/ui/primitives";
import { AdminIcon } from "@/components/admin/icons";

export const metadata: Metadata = {
  title: "All tables",
  robots: { index: false, follow: false },
};

/** Every table the caller can open, with a live row count. */
export default async function DataIndexPage() {
  const auth = await requireStaff();
  const resources = readableResources(auth);
  const counts = await Promise.all(resources.map((r) => countRecords(r)));
  const countOf = new Map(resources.map((r, i) => [r.key, counts[i]]));

  return (
    <>
      <PageHeader
        eyebrow="Data"
        title="All tables"
        description="Browse, search, edit, archive and export every record on the platform your role can see. Money records are read-only by design so the ledger always balances."
      />

      <div className="mt-8 space-y-8">
        {RESOURCE_GROUPS.map((group) => {
          const items = resources.filter((r) => r.group === group);
          if (!items.length) return null;
          return (
            <section key={group} aria-labelledby={`group-${group}`}>
              <h2 id={`group-${group}`} className="mb-3 font-display text-lg font-bold text-fg">
                {group}
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {items.map((r) => {
                  const count = countOf.get(r.key);
                  const access = accessFor(auth, r);
                  return (
                    <li key={r.key}>
                      <Link
                        href={`/admin/data/${r.key}`}
                        className="surface surface-lift group flex items-center gap-4 p-4 shadow-[var(--shadow-subtle)]"
                      >
                        <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-brand-soft text-brand">
                          <AdminIcon name={r.icon} className="size-5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                            {r.plural}
                            {!access.write && <Lock className="size-3 text-fg-subtle" aria-label="Read-only" />}
                          </span>
                          <span className="block text-xs text-fg-muted tabular">
                            {count === null || count === undefined ? "Not migrated yet" : `${count.toLocaleString("en-US")} record${count === 1 ? "" : "s"}`}
                          </span>
                        </span>
                        <ArrowRight className="size-4 text-fg-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-brand" aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
