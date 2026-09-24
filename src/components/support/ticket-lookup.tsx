"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Card } from "@/components/ui/primitives";

/**
 * Jumps to an existing ticket.
 *
 * The reference alone is not enough to read a thread — the ticket page asks a
 * signed-out visitor for the email it was opened with — so this is only a
 * navigation shortcut and deliberately does no lookup of its own.
 */
export function TicketLookup({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const value = reference.trim().toUpperCase();
    if (!/^SUP-[A-Z0-9]{4,16}$/.test(value)) {
      setError("References look like SUP-4KD29XQ1.");
      return;
    }
    router.push(`/support/${value}`);
  }

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <Ticket className="size-4 text-fg-subtle" aria-hidden />
        <h3 className="text-sm font-semibold text-fg">Track a request</h3>
      </div>
      <form onSubmit={onSubmit} className="mt-3 space-y-3" noValidate>
        <Field label="Reference" error={error}>
          {({ id, invalid }) => (
            <Input
              id={id}
              invalid={invalid}
              value={reference}
              onChange={(e) => {
                setReference(e.target.value);
                setError(null);
              }}
              placeholder="SUP-4KD29XQ1"
              className="font-mono"
            />
          )}
        </Field>
        <Button type="submit" variant="outline" size="sm" fullWidth>
          Open
        </Button>
      </form>
      {signedIn && (
        <p className="mt-3 text-xs text-fg-subtle">
          Your previous requests are listed in{" "}
          <a href="/settings/support" className="font-medium text-brand hover:underline">
            Settings → Support
          </a>
          .
        </p>
      )}
    </Card>
  );
}
