"use client";

import { useState } from "react";
import { CheckCircle2, LifeBuoy } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input, Textarea, Select } from "@/components/ui/field";
import { Alert, Card } from "@/components/ui/primitives";
import { api, ApiError } from "@/lib/api-client";

export interface ContactTopic {
  value: string;
  label: string;
}

interface Props {
  topics: ContactTopic[];
  /** Present when signed in: the identity fields are then fixed server-side. */
  identity: { name: string; email: string } | null;
  defaultTopic?: string;
}

export function ContactForm({ topics, identity, defaultTopic }: Props) {
  const [name, setName] = useState(identity?.name ?? "");
  const [email, setEmail] = useState(identity?.email ?? "");
  const [topic, setTopic] = useState(defaultTopic ?? topics[0]?.value ?? "OTHER");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [orderRef, setOrderRef] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  const fieldError = (field: string) =>
    error instanceof ApiError ? error.fieldError(field) : undefined;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const result = await api.post<{ reference: string }>("/api/support", {
        action: "create",
        ticket: {
          name,
          email,
          topic,
          subject,
          message,
          orderRef: orderRef.trim() || undefined,
        },
      });
      setReference(result.reference);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Something went wrong."));
    } finally {
      setSubmitting(false);
    }
  }

  if (reference) {
    return (
      <Card className="p-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[var(--success-soft)] text-[var(--success)]">
          <CheckCircle2 className="size-6" aria-hidden />
        </div>
        <h2 className="mt-4 font-display text-xl font-semibold text-fg">Message received</h2>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">
          Your reference is{" "}
          <span className="font-mono font-semibold text-fg">{reference}</span>. We sent a copy to{" "}
          <span className="font-medium text-fg">{email}</span> and will reply there.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <ButtonLink href={`/support/${reference}`}>Track this request</ButtonLink>
          <Button variant="outline" onClick={() => setReference(null)}>
            Send another
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2.5">
        <LifeBuoy className="size-5 text-brand" aria-hidden />
        <h2 className="font-display text-xl font-semibold text-fg">Contact support</h2>
      </div>
      <p className="mt-2 text-sm text-fg-muted">
        We reply by email, usually within one working day. Animal-welfare reports are handled
        first.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-5" noValidate>
        {error && !(error instanceof ApiError && error.isValidation) && (
          <Alert tone="danger">{error.message}</Alert>
        )}

        {identity ? (
          <p className="rounded-[var(--radius-field)] bg-bg-sunken px-3.5 py-2.5 text-sm text-fg-muted">
            Sending as <span className="font-medium text-fg">{identity.name}</span> (
            {identity.email}). We reply to that address.
          </p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Your name" required error={fieldError("name")}>
              {({ id, invalid }) => (
                <Input
                  id={id}
                  invalid={invalid}
                  name="name"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </Field>
            <Field
              label="Email address"
              required
              hint="Where we send the reply."
              error={fieldError("email")}
            >
              {({ id, invalid }) => (
                <Input
                  id={id}
                  invalid={invalid}
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </Field>
          </div>
        )}

        <Field label="What is this about?" required error={fieldError("topic")}>
          {({ id }) => (
            <Select id={id} value={topic} onChange={(e) => setTopic(e.target.value)}>
              {topics.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Subject" required error={fieldError("subject")}>
          {({ id, invalid }) => (
            <Input
              id={id}
              invalid={invalid}
              required
              maxLength={140}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Escrow not released after handover"
            />
          )}
        </Field>

        <Field
          label="Order, listing or dispute reference"
          hint="Optional, but it gets you an answer faster."
          error={fieldError("orderRef")}
        >
          {({ id, invalid }) => (
            <Input
              id={id}
              invalid={invalid}
              maxLength={64}
              value={orderRef}
              onChange={(e) => setOrderRef(e.target.value)}
              placeholder="PO-4F2A9C1B"
            />
          )}
        </Field>

        <Field
          label="What happened?"
          required
          error={fieldError("message")}
          trailing={`${message.length}/4000`}
        >
          {({ id, invalid }) => (
            <Textarea
              id={id}
              invalid={invalid}
              required
              rows={7}
              maxLength={4000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Include dates, amounts and what you have already tried. Never include passwords or card numbers — we will never ask for them."
            />
          )}
        </Field>

        <Button type="submit" size="lg" loading={submitting} loadingText="Sending…">
          Send message
        </Button>
      </form>
    </Card>
  );
}
