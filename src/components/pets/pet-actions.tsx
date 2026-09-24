"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Send } from "lucide-react";
import { Card } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { Field, Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";

/**
 * Destructive and ownership-changing actions.
 *
 * Kept in their own panel, away from the everyday buttons, and both require an
 * explicit confirmation step. A transfer hands over the animal's entire
 * history, which is not something to make one click away from "Edit".
 */
export function PetActions({
  petId,
  petName,
  hasOpenListing,
}: {
  petId: string;
  petName: string;
  hasOpenListing: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [working, setWorking] = useState(false);

  const [recipient, setRecipient] = useState("");
  const [reason, setReason] = useState<"GIFT" | "RESCUE" | "SALE" | "ADOPTION">("GIFT");

  async function remove() {
    setWorking(true);
    try {
      await api.delete(`/api/pets/${petId}`);
      toast.success(`${petName} archived`, "Their record is kept but hidden.");
      router.push("/dashboard/pets");
      router.refresh();
    } catch (err) {
      toast.error(
        "Could not archive",
        err instanceof ApiError ? err.message : "Please try again.",
      );
      setWorking(false);
      setConfirmDelete(false);
    }
  }

  return (
    <>
      <Card className="p-5">
        <h2 className="font-display text-base font-semibold text-fg">Ownership</h2>
        <p className="mt-1 text-xs leading-relaxed text-fg-muted">
          Transferring hands over the full passport and health history. The new owner has to
          accept before anything moves.
        </p>

        <div className="mt-3 space-y-2">
          <Button variant="outline" size="sm" fullWidth onClick={() => setTransferOpen(true)}>
            <Send className="size-4" aria-hidden />
            Transfer {petName}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            fullWidth
            onClick={() => setConfirmDelete(true)}
            className="text-[var(--danger)] hover:bg-[var(--danger-soft)]"
          >
            <Trash2 className="size-4" aria-hidden />
            Archive profile
          </Button>
        </div>

        {hasOpenListing && (
          <p className="mt-2 text-xs text-fg-subtle">
            Close the open listing before archiving or transferring.
          </p>
        )}
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
        loading={working}
        title={`Archive ${petName}?`}
        description={`Their health record and lineage are kept — offspring and past transactions still reference them — but the profile is hidden and cannot be listed. This cannot be undone from here.`}
        confirmLabel="Archive"
      />

      <Modal
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        title={`Transfer ${petName}`}
        description="The recipient gets the passport, the full health record and the lineage. They must accept before ownership changes."
      >
        <TransferForm
          petId={petId}
          petName={petName}
          recipient={recipient}
          setRecipient={setRecipient}
          reason={reason}
          setReason={setReason}
          onDone={() => {
            setTransferOpen(false);
            router.refresh();
          }}
        />
      </Modal>
    </>
  );
}

function TransferForm({
  petId,
  petName,
  recipient,
  setRecipient,
  reason,
  setReason,
  onDone,
}: {
  petId: string;
  petName: string;
  recipient: string;
  setRecipient: (v: string) => void;
  reason: "GIFT" | "RESCUE" | "SALE" | "ADOPTION";
  setReason: (v: "GIFT" | "RESCUE" | "SALE" | "ADOPTION") => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSending(true);
    setError(null);

    try {
      // Resolve the handle to a member before offering the transfer, so a typo
      // produces a clear message rather than a silent no-op.
      const { user } = await api.get<{ user: { id: string; name: string } | null }>(
        `/api/users/lookup?handle=${encodeURIComponent(recipient.replace(/^@/, ""))}`,
      );

      if (!user) {
        setError("We could not find a member with that handle.");
        setSending(false);
        return;
      }

      await api.post(`/api/pets/${petId}/transfer`, { toUserId: user.id, reason });

      toast.success("Transfer offered", `${user.name} has to accept before ${petName} moves.`);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We could not offer that transfer.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      <Field
        label="Recipient's PetMate handle"
        required
        hint="Ask them for it — it is on their profile."
        error={error}
      >
        {({ id, invalid }) => (
          <Input
            id={id}
            invalid={invalid}
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="@yusuf"
          />
        )}
      </Field>

      <Field label="Reason">
        {({ id }) => (
          <Select id={id} value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
            <option value="GIFT">Gift</option>
            <option value="RESCUE">Rescue or rehoming</option>
            <option value="SALE">Private sale</option>
            <option value="ADOPTION">Adoption</option>
          </Select>
        )}
      </Field>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          onClick={() => void submit()}
          loading={sending}
          loadingText="Sending…"
          disabled={!recipient.trim()}
        >
          Offer transfer
        </Button>
      </div>
    </div>
  );
}
