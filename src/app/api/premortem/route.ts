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
 * POST /api/premortem
 *
 * Deliberately a separate route from /api/judge, for two reasons. The plan
 * says the pre-mortem fires on things you are about to buy, not on every
 * candidate — and keeping it on-demand halves the cost of screening.
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

  try {
    const response = await guarded((client) =>
      client.messages.parse({
        model: MODEL,
        max_tokens: 8000,
        system: PREMORTEM_SYSTEM_PROMPT,
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

    if (!response.parsed_output) {
      return Response.json(
        { error: "Claude replied but not in the expected shape. Try again." },
        { status: 502 },
      );
    }

    const usage = priceIt(response.usage);
    console.log(
      `[premortem] ${product.value.name} | ${usage.inputTokens} in, ${usage.outputTokens} out, ${usage.costPence}p`,
    );

    return Response.json({ premortem: response.parsed_output, usage });
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
