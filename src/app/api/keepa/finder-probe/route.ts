import { KEEPA_DOMAIN, MissingKeepaKey } from "@/lib/keepa";

/**
 * GET /api/keepa/finder-probe
 *
 * One deliberately unfiltered Product Finder search, reported raw.
 *
 * The sweep spends tokens and comes back with nothing, which has two opposite
 * causes: the filters match no products, or the results arrive under a key
 * this code does not read. Guessing between them is how the last few hours
 * went, so this asks Keepa directly and prints what comes back.
 *
 * Sending almost no filters is the point. If a bare search returns products,
 * the filters are wrong. If a bare search also returns nothing, the request
 * shape or the parsing is wrong. One call, and the two cases separate.
 *
 * Costs a single search rather than the sweep's ten.
 */
export async function GET() {
  const key = process.env.KEEPA_API_KEY?.trim();
  if (!key) {
    return Response.json({ error: new MissingKeepaKey().message }, { status: 503 });
  }

  // Only the mandatory bits: physical products, sorted by sales rank, one
  // page at the size Keepa insists on.
  const selection = {
    productType: [0, 1],
    sort: [["current_SALES", "asc"]],
    perPage: 50,
    page: 0,
  };

  const response = await fetch(
    `https://api.keepa.com/query?key=${key}&domain=${KEEPA_DOMAIN.UK}&selection=${encodeURIComponent(
      JSON.stringify(selection),
    )}`,
    { signal: AbortSignal.timeout(30_000) },
  );

  const text = await response.text();

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Falls through: the raw text is reported below, which is the useful bit
    // when the body is not JSON at all.
  }

  if (!parsed) {
    return Response.json({
      status: response.status,
      note: "Keepa did not return JSON. The raw body is below.",
      rawBody: text.slice(0, 2000),
    });
  }

  // Describe every top-level key by type and size rather than dumping the
  // whole payload. The question is which key holds the results, not what is
  // in them.
  const shape = Object.fromEntries(
    Object.entries(parsed).map(([k, v]) => [
      k,
      Array.isArray(v)
        ? `array of ${v.length}${v.length > 0 ? `, first item: ${JSON.stringify(v[0]).slice(0, 120)}` : ""}`
        : v === null
          ? "null"
          : typeof v === "object"
            ? `object with keys: ${Object.keys(v as object).join(", ")}`
            : `${typeof v}: ${JSON.stringify(v)}`,
    ]),
  );

  return Response.json({
    status: response.status,
    sentSelection: selection,
    // The whole point: which of these holds the results?
    topLevelKeys: Object.keys(parsed),
    shape,
    asinListPresent: Array.isArray(parsed.asinList),
    asinListLength: Array.isArray(parsed.asinList) ? parsed.asinList.length : null,
    tokensLeft: parsed.tokensLeft ?? null,
    tokensConsumed: parsed.tokensConsumed ?? null,
    keepaError: parsed.error ?? null,
  });
}
