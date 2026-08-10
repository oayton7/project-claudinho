import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  JudgementSchema,
  PREMORTEM_SYSTEM_PROMPT,
  PremortemSchema,
  buildPremortemPrompt,
  parseProductInput,
} from "@/lib/judge";
import { MODEL, MissingApiKey, RateLimited, guarded, priceIt } from "@/lib/claude";

/**
 * Serverless functions are killed after a fixed time. A pre-mortem takes
 * around two minutes, which is well past the default, so raise the ceiling.
 */
export const maxDuration = 300;

/**
 * POST /api/premortem
 *
 * Separate from /api/judge because the plan says the pre-mortem fires on
 * things you are about to buy, not on every candidate — and keeping it on
 * demand halves the cost of screening.
 *
 * Streams newline-delimited JSON for the same reason the Judge does: this is
 * the slowest call in the app, and a non-streaming response sat silent long
 * enough that the platform gave up on it.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const product = parseProductInput(raw.product);
  if (!product.ok) {
    return Response.json(
      { error: "Invalid product", details: product.errors },
      { status: 400 },
    );
  }

  const judgement = JudgementSchema.safeParse(raw.judgement);
  if (!judgement.success) {
    return Response.json(
      { error: "Run the Judge before the pre-mortem" },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController, event: unknown) =>
    controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

  try {
    const stream = await guarded(async (client) =>
      client.messages.stream({
        model: MODEL,
        max_tokens: 8000,
        system: PREMORTEM_SYSTEM_PROMPT,
        thinking: { type: "adaptive", display: "summarized" },
        output_config: {
          effort: "high",
          format: zodOutputFormat(PremortemSchema),
        },
        messages: [
          {
            role: "user",
            content: buildPremortemPrompt(product.value, judgement.data),
          },
        ],
      }),
    );

    const responseBody = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "thinking_delta"
            ) {
              send(controller, { type: "thinking", text: event.delta.thinking });
            }
          }

          const message = await stream.finalMessage();
          const text = message.content.find((b) => b.type === "text");
          const premortem = PremortemSchema.safeParse(
            text ? JSON.parse(text.text) : null,
          );

          if (!premortem.success) {
            send(controller, {
              type: "error",
              error: "Claude replied but not in the expected shape. Try again.",
            });
            return;
          }

          const usage = priceIt(message.usage);
          console.log(
            `[premortem] ${product.value.name} | ${usage.inputTokens} in, ${usage.outputTokens} out, ${usage.costPence}p`,
          );
          send(controller, { type: "done", premortem: premortem.data, usage });
        } catch (error) {
          console.error("[premortem] stream failed", error);
          send(controller, {
            type: "error",
            error: "Lost the connection to Claude part-way through.",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(responseBody, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof MissingApiKey) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof RateLimited) {
      return Response.json({ error: error.message }, { status: 429 });
    }
    console.error("[premortem] failed", error);
    return Response.json(
      { error: "Could not reach Claude. Check the server logs." },
      { status: 502 },
    );
  }
}
