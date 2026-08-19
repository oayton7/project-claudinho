import { KEEPA_DOMAIN, MissingKeepaKey } from "@/lib/keepa";

/**
 * GET /api/keepa/trend-probe
 *
 * Finds out which of Keepa's rate-of-change fields actually exist, before any
 * code is built on top of one.
 *
 * The plan is to flip the funnel: instead of searching UK categories and
 * hoping, find what has grown hard in the US over the last year and work back
 * to the UK gap. That needs a Product Finder field expressing change in sales
 * rank over 365 days, and this session has already lost three rounds to Keepa
 * fields written from memory — perPage, the result key, the category ids. So
 * this asks rather than assumes.
 *
 * A rung that returns products means the field name is real and applied. A
 * rung that returns zero means either the field is wrong or the threshold is,
 * and the bare search alongside it tells you which.
 *
 * Sales rank is inverted: smaller is better. So growth is a NEGATIVE delta,
 * and asking for "grown by 50%" means asking for a drop of 50% or more. Half
 * the rungs below get that backwards on purpose, to prove which direction the
 * field actually reads.
 */
export const maxDuration = 120;

const BARE: Record<string, unknown> = {
  productType: [0, 1],
  perPage: 50,
  page: 0,
};

type Rung = { label: string; selection: Record<string, unknown>; domain: number };

/** Amazon US. The whole point is to look where the trend starts. */
const US = KEEPA_DOMAIN.US;

const RUNGS: Rung[] = [
  { label: "US bare search (control)", selection: {}, domain: US },
  {
    label: "deltaPercent365_SALES_lte: -50  (rank improved by half)",
    selection: { deltaPercent365_SALES_lte: -50 },
    domain: US,
  },
  {
    label: "deltaPercent365_SALES_gte: 50  (opposite sign, in case it reads the other way)",
    selection: { deltaPercent365_SALES_gte: 50 },
    domain: US,
  },
  {
    label: "deltaPercent90_SALES_lte: -50  (same idea over 90 days)",
    selection: { deltaPercent90_SALES_lte: -50 },
    domain: US,
  },
  {
    label: "delta365_SALES_lte: -10000  (absolute rank movement, not percent)",
    selection: { delta365_SALES_lte: -10000 },
    domain: US,
  },
  {
    label: "avg365_SALES vs current: avg365_SALES_gte 50000 + current_SALES_lte 20000",
    selection: { avg365_SALES_gte: 50000, current_SALES_lte: 20000 },
    domain: US,
  },
  {
    label: "trendPercent365_SALES_lte: -50  (alternative naming)",
    selection: { trendPercent365_SALES_lte: -50 },
    domain: US,
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
    if (tokensLeft !== null && tokensLeft < 120) {
      results.push({ rung: rung.label, skipped: "stopped to preserve tokens" });
      break;
    }

    const selection = { ...BARE, ...rung.selection };
    try {
      const response = await fetch(
        `https://api.keepa.com/query?key=${key}&domain=${rung.domain}&selection=${encodeURIComponent(
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
        firstAsin: Array.isArray(body.asinList) ? body.asinList[0] : null,
        tokensLeft,
      });
    } catch (error) {
      results.push({
        rung: rung.label,
        failed: error instanceof Error ? error.message : "request failed",
      });
    }
  }

  const control = results[0];
  const working = results.filter(
    (r) =>
      r !== control &&
      typeof r.returned === "number" &&
      r.returned > 0 &&
      !r.keepaError,
  );
  const rejected = results.filter((r) => r.keepaError);

  return Response.json({
    verdict:
      working.length > 0
        ? `These express growth and Keepa accepts them: ${working
            .map((r) => String(r.rung).split(" ")[0])
            .join(", ")}. The narrowest one that still returns products is the one to build on.`
        : rejected.length > 0
          ? `Keepa rejected every growth field tried. The error text on each rung says why, and the field name is the thing to fix.`
          : `Every field was accepted but matched nothing. Either the thresholds are too aggressive or the field is being ignored — compare each rung's totalMatches against the control.`,
    controlMatches: control?.totalMatches ?? null,
    tokensLeft,
    ladder: results,
  });
}
