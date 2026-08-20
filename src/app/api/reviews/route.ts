import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  REVIEW_SYSTEM_PROMPT,
  ReviewAnalysisSchema,
  buildReviewPrompt,
} from "@/lib/judge";
import {
  TRIAGE_MODEL,
  describeError,
  guardedTriage,
  priceTriage,
} from "@/lib/claude";
import { getReviews, saveReviews } from "@/lib/db";

/**
 * POST /api/reviews  — analyse pasted reviews for one ASIN
 * GET  /api/reviews?asin=… — read back what was found last time
 *
 * Sonnet rather than Opus. Reading reviews and sorting complaints into fixable
 * and not is comprehension rather than deep judgement, and the input can run
 * to tens of thousands of tokens, which is exactly where paying Opus rates
 * hurts. The rubric is cached, so a run costs roughly a penny.
 */
export const maxDuration = 300;

export async function GET(request: Request) {
  const asin = new URL(request.url).searchParams.get("asin")?.toUpperCase().trim() ?? "";
  if (!/^[A-Z0-9]{10}$/.test(asin)) {
    return Response.json({ error: "Pass a 10-character ASIN." }, { status: 400 });
  }
  try {
    const existing = await getReviews(asin);
    return Response.json({ asin, reviews: existing });
  } catch (error) {
    return Response.json({ error: describeError(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: {
    asin?: string;
    productName?: string;
    rawText?: string;
    starFilter?: string;
    reviewCount?: number;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  const asin = body.asin?.toUpperCase().trim() ?? "";
  const rawText = (body.rawText ?? "").trim();

  if (!/^[A-Z0-9]{10}$/.test(asin)) {
    return Response.json(
      { error: "Pass the 10-character ASIN — the bit after /dp/ in the URL." },
      { status: 400 },
    );
  }
  if (rawText.length < 200) {
    return Response.json(
      {
        error:
          "That is too little text to read anything into. Paste at least a few reviews.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await guardedTriage((client) =>
      client.messages.create({
        model: TRIAGE_MODEL,
        max_tokens: 4000,
        output_config: {
          effort: "medium",
          format: zodOutputFormat(ReviewAnalysisSchema),
        },
        system: [
          {
            type: "text",
            text: REVIEW_SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          {
            role: "user",
            content: buildReviewPrompt({
              productName: body.productName ?? asin,
              starFilter: body.starFilter ?? "",
              rawText,
            }),
          },
        ],
      }),
    );

    const answer = result.content.find((b) => b.type === "text")?.text ?? "{}";
    const parsed = ReviewAnalysisSchema.safeParse(JSON.parse(answer));

    if (!parsed.success) {
      // Say which field and why. The old message named neither, so a failure
      // here was indistinguishable from the model being down, and the answer
      // that had just been paid for was thrown away unread.
      const problems = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      console.error("[reviews] schema mismatch", problems, answer.slice(0, 400));
      return Response.json(
        {
          error: `The review analysis came back in the wrong shape — ${problems}. This is a bug in the tool rather than anything you did.`,
          got: answer.slice(0, 400),
        },
        { status: 502 },
      );
    }

    const analysis = parsed.data;
    const cost = priceTriage(result.usage);

    // Never lose a paid result to a storage problem. The analysis is the thing
    // Oscar just paid for; the table not existing yet is a setup issue, and
    // throwing away the answer to report it would be the wrong trade.
    let savedWarning: string | null = null;
    try {
      await saveReviews({
        asin,
        raw_text: rawText,
        review_count: body.reviewCount ?? 0,
        star_filter: body.starFilter ?? "",
        complaints: analysis.complaints.join("\n"),
        wished_for: analysis.wishedFor.join("\n"),
        fixable: analysis.fixable.join("\n"),
        not_fixable: analysis.notFixable.join("\n"),
        opportunity_score: analysis.opportunityScore,
        summary: analysis.summary,
      });
    } catch (error) {
      savedWarning = `The analysis worked but could not be saved: ${
        error instanceof Error ? error.message : "unknown error"
      } — most likely supabase/004_reviews.sql has not been run yet. Copy the results below before leaving this page.`;
    }

    return Response.json({ asin, analysis, cost, savedWarning });
  } catch (error) {
    console.error("[reviews]", error);
    return Response.json({ error: describeError(error) }, { status: 502 });
  }
}
