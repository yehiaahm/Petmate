import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Info, Lock } from "lucide-react";
import { requireStaff } from "@/lib/auth/rbac";
import { getResource } from "@/lib/admin/registry";
import { accessFor, countRecords, listRecords, refFilterLabels } from "@/lib/admin/data.service";
import { parseListParams } from "@/lib/admin/query";
import { AppError } from "@/lib/errors";
import { Alert, Badge, PageHeader } from "@/components/ui/primitives";
import { DataTable } from "@/components/admin/data/data-table";

export async function generateMetadata({ params }: { params: Promise<{ resource: string }> }): Promise<Metadata> {
  const def = getResource((await params).resource);
  return { title: def?.plural ?? "Data", robots: { index: false, follow: false } };
}

export default async function ResourceListPage({
  params,
  searchParams,
}: {
  params: Promise<{ resource: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireStaff();
  const def = getResource((await params).resource);
  if (!def) notFound();
  const access = accessFor(auth, def);
  if (!access.read) notFound();

  const query = parseListParams(await searchParams);

  let result: Awaited<ReturnType<typeof listRecords>> | null = null;
  let failure: string | null = null;
  try {
    result = await listRecords(def, query);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    failure = error.message;
  }

  const [active, deleted, filterLabels] = await Promise.all([
    def.softDelete ? countRecords(def, "active") : null,
    def.softDelete ? countRecords(def, "deleted") : null,
    refFilterLabels(def, query.filters ?? {}),
  ]);

  return (
    <>
      <PageHeader
        eyebrow={def.group}
        title={def.plural}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {result ? `${result.total.toLocaleString("en-US")} record${result.total === 1 ? "" : "s"}` : "—"}
            {def.write === null || !access.write ? (
              <Badge tone="neutral" size="sm" icon={<Lock className="size-3" aria-hidden />}>
                Read-only
              </Badge>
            ) : (
              <Badge tone="brand" size="sm">
                Editable
              </Badge>
            )}
            {access.purge && (
              <Badge tone="danger" size="sm">
                Permanent delete enabled
              </Badge>
            )}
          </span>
        }
      />

      {def.note && (
        <Alert tone="info" className="mt-5" icon={<Info className="size-4" aria-hidden />}>
          {def.note}
        </Alert>
      )}

      <div className="mt-5">
        {failure ? (
          <Alert tone="warning" title={`${def.plural} could not be loaded`}>
            {failure}
          </Alert>
        ) : (
          result && (
            <DataTable
              resource={def.key}
              rows={result.rows as (Record<string, unknown> & { id: string })[]}
              refs={result.refs}
              total={result.total}
              page={result.page}
              pages={result.pages}
              query={{
                q: query.q ?? "",
                sort: query.sort ?? null,
                dir: query.dir ?? null,
                view: query.view ?? "active",
                limit: query.limit,
                filters: query.filters ?? {},
              }}
              access={{ write: access.write, purge: access.purge, editable: access.editable }}
              viewCounts={def.softDelete ? { active, deleted } : null}
              filterLabels={filterLabels}
            />
          )
        )}
      </div>
    </>
  );
}
