import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  JUDGE_SYSTEM_PROMPT,
  JudgementSchema,
  buildJudgePrompt,
  candidateToProductInput,
} from "@/lib/judge";
import {
  MODEL,
  describeError,
  guarded,
  priceIt,
} from "@/lib/claude";
import { getCandidate, saveDeepJudgement, getReviews } from "@/lib/db";

/**
 * POST /api/judge/candidate  { asin }
 *
 * The deep look, on one product, on demand.
 *
 * Triage answers "is this worth an expensive opinion" in a sentence, which is
 * the right shape for fifteen products at a time. This is what you press when
 * the sentence is not enough: the target buyer, what specifically is being
 * done badly and what you would do instead, why nobody has already fixed it,
 * and what would sink it.
 *
 * Costs roughly 9-11p and takes over a minute, which is exactly why it is a
 * button rather than a stage. Stored, so it is bought once.
 *
 * If reviews have been collected for this ASIN they are folded in. That is the
 * single biggest difference between a good judgement and a guess — what buyers
 * complain about is the whole thesis — so the response says plainly whether it
 * had them.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  let asin = "";
  try {
    const body = (await request.json()) as { asin?: string };
    asin = (body.asin ?? "").toUpperCase().trim();
  } catch {
    return Response.json({ error: "Body must be JSON with an asin" }, { status: 400 });
  }

  if (!/^[A-Z0-9]{10}$/.test(asin)) {
    return Response.json({ error: "Pass a 10-character ASIN." }, { status: 400 });
  }

  try {
    const candidate = await getCandidate(asin);
    if (!candidate) {
      return Response.json(
        { error: `${asin} is not in the candidates table. Sweep it first.` },
        { status: 404 },
      );
    }

    // Reviews if they exist. Never invented if they do not.
    const reviews = await getReviews(asin).catch(() => null);
    const reviewText = reviews
      ? [reviews.complaints, reviews.wished_for && `They wish it had: ${reviews.wished_for}`]
          .filter(Boolean)
          .join("\n")
      : null;

    const { input, missing } = candidateToProductInput({
      asin: candidate.asin,
      title: candidate.title,
      brand: candidate.brand,
      category: candidate.category,
      price: candidate.price,
      packageWeightG: candidate.weight_grams,
      rating: candidate.rating,
      reviewCount: candidate.review_count,
      unhappyBuyers: candidate.unhappy_buyers,
      monthlySold: candidate.monthly_sold,
      sellers: candidate.sellers,
      maxLandedCost: candidate.max_landed_cost,
      listingWeaknesses: (candidate.listing_weaknesses || "").split(" · ").filter(Boolean),
      hasAplus: candidate.has_aplus,
      videoCount: candidate.video_count,
      us: candidate.us_growing === null ? null : { growing: candidate.us_growing },
      reviewText,
    });

    const result = await guarded((client) =>
      client.messages.create({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: {
          effort: "high",
          format: zodOutputFormat(JudgementSchema),
        },
        system: JUDGE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildJudgePrompt(input) }],
      }),
    );

    const text = result.content.find((b) => b.type === "text")?.text ?? "{}";
    const parsed = JudgementSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      return Response.json(
        { error: "The Judge's answer did not match the expected shape." },
        { status: 502 },
      );
    }

    const cost = priceIt(result.usage);

    await saveDeepJudgement(asin, {
      judge_verdict: parsed.data.verdict,
      judge_summary: parsed.data.summary,
      judge_json: parsed.data,
      judge_pence: cost.costPence,
      judge_missing: missing.join(" | "),
    }).catch(() => {});

    return Response.json({
      asin,
      judgement: parsed.data,
      cost,
      readReviews: reviewText !== null,
      missing,
    });
  } catch (error) {
    console.error("[judge/candidate]", error);
    return Response.json({ error: describeError(error) }, { status: 502 });
  }
}
