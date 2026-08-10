import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  JUDGE_SYSTEM_PROMPT,
  JudgementSchema,
  buildJudgePrompt,
  parseProductInput,
} from "@/lib/judge";
import { MODEL, MissingApiKey, RateLimited, guarded, priceIt } from "@/lib/claude";

/**
 * POST /api/judge
 *
 * This is the route that makes the API-key lesson real. The key lives in an
 * environment variable read here, on the server. The browser posts a product
 * and gets a judgement back; it never sees the key, the rubric, or the prompt.
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

  try {
    const response = await guarded((client) =>
      client.messages.parse({
        model: MODEL,
        max_tokens: 8000,
        system: JUDGE_SYSTEM_PROMPT,
        output_config: {
          effort: "high",
          format: zodOutputFormat(JudgementSchema),
        },
        messages: [{ role: "user", content: buildJudgePrompt(parsed.value) }],
      }),
    );

    if (response.stop_reason === "refusal") {
      return Response.json(
        { error: "Claude declined to answer this one. Try rephrasing the product." },
        { status: 422 },
      );
    }

    if (!response.parsed_output) {
      return Response.json(
        { error: "Claude replied but not in the expected shape. Try again." },
        { status: 502 },
      );
    }

    const usage = priceIt(response.usage);
    console.log(
      `[judge] ${parsed.value.name} → ${response.parsed_output.verdict} | ${usage.inputTokens} in, ${usage.outputTokens} out, ${usage.costPence}p`,
    );

    return Response.json({ judgement: response.parsed_output, usage });
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
