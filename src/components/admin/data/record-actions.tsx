"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { getResource } from "@/lib/admin/registry";

type Action = "archive" | "restore" | "purge";

/** Archive, restore and permanent delete for one record, each behind a confirmation. */
export function RecordActions({
  resource,
  id,
  archived,
  canWrite,
  canPurge,
  title,
}: {
  resource: string;
  id: string;
  archived: boolean;
  canWrite: boolean;
  canPurge: boolean;
  title: string;
}) {
  const def = getResource(resource)!;
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);

  const sessions = def.key === "sessions";
  const canArchive = canWrite && Boolean(def.softDelete) && !archived;
  const canRestore = canWrite && Boolean(def.softDelete) && archived && def.softDelete?.restorable !== false;
  if (!canArchive && !canRestore && !canPurge) return null;

  async function run(action: Action) {
    setBusy(true);
    try {
      const url = `/api/admin/data/${resource}/${id}`;
      if (action === "archive") await api.delete(url);
      else if (action === "purge") await api.delete(`${url}?mode=hard`);
      else await api.post(url, { action: "restore" });

      toast.success(
        action === "purge"
          ? `${def.label} deleted permanently`
          : action === "restore"
            ? `${def.label} restored`
            : sessions
              ? "Session signed out"
              : `${def.label} archived`,
      );
      setPending(null);
      if (action === "purge") router.push(`/admin/data/${resource}`);
      router.refresh();
    } catch (err) {
      toast.error("That did not go through", err instanceof ApiError ? err.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {canArchive && (
        <Button size="sm" variant="outline" onClick={() => setPending("archive")}>
          <Trash2 className="size-4" aria-hidden />
          {sessions ? "Sign out" : "Archive"}
        </Button>
      )}
      {canRestore && (
        <Button size="sm" variant="outline" onClick={() => setPending("restore")}>
          <RotateCcw className="size-4" aria-hidden />
          Restore
        </Button>
      )}
      {canPurge && (
        <Button size="sm" variant="danger" onClick={() => setPending("purge")}>
          <Trash2 className="size-4" aria-hidden />
          Delete permanently
        </Button>
      )}

      <ConfirmDialog
        open={pending !== null}
        onClose={() => !busy && setPending(null)}
        onConfirm={() => pending && void run(pending)}
        loading={busy}
        tone={pending === "restore" ? "primary" : "danger"}
        title={
          pending === "purge"
            ? `Permanently delete “${title}”?`
            : pending === "restore"
              ? `Restore “${title}”?`
              : sessions
                ? "Sign this session out?"
                : `Archive “${title}”?`
        }
        description={
          pending === "purge"
            ? "The row is removed from the database and cannot be recovered. Records that cascade from it are removed too. If other records still depend on it, the delete is refused and nothing changes."
            : pending === "restore"
              ? "It becomes visible again exactly as it was."
              : sessions
                ? "That device is signed out on its next request."
                : def.key === "users"
                  ? "The member is signed out everywhere, can no longer sign in, and their live listings are taken down. Their data and transaction history stay, and the account can be restored."
                  : `It disappears from the product but stays in the database, and can be restored from the Archived view.`
        }
        confirmLabel={pending === "purge" ? "Delete permanently" : pending === "restore" ? "Restore" : sessions ? "Sign out" : "Archive"}
      />
    </div>
  );
}
