import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ExternalLink, History, Info, Link2 } from "lucide-react";
import { requireStaff } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { features } from "@/lib/features";
import { getResource, humanize, statusTone } from "@/lib/admin/registry";
import { accessFor, getRecord, labelFor } from "@/lib/admin/data.service";
import { cuidSchema } from "@/lib/validation/common";
import { AppError } from "@/lib/errors";
import { Alert, Avatar, Badge, StatusPill } from "@/components/ui/primitives";
import { AdminIcon } from "@/components/admin/icons";
import { RecordEditor } from "@/components/admin/data/record-editor";
import { RecordActions } from "@/components/admin/data/record-actions";
import { UserActions } from "@/components/admin/data/user-actions";
import { formatDateTime, relativeTime } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ resource: string }> }): Promise<Metadata> {
  const def = getResource((await params).resource);
  return { title: def ? `${def.label} record` : "Record", robots: { index: false, follow: false } };
}

const CLINIC_RESOURCES = new Set(["clinics", "appointments"]);

export default async function RecordPage({ params }: { params: Promise<{ resource: string; id: string }> }) {
  const auth = await requireStaff();
  const { resource, id } = await params;
  const def = getResource(resource);
  if (!def || !cuidSchema.safeParse(id).success) notFound();
  const access = accessFor(auth, def);
  if (!access.read) notFound();

  let record: Awaited<ReturnType<typeof getRecord>>;
  try {
    record = await getRecord(auth, def, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { row, refs, children, history } = record;

  const title = labelFor(def, row);
  const status = def.status ? (row[def.status] as string | null) : null;
  const sd = def.softDelete;
  const archived = sd ? (sd.value === "now" ? row[sd.field] != null : row[sd.field] === sd.value) : false;
  const publicPath =
    def.publicPath && !archived && !(CLINIC_RESOURCES.has(def.key) && !features.clinics) ? def.publicPath(row) : null;

  const member =
    def.key === "users"
      ? await db.user.findUnique({
          where: { id },
          select: {
            avatarUrl: true,
            emailVerifiedAt: true,
            roles: { select: { role: true } },
            _count: { select: { sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } } } } },
          },
        })
      : null;

  const readOnlyReason =
    def.write === null ? "This table is read-only" : !access.write ? "Your role can view but not edit this" : null;

  return (
    <>
      {/* ---- Header -------------------------------------------------------- */}
      <header className="animate-in-up flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          {member ? (
            <Avatar src={member.avatarUrl} name={title} size="lg" />
          ) : (
            <span className="flex size-14 shrink-0 items-center justify-center rounded-[1.1rem] bg-brand-soft text-brand [&_svg]:size-6">
              <AdminIcon name={def.icon} />
            </span>
          )}
          <div className="min-w-0">
            <p className="eyebrow mb-1.5">
              <Link href={`/admin/data/${def.key}`} className="hover:underline">
                {def.plural}
              </Link>
            </p>
            <h1 className="break-words font-display text-2xl font-bold leading-tight tracking-tight text-fg sm:text-3xl">
              {title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
              {status && <StatusPill tone={statusTone(status)}>{humanize(status)}</StatusPill>}
              {archived && <Badge tone="danger">{def.key === "sessions" ? "Revoked" : "Archived"}</Badge>}
              {member && member.roles.some((r) => r.role !== "USER") && (
                <Badge tone="brand">{member.roles.filter((r) => r.role !== "USER").map((r) => humanize(r.role)).join(" · ")}</Badge>
              )}
              <span className="font-mono text-xs">{id}</span>
              {typeof row.createdAt === "string" && (
                <span suppressHydrationWarning>· created {relativeTime(row.createdAt)}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {publicPath && (
            <Link
              href={publicPath}
              target="_blank"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--border-strong)] px-4 text-sm font-semibold text-fg transition-colors hover:border-[var(--brand)] hover:text-brand"
            >
              <ExternalLink className="size-4" aria-hidden />
              View on site
            </Link>
          )}
          <RecordActions
            resource={def.key}
            id={id}
            archived={archived}
            canWrite={access.write}
            canPurge={access.purge}
            title={title}
          />
        </div>
      </header>

      {def.note && (
        <Alert tone="info" className="mt-5" icon={<Info className="size-4" aria-hidden />}>
          {def.note}
        </Alert>
      )}

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          {/* Remount when the record changes, so a save made elsewhere on the page
              (a suspension, a role) never shows up as an unsaved edit here. */}
          <RecordEditor
            key={JSON.stringify(row)}
            resource={def.key}
            row={row}
            refs={refs}
            editable={access.editable}
            readOnlyReason={readOnlyReason}
          />
        </div>

        <aside className="space-y-5">
          {member && (
            <UserActions
              user={{
                id,
                name: title,
                status: String(row.status ?? "ACTIVE"),
                roles: member.roles.map((r) => r.role),
                emailVerified: member.emailVerifiedAt !== null,
                liveSessions: member._count.sessions,
              }}
              isSelf={id === auth.user.id}
              actorIsSuper={auth.user.roles.includes("SUPER_ADMIN")}
            />
          )}

          {children.length > 0 && (
            <section className="surface shadow-[var(--shadow-subtle)]" aria-labelledby="related">
              <div className="flex items-center gap-2 border-b border-[var(--border)] px-5 py-4">
                <Link2 className="size-4 text-fg-subtle" aria-hidden />
                <h2 id="related" className="text-lg font-semibold text-fg">
                  Related records
                </h2>
              </div>
              <ul className="divide-y divide-[var(--border)]">
                {children.map((child) => (
                  <li key={`${child.resource}-${child.field}`} className="px-5 py-3.5">
                    <Link
                      href={`/admin/data/${child.resource}?f.${child.field}=${id}`}
                      className="group flex items-center justify-between gap-3"
                    >
                      <span className="text-sm font-semibold text-fg group-hover:text-brand">{child.label}</span>
                      <span className="flex items-center gap-1.5 text-sm text-fg-muted">
                        <span className="tabular">{child.count.toLocaleString("en-US")}</span>
                        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                      </span>
                    </Link>
                    {child.rows.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {child.rows.map((r) => (
                          <li key={r.id}>
                            <Link
                              href={`/admin/data/${child.resource}/${r.id}`}
                              className="flex items-center justify-between gap-2 rounded-[8px] px-2 py-1 text-xs text-fg-muted hover:bg-bg-sunken hover:text-fg"
                            >
                              <span className="truncate">{r.label}</span>
                              {r.status && (
                                <span className="shrink-0 text-[11px] text-fg-subtle">{humanize(r.status)}</span>
                              )}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="surface shadow-[var(--shadow-subtle)]" aria-labelledby="history">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-5 py-4">
              <span className="flex items-center gap-2">
                <History className="size-4 text-fg-subtle" aria-hidden />
                <h2 id="history" className="text-lg font-semibold text-fg">
                  History
                </h2>
              </span>
              {accessFor(auth, getResource("audit-logs")!).read && (
                <Link
                  href={`/admin/data/audit-logs?f.entityType=${def.entityType}&f.entityId=${id}`}
                  className="text-xs font-semibold text-brand hover:underline"
                >
                  Full log
                </Link>
              )}
            </div>
            {history.length === 0 ? (
              <p className="px-5 py-6 text-sm text-fg-muted">No recorded changes yet.</p>
            ) : (
              <ol className="relative space-y-4 px-5 py-4">
                {history.map((h) => (
                  <li key={h.id} className="relative pl-5">
                    <span className="absolute left-0 top-1.5 size-2 rounded-full bg-brand ring-4 ring-brand-soft" aria-hidden />
                    <p className="text-sm text-fg">
                      <span className="font-semibold">{h.actor?.name ?? "System"}</span>
                      <span className="text-fg-muted"> · {h.action}</span>
                    </p>
                    {h.summary && h.changes.length === 0 && <p className="mt-0.5 text-xs text-fg-muted">{h.summary}</p>}
                    {h.changes.length > 0 && (
                      <ul className="mt-1.5 space-y-1 rounded-[10px] bg-bg-sunken p-2 text-xs">
                        {h.changes.map((c) => (
                          <li key={c.field} className="break-words">
                            <span className="font-semibold text-fg">{c.field}</span>{" "}
                            <span className="text-[var(--danger)] line-through decoration-1">{c.from}</span>{" "}
                            <span className="text-fg-subtle">→</span>{" "}
                            <span className="text-[var(--success)]">{c.to}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <time dateTime={h.createdAt} className="mt-1 block text-[11px] text-fg-subtle" title={formatDateTime(h.createdAt)} suppressHydrationWarning>
                      {relativeTime(h.createdAt)}
                    </time>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
