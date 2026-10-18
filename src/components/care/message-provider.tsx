"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { api, ApiError } from "@/lib/api-client";

/** Ask before booking: opens a thread with the provider in Messages. */
export function MessageProvider({ providerId, providerName }: { providerId: string; providerName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setSending(true);
    setError(null);
    try {
      const { conversationId } = await api.post<{ conversationId: string }>("/api/care", {
        action: "message",
        providerId,
        body: body.trim(),
      });
      router.push(`/messages/${conversationId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Your message could not be sent.");
      setSending(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <MessageSquare className="size-4" aria-hidden />
        Ask {providerName} a question
      </Button>
    );
  }

  return (
    <div className="space-y-3">
      <Field label={`Message ${providerName}`} trailing={`${body.length}/4000`}>
        {({ id }) => (
          <Textarea
            id={id}
            rows={4}
            maxLength={4000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Can you take a dog who needs medication twice a day?"
          />
        )}
      </Field>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void send()} loading={sending} disabled={body.trim().length < 10}>
          Send
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
