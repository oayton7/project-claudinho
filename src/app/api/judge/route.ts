import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  JUDGE_SYSTEM_PROMPT,
  JudgementSchema,
  buildJudgePrompt,
  parseProductInput,
} from "@/lib/judge";
import { MODEL, MissingApiKey, RateLimited, guarded, priceIt } from "@/lib/claude";

/**
 * Serverless functions are killed after a fixed time. A judgement takes over a
 * minute, which is past the default, so raise the ceiling.
 */
export const maxDuration = 300;

/**
 * POST /api/judge
 *
 * This is the route that makes the API-key lesson real. The key lives in an
 * environment variable read on the server. The browser posts a product and
 * gets a judgement back; it never sees the key, the rubric, or the prompt.
 *
 * The response is a stream of newline-delimited JSON. A judgement takes over
 * a minute, so rather than leave the page dead we stream Claude's reasoning
 * summary as it arrives. It also happens to show you how it reached the
 * verdict, which is worth more than a spinner.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  const parsed = parseProductInput(body);
  if (!parsed.ok) {
    return Response.json(
      { error: "Invalid input", details: parsed.errors },
      { status: 400 },
    );
  }
  const product = parsed.value;

  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController, event: unknown) =>
    controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

  try {
    const stream = await guarded(async (client) =>
      client.messages.stream({
        model: MODEL,
        // A hard cap shared by thinking AND the final answer, not two
        // separate budgets. Too tight and the structured JSON gets cut off
        // mid-string once thinking has used most of it. This costs nothing
        // extra to raise — billed on tokens actually produced, not the cap.
        max_tokens: 16000,
        system: JUDGE_SYSTEM_PROMPT,
        thinking: { type: "adaptive", display: "summarized" },
        output_config: {
          effort: "high",
          format: zodOutputFormat(JudgementSchema),
        },
        messages: [{ role: "user", content: buildJudgePrompt(product) }],
      }),
    );

    const body = new ReadableStream({
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

          if (message.stop_reason === "refusal") {
            send(controller, {
              type: "error",
              error: "Claude declined this one. Try rephrasing the product.",
            });
            return;
          }

          const text = message.content.find((b) => b.type === "text");
          const judgement = JudgementSchema.safeParse(
            text ? JSON.parse(text.text) : null,
          );

          if (!judgement.success) {
            send(controller, {
              type: "error",
              error: "Claude replied but not in the expected shape. Try again.",
            });
            return;
          }

          const usage = priceIt(message.usage);
          console.log(
            `[judge] ${product.name} → ${judgement.data.verdict} | ${usage.inputTokens} in, ${usage.outputTokens} out, ${usage.costPence}p`,
          );
          send(controller, { type: "done", judgement: judgement.data, usage });
        } catch (error) {
          console.error("[judge] stream failed", error);
          send(controller, {
            type: "error",
            error: "Lost the connection to Claude part-way through.",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(body, {
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
    console.error("[judge] failed", error);
    return Response.json(
      { error: "Could not reach Claude. Check the server logs." },
      { status: 502 },
    );
  }
}
