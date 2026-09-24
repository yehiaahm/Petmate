"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/modal";
import { api, ApiError } from "@/lib/api-client";

export function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function destroy() {
    setWorking(true);
    setError(null);
    try {
      await api.post("/api/account", { action: "delete-account", confirm: "DELETE" });
      // A full document navigation, not `router.push`. The router keeps the
      // RSC payload cache and every client component's state, all of which
      // belong to an account that no longer exists. `replace` also drops the
      // settings page from history so Back cannot return to it.
      window.location.replace("/?closed=1");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not close the account.");
      setWorking(false);
    }
  }

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        <Trash2 className="size-4" aria-hidden />
        Close my account
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="Close your account permanently?">
        <div className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}

          <Alert tone="danger">
            <p>
              This cannot be undone. You will not be able to sign in, recover your listings, or
              reclaim your handle.
            </p>
          </Alert>

          <Field
            label="Type DELETE to confirm"
            hint="Case-sensitive, so this cannot happen by accident."
          >
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="off"
                placeholder="DELETE"
              />
            )}
          </Field>

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Keep my account
            </Button>
            <Button
              variant="danger"
              onClick={destroy}
              disabled={confirm !== "DELETE"}
              loading={working}
              loadingText="Closing…"
            >
              Close account
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
