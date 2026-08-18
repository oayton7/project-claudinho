import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { TRIAGE_SYSTEM_PROMPT, TriageSchema, buildTriagePrompt } from "@/lib/judge";
import {
  TRIAGE_MODEL,
  describeError,
  guardedTriage,
  priceTriage,
} from "@/lib/claude";
import { listProducts } from "@/lib/db";

/**
 * GET /api/triage/agreement
 *
 * Does the cheap tier reach the same verdicts as the expensive one?
 *
 * The honest answer to "will fewer tokens change the result" is that it will,
 * and the only useful follow-up is by how much and in which direction. Every
 * product already saved carries an Opus verdict, so running triage over the
 * same products and comparing is a real experiment rather than an assurance.
 *
 * What matters is not the headline agreement rate but the shape of the
 * disagreements. Triage saying TEST where Opus said KILL costs eleven pence
 * and gets caught. Triage saying KILL where Opus said TEST is a product
 * silently lost, and that is the number to watch.
 *
 * One caveat the result must be read with: saved products carry price, weight
 * and category but not ratings, review counts or listing weaknesses. Triage is
 * therefore judging on materially less than Opus had, so the agreement figure
 * is a floor, not an estimate.
 */
export const maxDuration = 300;

const RANK = { KILL: 0, PARK: 1, TEST: 2 } as const;
type Verdict = keyof typeof RANK;

export async function GET() {
  try {
    const products = await listProducts();
    const withVerdicts = products.filter((p) => p.judgements?.[0]?.verdict);

    if (withVerdicts.length === 0) {
      return Response.json({
        error:
          "No saved products carry a judgement yet, so there is nothing to compare against.",
      });
    }

    const rows: Record<string, unknown>[] = [];
    let totalPence = 0;
    let agreed = 0;
    let tooGenerous = 0;
    let tooHarsh = 0;

    for (const product of withVerdicts) {
      const opusVerdict = product.judgements![0].verdict as Verdict;

      try {
        const result = await guardedTriage((client) =>
          client.messages.create({
            model: TRIAGE_MODEL,
            max_tokens: 2000,
            output_config: {
              effort: "low",
              format: zodOutputFormat(TriageSchema),
            },
            system: [
              {
                type: "text",
                text: TRIAGE_SYSTEM_PROMPT,
                cache_control: { type: "ephemeral" },
              },
            ],
            messages: [
              {
                role: "user",
                content: buildTriagePrompt({
                  title: product.name,
                  brand: null,
                  category: product.category,
                  price: Number(product.sell_price) || null,
                  rating: null,
                  reviewCount: null,
                  monthlySold: null,
                  packageWeightG: product.weight_grams || null,
                  maxLandedCost: null,
                  listingWeaknesses: [],
                  usGrowing: null,
                }),
              },
            ],
          }),
        );

        const parsed = TriageSchema.safeParse(
          JSON.parse(result.content.find((b) => b.type === "text")?.text ?? "{}"),
        );
        const cost = priceTriage(result.usage);
        totalPence += cost.costPence;

        if (!parsed.success) {
          rows.push({ product: product.name, error: "output failed the schema" });
          continue;
        }

        const triageVerdict = parsed.data.verdict;
        const gap = RANK[triageVerdict] - RANK[opusVerdict];

        if (gap === 0) agreed += 1;
        else if (gap > 0) tooGenerous += 1;
        else tooHarsh += 1;

        rows.push({
          product: product.name,
          opus: opusVerdict,
          triage: triageVerdict,
          match: gap === 0 ? "same" : gap > 0 ? "triage kinder" : "TRIAGE HARSHER",
          triageReason: parsed.data.reason,
          pence: cost.costPence,
        });
      } catch (error) {
        rows.push({ product: product.name, error: describeError(error) });
      }
    }

    const scored = agreed + tooGenerous + tooHarsh;

    return Response.json({
      verdict:
        tooHarsh === 0
          ? `Triage never killed something Opus wanted to keep. That is the failure that matters, and it did not happen across ${scored} products.`
          : `Triage was harsher than Opus on ${tooHarsh} of ${scored} products. Those are products you would have lost. Read them below before trusting the cheap tier.`,
      agreement: scored > 0 ? `${Math.round((agreed / scored) * 100)}%` : "n/a",
      sameVerdict: agreed,
      triageKinder: tooGenerous,
      triageHarsher: tooHarsh,
      costPence: Math.round(totalPence * 100) / 100,
      costPerProductPence:
        scored > 0 ? Math.round((totalPence / scored) * 100) / 100 : 0,
      caveat:
        "Saved products carry price, weight and category but no ratings, review counts or listing weaknesses. Triage judged on less than Opus had, so treat the agreement figure as a floor.",
      rows,
    });
  } catch (error) {
    return Response.json({ error: describeError(error) }, { status: 500 });
  }
}
