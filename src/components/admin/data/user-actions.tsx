"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, MailCheck, ShieldCheck, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { ROLE_LABEL, type Role } from "@/lib/constants";
import { GRANTABLE_ROLES } from "@/lib/admin/registry";
import { cn } from "@/lib/utils";

/**
 * Member controls that are more than a field edit: roles, suspension,
 * signing out every device, and confirming an email by hand. Each goes
 * through the purpose-built admin action, which carries its own escalation
 * rules (only a super admin grants admin or super admin) and notifications.
 */
export function UserActions({
  user,
  isSelf,
  actorIsSuper,
}: {
  user: { id: string; name: string; status: string; roles: string[]; emailVerified: boolean; liveSessions: number };
  isSelf: boolean;
  actorIsSuper: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [suspending, setSuspending] = useState(false);
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("");

  async function act(key: string, body: Record<string, unknown>, success: string) {
    setBusy(key);
    try {
      await api.post("/api/admin", { userId: user.id, ...body });
      toast.success(success);
      router.refresh();
      return true;
    } catch (err) {
      toast.error("That did not go through", err instanceof ApiError ? err.message : "Please try again.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="surface shadow-[var(--shadow-subtle)]" aria-labelledby="member-controls">
      <div className="border-b border-[var(--border)] px-5 py-4">
        <h2 id="member-controls" className="text-lg font-semibold text-fg">
          Member controls
        </h2>
        <p className="mt-0.5 text-sm text-fg-muted">Roles and account state. Every action is audited.</p>
      </div>

      <div className="space-y-5 p-5">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Roles</p>
          <div className="flex flex-wrap gap-1.5">
            {GRANTABLE_ROLES.map((role) => {
              const has = user.roles.includes(role);
              const locked =
                ((role === "ADMIN" || role === "SUPER_ADMIN") && !actorIsSuper) || (isSelf && has);
              return (
                <button
                  key={role}
                  type="button"
                  disabled={locked || busy === `role:${role}`}
                  onClick={() =>
                    act(`role:${role}`, { action: "set-role", role, grant: !has }, has ? `${ROLE_LABEL[role as Role]} removed` : `${ROLE_LABEL[role as Role]} granted`)
                  }
                  aria-pressed={has}
                  title={locked ? (isSelf ? "You cannot remove your own role." : "Only a super admin can change this role.") : undefined}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                    has
                      ? "bg-brand text-brand-fg"
                      : "border border-[var(--border)] text-fg-muted hover:border-[var(--brand)] hover:text-brand",
                  )}
                >
                  {ROLE_LABEL[role as Role] ?? role}
                </button>
              );
            })}
          </div>
        </div>

        {!isSelf && (
          <div className="grid gap-2 sm:grid-cols-2">
            {user.status === "ACTIVE" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setReason("");
                  setDays("");
                  setSuspending(true);
                }}
              >
                <ShieldOff className="size-4" aria-hidden />
                Suspend
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                loading={busy === "reinstate"}
                onClick={() => act("reinstate", { action: "reinstate-user", note: "Reinstated from the control center." }, "Account reinstated")}
              >
                <ShieldCheck className="size-4" aria-hidden />
                Reinstate
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={user.liveSessions === 0}
              loading={busy === "sessions"}
              onClick={() => act("sessions", { action: "revoke-sessions" }, "Signed out of every device")}
            >
              <LogOut className="size-4" aria-hidden />
              Sign out everywhere{user.liveSessions ? ` (${user.liveSessions})` : ""}
            </Button>
            {!user.emailVerified && (
              <Button
                variant="outline"
                size="sm"
                loading={busy === "verify"}
                onClick={() => act("verify", { action: "verify-email" }, "Email marked as verified")}
                className="sm:col-span-2"
              >
                <MailCheck className="size-4" aria-hidden />
                Mark email as verified
              </Button>
            )}
          </div>
        )}
      </div>

      <Modal open={suspending} onClose={() => setSuspending(false)} title={`Suspend ${user.name}?`}>
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-fg-muted">
            They keep read access to their own data and any money owed to them. They cannot list, message or transact,
            and are told the reason you give below.
          </p>
          <Field label="Reason" required hint="Shown to the account holder.">
            {({ id, invalid }) => (
              <Input id={id} invalid={invalid} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            )}
          </Field>
          <Field label="Days" hint="Leave blank for indefinite.">
            {({ id, invalid }) => (
              <Input id={id} invalid={invalid} type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} className="tabular" />
            )}
          </Field>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setSuspending(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy === "suspend"}
              disabled={reason.trim().length < 3}
              onClick={async () => {
                const ok = await act(
                  "suspend",
                  { action: "suspend-user", reason, ...(days ? { days: Number(days) } : {}) },
                  "Account suspended",
                );
                if (ok) setSuspending(false);
              }}
            >
              Suspend
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
