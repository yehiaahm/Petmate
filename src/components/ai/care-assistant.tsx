"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Sparkles, Send, User, Cpu, ListChecks, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Textarea, Select } from "@/components/ui/field";
import { Card, Badge, Alert } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

interface Pet {
  id: string;
  name: string;
  species: string;
  breed: string | null;
}

interface Turn {
  role: "user" | "assistant";
  content: string;
  /** Which engine produced it. Never inferred — the server says. */
  source?: "ai" | "rules";
  links?: { label: string; href: string }[];
}

const SUGGESTIONS = [
  "What vaccinations are due next?",
  "How much should my puppy be eating at this age?",
  "Is it normal for a cat to sleep this much?",
  "What should I ask the vet at the next check-up?",
];

/**
 * Care assistant chat.
 *
 * Reads the server-sent stream when an AI provider is configured, and renders
 * the deterministic router's answer when one is not. The distinction is
 * displayed on every message rather than hidden: a rules answer presented as
 * an AI answer would be a lie about what the product does.
 */
export function CareAssistant({
  pets,
  aiAvailable,
}: {
  pets: Pet[];
  aiAvailable: boolean;
}) {
  const [petId, setPetId] = useState(pets[0]?.id ?? "");
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function readCsrf(): string | null {
    const match = document.cookie.match(/(?:^|;\s*)pm_csrf=([^;]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  }

  async function ask(text: string) {
    const trimmed = text.trim();
    if (trimmed.length < 2 || streaming) return;

    setError(null);
    setQuestion("");
    const history = turns.map((t) => ({ role: t.role, content: t.content }));
    setTurns((prev) => [...prev, { role: "user", content: trimmed }]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const token = readCsrf();
      const response = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-csrf-token": token } : {}),
        },
        credentials: "same-origin",
        signal: controller.signal,
        body: JSON.stringify({
          question: trimmed,
          petId: petId || undefined,
          history: history.slice(-8),
        }),
      });

      const contentType = response.headers.get("content-type") ?? "";

      // Not a stream: either the deterministic path or an error body.
      if (!contentType.includes("text/event-stream")) {
        const payload = await response.json();

        if (!response.ok) {
          setError(payload?.error?.message ?? "The assistant is unavailable right now.");
          setTurns((prev) => prev.slice(0, -1));
          return;
        }

        setTurns((prev) => [
          ...prev,
          {
            role: "assistant",
            content: payload.answer ?? "",
            source: payload.source === "ai" ? "ai" : "rules",
            links: payload.links ?? [],
          },
        ]);
        return;
      }

      setTurns((prev) => [...prev, { role: "assistant", content: "", source: "ai" }]);

      const reader = response.body?.getReader();
      if (!reader) throw new Error("no stream");

      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;

          try {
            const event = JSON.parse(payload) as { text?: string; error?: string };
            if (event.error) {
              setError(event.error);
              continue;
            }
            if (event.text) {
              setTurns((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.role === "assistant") {
                  next[next.length - 1] = { ...last, content: last.content + event.text };
                }
                return next;
              });
            }
          } catch {
            // A partial frame; the next chunk completes it.
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError("The assistant stopped unexpectedly. Please try again.");
        setTurns((prev) => (prev[prev.length - 1]?.content === "" ? prev.slice(0, -1) : prev));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  const selectedPet = pets.find((p) => p.id === petId);

  return (
    <div>
      {pets.length > 0 ? (
        <div className="max-w-xs">
          <Field
            label="Which pet?"
            hint="Their records are used to ground the answer. Only pets you own are available."
          >
            {({ id }) => (
              <Select id={id} value={petId} onChange={(e) => setPetId(e.target.value)}>
                <option value="">No specific pet</option>
                {pets.map((pet) => (
                  <option key={pet.id} value={pet.id}>
                    {pet.name}
                    {pet.breed ? ` · ${pet.breed}` : ` · ${pet.species.toLowerCase()}`}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      ) : (
        <Alert tone="info">
          <p>
            You have no pets on PetMate yet, so answers will be general.{" "}
            <Link href="/dashboard/pets/new" className="font-medium underline">
              Add a pet
            </Link>{" "}
            and the assistant can use their actual vaccination history and age.
          </p>
        </Alert>
      )}

      {turns.length === 0 && (
        <div className="mt-6">
          <p className="text-sm font-medium text-fg">Try asking</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <li key={suggestion}>
                <button
                  type="button"
                  onClick={() => ask(suggestion)}
                  disabled={streaming}
                  className="rounded-full border border-[var(--border)] px-3.5 py-1.5 text-sm text-fg-muted transition-colors hover:border-[var(--border-strong)] hover:text-fg disabled:opacity-50"
                >
                  {suggestion}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {turns.length > 0 && (
        <ol className="mt-6 space-y-3">
          {turns.map((turn, index) => (
            <li key={index}>
              <Card
                as="article"
                className={cn("p-5", turn.role === "user" && "bg-bg-sunken")}
              >
                <div className="flex items-center gap-2">
                  {turn.role === "user" ? (
                    <User className="size-4 text-fg-subtle" aria-hidden />
                  ) : (
                    <Cpu className="size-4 text-brand" aria-hidden />
                  )}
                  <span className="text-sm font-semibold text-fg">
                    {turn.role === "user" ? "You" : "Assistant"}
                  </span>
                  {turn.role === "assistant" && turn.source && (
                    <Badge tone={turn.source === "ai" ? "brand" : "neutral"} size="sm">
                      {turn.source === "ai" ? (
                        <>
                          <Sparkles className="me-1 size-3" aria-hidden />
                          AI answer
                        </>
                      ) : (
                        <>
                          <ListChecks className="me-1 size-3" aria-hidden />
                          Rule-based
                        </>
                      )}
                    </Badge>
                  )}
                </div>

                <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-fg-muted">
                  {turn.content}
                  {turn.role === "assistant" && streaming && index === turns.length - 1 && (
                    <span
                      className="ms-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-brand align-text-bottom"
                      aria-hidden
                    />
                  )}
                </p>

                {turn.links && turn.links.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {turn.links.map((link) => (
                      <li key={link.href}>
                        <Link
                          href={link.href}
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
                        >
                          {link.label}
                          <ArrowRight className="rtl:-scale-x-100 size-3.5" aria-hidden />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </li>
          ))}
        </ol>
      )}

      {error && (
        <Alert tone="danger" className="mt-4">
          {error}
        </Alert>
      )}

      <form
        className="mt-5"
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <Field
          label={selectedPet ? `Ask about ${selectedPet.name}` : "Your question"}
          trailing={`${question.length}/2000`}
        >
          {({ id, invalid }) => (
            <Textarea
              id={id}
              invalid={invalid}
              rows={3}
              maxLength={2000}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  ask(question);
                }
              }}
              placeholder={
                aiAvailable
                  ? "She has been scratching her ear for two days. Is that something to worry about?"
                  : "Ask a question and I will point you to the right part of PetMate."
              }
            />
          )}
        </Field>

        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-fg-subtle">⌘/Ctrl + Enter to send</p>
          <Button
            type="submit"
            loading={streaming}
            loadingText="Thinking…"
            disabled={question.trim().length < 2}
          >
            <Send className="rtl:-scale-x-100 size-4" aria-hidden />
            Ask
          </Button>
        </div>
      </form>
    </div>
  );
}
