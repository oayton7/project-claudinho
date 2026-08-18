import { KEEPA_DOMAIN, MissingKeepaKey } from "@/lib/keepa";

/**
 * GET /api/keepa/finder-probe
 *
 * A ladder of Product Finder searches, one filter at a time, reporting how
 * many products each one matches.
 *
 * The first probe already settled the big question: asinList is the right key
 * and a bare search returns 50 ASINs out of 333 million matches. So the
 * parsing was fine and a filter is doing the damage. Which one is a question
 * with a definite answer, and asking Keepa six times is faster and more honest
 * than reasoning about it.
 *
 * Each rung adds exactly one condition to the bare search, so a rung that
 * drops to zero names the culprit outright. Roughly 11 tokens per rung.
 */
export const maxDuration = 120;

type Rung = { label: string; selection: Record<string, unknown> };

const BARE: Record<string, unknown> = {
  productType: [0, 1],
  sort: [["current_SALES", "asc"]],
  perPage: 50,
  page: 0,
};

/** Home & Kitchen, as the sweep believes it to be numbered. */
const CATEGORY_UNDER_TEST = 11052591;

const RUNGS: Rung[] = [
  { label: "bare search, no filters", selection: {} },
  {
    label: "price £8-60 (current_NEW)",
    selection: { current_NEW_gte: 800, current_NEW_lte: 6000 },
  },
  {
    label: "sales rank under 200k (current_SALES)",
    selection: { current_SALES_lte: 200000 },
  },
  {
    label: `category ${CATEGORY_UNDER_TEST} (rootCategory)`,
    selection: { rootCategory: CATEGORY_UNDER_TEST },
  },
  {
    label: "reviews over 200 (current_COUNT_REVIEWS)",
    selection: { current_COUNT_REVIEWS_gte: 200 },
  },
  {
    label: "rating 4.3 or under (current_RATING)",
    selection: { current_RATING_lte: 43 },
  },
  {
    label: "everything the sweep now sends",
    selection: {
      current_NEW_gte: 800,
      current_NEW_lte: 6000,
      current_SALES_lte: 200000,
      rootCategory: CATEGORY_UNDER_TEST,
    },
  },
];

export async function GET() {
  const key = process.env.KEEPA_API_KEY?.trim();
  if (!key) {
    return Response.json({ error: new MissingKeepaKey().message }, { status: 503 });
  }

  const results: Record<string, unknown>[] = [];
  let tokensLeft: number | null = null;

  for (const rung of RUNGS) {
    // Stop rather than drain the bucket. A partial ladder still names the
    // culprit if the culprit came early.
    if (tokensLeft !== null && tokensLeft < 100) {
      results.push({ rung: rung.label, skipped: "stopped to preserve tokens" });
      break;
    }

    const selection = { ...BARE, ...rung.selection };
    try {
      const response = await fetch(
        `https://api.keepa.com/query?key=${key}&domain=${KEEPA_DOMAIN.UK}&selection=${encodeURIComponent(
          JSON.stringify(selection),
        )}`,
        { signal: AbortSignal.timeout(30_000) },
      );
      const body = (await response.json()) as Record<string, unknown>;
      tokensLeft = typeof body.tokensLeft === "number" ? body.tokensLeft : tokensLeft;

      results.push({
        rung: rung.label,
        httpStatus: response.status,
        returned: Array.isArray(body.asinList) ? body.asinList.length : 0,
        totalMatches: body.totalResults ?? null,
        keepaError: body.error ?? null,
        tokensLeft,
      });
    } catch (error) {
      results.push({
        rung: rung.label,
        failed: error instanceof Error ? error.message : "request failed",
      });
    }
  }

  const zeroed = results.filter(
    (r) => typeof r.returned === "number" && r.returned === 0 && !r.skipped,
  );

  return Response.json({
    verdict:
      zeroed.length === 0
        ? "Every filter works on its own. If the sweep still finds nothing, it is the combination, not any single condition."
        : `These conditions match nothing on their own: ${zeroed
            .map((r) => r.rung)
            .join("; ")}. That is where the sweep is losing its results.`,
    tokensLeft,
    ladder: results,
  });
}
