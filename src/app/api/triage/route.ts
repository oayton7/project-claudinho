import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  TRIAGE_SYSTEM_PROMPT,
  TriageSchema,
  buildTriagePrompt,
  type Triage,
} from "@/lib/judge";
import {
  MissingApiKey,
  RateLimited,
  TRIAGE_MODEL,
  describeError,
  guardedTriage,
  priceTriage,
} from "@/lib/claude";

/**
 * POST /api/triage
 *
 * Runs the cheap verdict over a list of candidates and streams results back as
 * they land.
 *
 * Three things keep this affordable, in order of how much they matter:
 *
 * 1. A compact schema. Output bills at five times input, and the full Judge
 *    schema was producing ~4,700 output tokens per product. This produces a
 *    few hundred.
 * 2. Sonnet at low effort rather than Opus at high.
 * 3. Prompt caching on the rubric, which is identical on every call. Cached
 *    reads bill at a tenth, so the cache pays for its write premium on the
 *    second product and every one after that is nearly free on the input side.
 *
 * Together that is roughly 0.2p per product against 11p, so a hundred
 * candidates costs about 20p rather than £11.
 */
export const maxDuration = 300;

/** A sweep returns at most this many; beyond it, triage everything worth it. */
const MAX_BATCH = 60;

export async function POST(request: Request) {
  let body: { candidates?: unknown };
  try {
    body = (await request.json()) as { candidates?: unknown };
  } catch {
    return Response.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.candidates) || body.candidates.length === 0) {
    return Response.json(
      { error: "Pass a non-empty candidates array." },
      { status: 400 },
    );
  }

  // Normalise rather than trust the caller's shape. The sweep carries the US
  // signal as a nested object; the prompt builder wants a flat field, and a
  // mismatch would quietly drop the strongest signal there is rather than
  // erroring.
  type Incoming = Parameters<typeof buildTriagePrompt>[0] & {
    asin?: string;
    us?: { growing?: boolean | null } | null;
  };

  const candidates = (body.candidates as Incoming[])
    .slice(0, MAX_BATCH)
    .map((c) => ({
      ...c,
      usGrowing: c.usGrowing ?? c.us?.growing ?? null,
      listingWeaknesses: Array.isArray(c.listingWeaknesses)
        ? c.listingWeaknesses
        : [],
    }));

  const encoder = new TextEncoder();
  const send = (c: ReadableStreamDefaultController, event: unknown) =>
    c.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

  const stream = new ReadableStream({
    async start(controller) {
      let totalPence = 0;
      let done = 0;

      try {
        send(controller, { type: "start", count: candidates.length });

        for (const candidate of candidates) {
          const asin = (candidate as { asin?: string }).asin ?? "";
          try {
            const result = await guardedTriage(async (client) => {
              return client.messages.create({
                model: TRIAGE_MODEL,
                max_tokens: 2000,
                // Low effort is the point. Thinking tokens bill as output, and
                // this decision does not need deliberation, only the rubric.
                output_config: {
                  effort: "low",
                  format: zodOutputFormat(TriageSchema),
                },
                system: [
                  {
                    type: "text",
                    text: TRIAGE_SYSTEM_PROMPT,
                    // The rubric never changes across a run, so cache it. The
                    // per-product text goes in the user turn, after this
                    // breakpoint, where it cannot invalidate the cache.
                    cache_control: { type: "ephemeral" },
                  },
                ],
                messages: [
                  { role: "user", content: buildTriagePrompt(candidate) },
                ],
              });
            });

            const parsed = TriageSchema.safeParse(
              JSON.parse(
                result.content.find((b) => b.type === "text")?.text ?? "{}",
              ),
            );

            const cost = priceTriage(result.usage);
            totalPence += cost.costPence;
            done += 1;

            if (!parsed.success) {
              send(controller, {
                type: "result",
                asin,
                error: "Model output did not match the schema",
                cost,
              });
              continue;
            }

            send(controller, {
              type: "result",
              asin,
              triage: parsed.data satisfies Triage,
              cost,
              // Visible so a broken cache shows up as a cost rise rather than
              // hiding in the total.
              cachedTokens: result.usage.cache_read_input_tokens ?? 0,
            });
          } catch (error) {
            if (error instanceof RateLimited || error instanceof MissingApiKey) {
              send(controller, { type: "error", error: error.message });
              return;
            }
            send(controller, {
              type: "result",
              asin,
              error: describeError(error),
            });
          }
        }

        send(controller, {
          type: "done",
          triaged: done,
          totalPence: Math.round(totalPence * 100) / 100,
          averagePence:
            done > 0 ? Math.round((totalPence / done) * 100) / 100 : 0,
        });
      } catch (error) {
        send(controller, { type: "error", error: describeError(error) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
