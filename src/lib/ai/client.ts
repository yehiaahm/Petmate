import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Claude client.
 *
 * The single rule for every AI surface in PetMate: **never present a
 * deterministic result as an AI result, and never present an AI result as
 * authoritative.** Each helper returns a discriminated result carrying
 * `source: "ai" | "rules"`, and every UI that renders one says which it was.
 *
 * When `ANTHROPIC_API_KEY` is absent, or the call fails, or it is rate limited,
 * the caller falls back to a real rule-based implementation. The fallbacks are
 * not stubs — they are the behaviour the product would ship if AI did not exist.
 */

let client: Anthropic | null = null;

export function aiAvailable(): boolean {
  const e = env();
  return e.AI_ENABLED && Boolean(e.ANTHROPIC_API_KEY);
}

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({
      apiKey: env().ANTHROPIC_API_KEY,
      maxRetries: 2,
      timeout: 60_000,
    });
  }
  return client;
}

export type AiSource = "ai" | "rules";

export interface AiResult<T> {
  data: T;
  source: AiSource;
  /** Shown to the user when the deterministic path ran, so it is never implied to be AI. */
  note?: string;
}

export const ruleResult = <T>(data: T, note?: string): AiResult<T> => ({
  data,
  source: "rules",
  note: note ?? "Generated from PetMate's built-in checks, not an AI model.",
});

export const aiResult = <T>(data: T): AiResult<T> => ({ data, source: "ai" });

/** Model identifiers are configurable; the default is the current Opus model. */
export const model = () => env().ANTHROPIC_MODEL;

export interface CallOptions {
  system: string;
  messages: Anthropic.MessageParam[];
  maxTokens?: number;
  /** Lower effort for classification and short rewrites; higher for reasoning. */
  effort?: "low" | "medium" | "high";
  /** Cache the system prompt when it is large and stable across requests. */
  cacheSystem?: boolean;
}

/**
 * One text completion. Returns null on any failure so callers fall back rather
 * than surfacing a provider error to a user who asked about their dog.
 */
export async function callClaude(options: CallOptions): Promise<string | null> {
  if (!aiAvailable()) return null;

  try {
    const response = await getClient().messages.create({
      model: model(),
      max_tokens: options.maxTokens ?? 1500,
      output_config: { effort: options.effort ?? "low" },
      system: options.cacheSystem
        ? [{ type: "text", text: options.system, cache_control: { type: "ephemeral" } }]
        : options.system,
      messages: options.messages,
    });

    // A safety decline is not an error; it is an answer we must not dress up.
    if (response.stop_reason === "refusal") {
      logger.warn("claude declined the request", {
        category: response.stop_details?.category ?? null,
      });
      return null;
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    return text || null;
  } catch (error) {
    logAiError(error);
    return null;
  }
}

/**
 * A structured completion validated against a Zod schema. `parsed_output` is
 * null when the model could not satisfy the schema, and that is treated as a
 * failure so the caller falls back rather than shipping a half-parsed object.
 */
export async function callClaudeStructured<T>(
  options: CallOptions & { outputFormat: unknown },
): Promise<T | null> {
  if (!aiAvailable()) return null;

  try {
    const response = await getClient().messages.parse({
      model: model(),
      max_tokens: options.maxTokens ?? 1024,
      output_config: {
        effort: options.effort ?? "low",
        format: options.outputFormat as never,
      },
      system: options.system,
      messages: options.messages,
    });

    if (response.stop_reason === "refusal") {
      logger.warn("claude declined a structured request");
      return null;
    }

    return (response.parsed_output as T | null) ?? null;
  } catch (error) {
    logAiError(error);
    return null;
  }
}

/** Streams a reply. Used by the care assistant so answers appear as they form. */
export async function streamClaude(
  options: CallOptions,
): Promise<ReadableStream<Uint8Array> | null> {
  if (!aiAvailable()) return null;

  try {
    const stream = getClient().messages.stream({
      model: model(),
      max_tokens: options.maxTokens ?? 2000,
      output_config: { effort: options.effort ?? "low" },
      system: options.cacheSystem
        ? [{ type: "text", text: options.system, cache_control: { type: "ephemeral" } }]
        : options.system,
      messages: options.messages,
    });

    const encoder = new TextEncoder();

    return new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`),
              );
            }
          }

          const final = await stream.finalMessage();
          if (final.stop_reason === "refusal") {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  error: "I cannot help with that. For anything urgent, contact a vet directly.",
                })}\n\n`,
              ),
            );
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (error) {
          logAiError(error);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: "The assistant is unavailable right now." })}\n\n`,
            ),
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      },
      cancel() {
        stream.abort();
      },
    });
  } catch (error) {
    logAiError(error);
    return null;
  }
}

function logAiError(error: unknown): void {
  if (error instanceof Anthropic.RateLimitError) {
    logger.warn("claude rate limited, falling back to rules");
  } else if (error instanceof Anthropic.AuthenticationError) {
    logger.error("claude authentication failed — check ANTHROPIC_API_KEY");
  } else if (error instanceof Anthropic.BadRequestError) {
    logger.exception("claude rejected the request", error);
  } else if (error instanceof Anthropic.APIError) {
    logger.exception("claude API error", error, { status: error.status });
  } else {
    logger.exception("claude call failed", error);
  }
}
