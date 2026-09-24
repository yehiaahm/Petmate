"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, ShieldOff, ShieldCheck, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, Badge, EmptyState, Avatar } from "@/components/ui/primitives";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { formatDate, relativeTime } from "@/lib/utils";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/constants";

export interface AdminUserRow {
  id: string;
  name: string;
  handle: string;
  email: string;
  status: string;
  statusReason: string | null;
  trustScore: number;
  completedSales: number;
  completedBuys: number;
  emailVerified: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  roles: string[];
  listingCount: number;
  petCount: number;
  reportsFiled: number;
}

const STATUS_TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = {
  ACTIVE: "success",
  SUSPENDED: "danger",
  FROZEN: "warning",
  BANNED: "danger",
  DEACTIVATED: "neutral",
};

export function UserAdmin({
  users,
  initialQuery,
  initialStatus,
}: {
  users: AdminUserRow[];
  initialQuery: string;
  initialStatus: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState(initialStatus);
  const [suspending, setSuspending] = useState<AdminUserRow | null>(null);
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  function search(event: React.FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (status !== "ALL") params.set("status", status);
    router.push(`/admin/users${params.toString() ? `?${params}` : ""}`);
  }

  async function act(key: string, body: unknown, title: string) {
    setBusy(key);
    try {
      await api.post("/api/admin", body);
      toast.success(title);
      router.refresh();
      return true;
    } catch (err) {
      toast.error(
        "That did not go through",
        err instanceof ApiError ? err.message : "Please try again.",
      );
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <form onSubmit={search} className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Field label="Search">
            {({ id, invalid }) => (
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
                  aria-hidden
                />
                <Input
                  id={id}
                  invalid={invalid}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Name, handle or email"
                  className="pl-10"
                />
              </div>
            )}
          </Field>
        </div>
        <div className="w-44">
          <Field label="Status">
            {({ id }) => (
              <Select id={id} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="ALL">All</option>
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="FROZEN">Frozen</option>
                <option value="BANNED">Banned</option>
              </Select>
            )}
          </Field>
        </div>
        <Button type="submit">Search</Button>
      </form>

      <div className="mt-5">
        {users.length === 0 ? (
          <EmptyState title="No members match" description="Try a different search." />
        ) : (
          <ul className="space-y-2">
            {users.map((user) => (
              <li key={user.id}>
                <Card className="p-4">
                  <div className="flex flex-wrap items-start gap-4">
                    <Avatar src={null} name={user.name} size="md" />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-medium text-fg">{user.name}</span>
                        <Link
                          href={`/u/${user.handle}`}
                          className="text-xs text-fg-subtle hover:underline"
                        >
                          @{user.handle}
                          <ExternalLink className="ml-0.5 inline size-3" aria-hidden />
                        </Link>
                        <Badge tone={STATUS_TONE[user.status] ?? "neutral"} size="sm">
                          {user.status.toLowerCase()}
                        </Badge>
                        {!user.emailVerified && (
                          <Badge tone="warning" size="sm">
                            unverified email
                          </Badge>
                        )}
                      </div>

                      <p className="mt-0.5 text-xs text-fg-subtle">
                        {user.email} · trust {user.trustScore} · {user.completedSales} sales ·{" "}
                        {user.completedBuys} purchases · {user.listingCount} listings ·{" "}
                        {user.petCount} pets
                      </p>
                      <p className="mt-0.5 text-xs text-fg-subtle">
                        joined {formatDate(user.createdAt)}
                        {user.lastSeenAt
                          ? ` · last seen ${relativeTime(new Date(user.lastSeenAt))}`
                          : ""}
                      </p>

                      {user.statusReason && (
                        <p className="mt-1.5 text-xs text-[var(--danger)]">{user.statusReason}</p>
                      )}

                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {ROLES.map((role) => {
                          const has = user.roles.includes(role);
                          return (
                            <button
                              key={role}
                              type="button"
                              disabled={busy === `role:${user.id}:${role}`}
                              onClick={() =>
                                act(
                                  `role:${user.id}:${role}`,
                                  {
                                    action: "set-role",
                                    userId: user.id,
                                    role,
                                    grant: !has,
                                  },
                                  has ? `${role} removed` : `${role} granted`,
                                )
                              }
                              className={
                                has
                                  ? "rounded-full bg-brand px-2.5 py-1 text-xs font-medium text-brand-fg"
                                  : "rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-fg-subtle hover:border-[var(--border-strong)] hover:text-fg"
                              }
                              aria-pressed={has}
                            >
                              {ROLE_LABEL[role as Role] ?? role}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="shrink-0">
                      {user.status === "ACTIVE" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSuspending(user);
                            setReason("");
                            setDays("");
                          }}
                        >
                          <ShieldOff className="size-4" aria-hidden />
                          Suspend
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          loading={busy === `reinstate:${user.id}`}
                          onClick={() =>
                            act(
                              `reinstate:${user.id}`,
                              {
                                action: "reinstate-user",
                                userId: user.id,
                                note: "Reinstated from the members console.",
                              },
                              "Account reinstated",
                            )
                          }
                        >
                          <ShieldCheck className="size-4" aria-hidden />
                          Reinstate
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        open={suspending !== null}
        onClose={() => setSuspending(null)}
        title={`Suspend ${suspending?.name ?? ""}?`}
      >
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-fg-muted">
            They keep read access to their own data and any money owed to them. They cannot list,
            message or transact. They are told the reason you give below.
          </p>

          <Field label="Reason" required hint="Shown to the account holder.">
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Repeated listings for animals below the legal separation age."
              />
            )}
          </Field>

          <Field label="Days" hint="Leave blank for indefinite.">
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                type="number"
                min={1}
                max={3650}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                className="tabular"
              />
            )}
          </Field>

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setSuspending(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy === `suspend:${suspending?.id}`}
              disabled={reason.trim().length < 3}
              onClick={async () => {
                if (!suspending) return;
                const ok = await act(
                  `suspend:${suspending.id}`,
                  {
                    action: "suspend-user",
                    userId: suspending.id,
                    reason,
                    ...(days ? { days: Number(days) } : {}),
                  },
                  "Account suspended",
                );
                if (ok) setSuspending(null);
              }}
            >
              Suspend
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
