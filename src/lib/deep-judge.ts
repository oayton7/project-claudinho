/**
 * The deep look at one candidate, in one place.
 *
 * Extracted from /api/judge/candidate so the pipeline can run the same thing
 * unattended. Session 5 of the brief asks for the Judge as a stage — "top 8 to
 * the Judge" — and it was never wired in: runs went finding, sweeping,
 * triaging, done. Triage is Sonnet at about 0.2p answering "is this worth an
 * expensive opinion". Nothing was ever asking the expensive opinion, so 37
 * candidates sat holding a triage TEST and two had ever been judged.
 *
 * API-only, like everything that touches claude.ts or db.ts. Importing this
 * from a page would put the API key in the browser bundle.
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  JUDGE_SYSTEM_PROMPT,
  JudgementSchema,
  buildJudgePrompt,
  candidateToProductInput,
} from "@/lib/judge";
import { MODEL, guarded, priceIt } from "@/lib/claude";
import { getCandidate, saveDeepJudgement, getReviews } from "@/lib/db";
import type { Judgement } from "@/lib/judge";

export type DeepJudgement = {
  asin: string;
  judgement: Judgement;
  cost: ReturnType<typeof priceIt>;
  readReviews: boolean;
  missing: string[];
};

/**
 * Judges one candidate and stores the result.
 *
 * Throws rather than returning a failure shape, so a caller cannot mistake a
 * failed judgement for a cheap one.
 */
export async function judgeOne(asin: string): Promise<DeepJudgement> {
  const candidate = await getCandidate(asin);
  if (!candidate) {
    throw new Error(`${asin} is not in the candidates table. Sweep it first.`);
  }

  // Reviews if they exist. Never invented if they do not — what buyers
  // complain about is the whole thesis, so the caller is told plainly whether
  // the judgement had them.
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
    throw new Error("The Judge's answer did not match the expected shape.");
  }

  const cost = priceIt(result.usage);

  // Deliberately not swallowed. This used to be a .catch(() => {}), which
  // meant a rejected write left you having paid ten pence, stored nothing, and
  // been told it worked — which is exactly how a column typed as integer ate
  // half a session's paid verdicts while every run reported success.
  try {
    await saveDeepJudgement(asin, {
      judge_verdict: parsed.data.verdict,
      judge_summary: parsed.data.summary,
      judge_json: parsed.data,
      judge_pence: cost.costPence,
      judge_missing: missing.join(" | "),
    });
  } catch (error) {
    throw new Error(
      `Judged ${asin} and paid about ${cost.costPence.toFixed(1)}p, but could not store it: ${
        error instanceof Error ? error.message : String(error)
      }. The money is spent either way, so this needs fixing before judging more.`,
    );
  }

  return { asin, judgement: parsed.data, cost, readReviews: reviewText !== null, missing };
}
