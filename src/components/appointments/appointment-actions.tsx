"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { XCircle, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";

export function AppointmentActions({
  appointmentId,
  clinicId,
  freeCancellation,
}: {
  appointmentId: string;
  clinicId: string;
  freeCancellation: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [body, setBody] = useState("");
  const [working, setWorking] = useState(false);

  async function cancel() {
    setWorking(true);
    try {
      await api.post("/api/appointments", {
        action: "cancel",
        appointmentId,
        reason: reason.trim() || undefined,
      });
      toast.success("Appointment cancelled");
      setCancelOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(
        "Could not cancel",
        err instanceof ApiError ? err.message : "Please try again.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function message() {
    setWorking(true);
    try {
      const { conversationId } = await api.post<{ conversationId: string }>("/api/clinics", {
        action: "message",
        clinicId,
        body,
      });
      router.push(`/messages/${conversationId}`);
    } catch (err) {
      toast.error(
        "Could not send that",
        err instanceof ApiError ? err.message : "Please try again.",
      );
      setWorking(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <Button variant="outline" size="sm" fullWidth onClick={() => setMessageOpen(true)}>
          <MessageSquare className="size-4" aria-hidden />
          Message the clinic
        </Button>
        <Button variant="ghost" size="sm" fullWidth onClick={() => setCancelOpen(true)}>
          <XCircle className="size-4" aria-hidden />
          Cancel appointment
        </Button>
      </div>

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this appointment?">
        <div className="space-y-4">
          {!freeCancellation && (
            <Alert tone="warning">
              <p>
                You are inside the clinic&rsquo;s cancellation window, so part of the fee may be
                retained. The clinic decides, not us.
              </p>
            </Alert>
          )}

          <Field label="Reason" hint="Optional, but clinics appreciate it.">
            {({ id, invalid }) => (
              <Textarea
                id={id}
                invalid={invalid}
                rows={3}
                maxLength={300}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={cancel} loading={working} loadingText="Cancelling…">
              Cancel appointment
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={messageOpen} onClose={() => setMessageOpen(false)} title="Message the clinic">
        <div className="space-y-4">
          <Field label="Your message" required>
            {({ id, invalid }) => (
              <Textarea
                id={id}
                invalid={invalid}
                rows={5}
                maxLength={2000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Can I move this to the afternoon?"
              />
            )}
          </Field>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setMessageOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={message}
              loading={working}
              loadingText="Sending…"
              disabled={body.trim().length < 2}
            >
              Send
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
