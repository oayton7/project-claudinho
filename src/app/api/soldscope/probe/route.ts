/**
 * GET /api/soldscope/probe?asin=B08DCYY3JL — what does it actually send back
 *
 * SoldScope's response shapes are not publicly documented, so the reader in
 * soldscope.ts was written defensively against several plausible field names.
 * Defensive guessing is not knowing, and this project has lost whole
 * afternoons to the difference — a category key that silently matched
 * nothing, a request missing a parameter so ratings came back as minus one.
 * The habit since then is to probe against a control rather than reason.
 *
 * Costs one request against the monthly quota, which is the price of
 * certainty. Behind the password like everything else, because it spends.
 */
import { bsrHistory, raw, seasonalityFrom, soldscopeAvailable } from "@/lib/soldscope";
import { describeError } from "@/lib/errors";

export const maxDuration = 60;

export async function GET(request: Request) {
  const asin = new URL(request.url).searchParams.get("asin")?.toUpperCase().trim() ?? "";
  if (!/^[A-Z0-9]{10}$/.test(asin)) {
    return Response.json({ error: "Pass a 10-character ASIN." }, { status: 400 });
  }
  if (!soldscopeAvailable()) {
    return Response.json(
      { error: "SOLDSCOPE_API_TOKEN is not set, so there is nothing to probe." },
      { status: 503 },
    );
  }

  // Describes a value's shape without dumping it: enough to write a reader
  // against, small enough to read.
  const shapeOf = (v: unknown, depth = 0): unknown => {
    if (v === null) return "null";
    if (Array.isArray(v)) {
      return {
        array: v.length,
        first: v.length && depth < 3 ? shapeOf(v[0], depth + 1) : undefined,
      };
    }
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (depth >= 3) return `object(${Object.keys(o).slice(0, 12).join(", ")})`;
      return Object.fromEntries(
        Object.entries(o).slice(0, 12).map(([k, val]) => [k, shapeOf(val, depth + 1)]),
      );
    }
    return typeof v === "string" ? `string: ${v.slice(0, 40)}` : typeof v;
  };

  if (new URL(request.url).searchParams.get("raw")) {
    try {
      const body = await raw("/common/bsr-history", { asin, marketplace: "UK", days: 365 });
      return Response.json({ asin, shape: shapeOf(body) });
    } catch (error) {
      return Response.json({ asin, error: describeError(error) }, { status: 502 });
    }
  }

  try {
    const { points, requestsLeft } = await bsrHistory(asin);
    const season = seasonalityFrom(points);
    return Response.json({
      asin,
      requestsLeft,
      pointsRead: points.length,
      firstPoints: points.slice(0, 3),
      lastPoints: points.slice(-3),
      season,
      // The reader needs at least two years' worth of monthly coverage to say
      // anything. Saying why it could not is more useful than a null.
      note:
        points.length === 0
          ? "Nothing readable came back. The reader's field names are wrong, or this product has no history on SoldScope."
          : season === null
            ? `${points.length} points read, but not enough spread across months to call a shape. The reader needs at least 24 points covering 6 or more months.`
            : "Read successfully.",
    });
  } catch (error) {
    // The reader throws with the keys it actually saw when the shape is
    // unfamiliar, which is the whole point of the probe.
    return Response.json({ asin, error: describeError(error) }, { status: 502 });
  }
}
