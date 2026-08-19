import { KEEPA_DOMAIN, MissingKeepaKey } from "@/lib/keepa";

/**
 * GET /api/keepa/category-filter-probe
 *
 * Which selection key actually filters by category?
 *
 * A sweep of Kitchen Tools & Gadgets — a real leaf with 1.85 million products
 * — returned nothing while using `rootCategory`. The suspicion is that
 * rootCategory matches only a product's root node, so a leaf id can never
 * match anything, which would also explain the original zero on 11052591:
 * that is a parent, and its products live in children.
 *
 * Each rung tries one key against a control, and the only meaningful test is
 * whether totalMatches moves. Keepa silently ignores keys it does not know,
 * so "returned products" proves nothing on its own.
 */
export const maxDuration = 120;

const LEAF = 3147491; // Kitchen Tools & Gadgets, 1.85m products
const PARENT = 11052681; // Home & Kitchen, 46.7m products

const BARE = { productType: [0, 1], perPage: 50, page: 0 };

const RUNGS: { label: string; selection: Record<string, unknown> }[] = [
  { label: "control, no category", selection: {} },
  { label: `rootCategory: ${LEAF} (leaf)`, selection: { rootCategory: LEAF } },
  { label: `rootCategory: ${PARENT} (parent)`, selection: { rootCategory: PARENT } },
  { label: `categories_include: [${LEAF}]`, selection: { categories_include: [LEAF] } },
  { label: `categories_include: [${PARENT}]`, selection: { categories_include: [PARENT] } },
  { label: `categories: [${LEAF}]`, selection: { categories: [LEAF] } },
  { label: `productGroup / salesRankReference: ${LEAF}`, selection: { salesRankReference: LEAF } },
];

export async function GET() {
  const key = process.env.KEEPA_API_KEY?.trim();
  if (!key) {
    return Response.json({ error: new MissingKeepaKey().message }, { status: 503 });
  }

  const results: Record<string, unknown>[] = [];
  let tokensLeft: number | null = null;
  let control: number | null = null;

  for (const rung of RUNGS) {
    if (tokensLeft !== null && tokensLeft < 100) {
      results.push({ rung: rung.label, skipped: "preserving tokens" });
      break;
    }
    try {
      const response = await fetch(
        `https://api.keepa.com/query?key=${key}&domain=${KEEPA_DOMAIN.UK}&selection=${encodeURIComponent(
          JSON.stringify({ ...BARE, ...rung.selection }),
        )}`,
        { signal: AbortSignal.timeout(30_000) },
      );
      const body = (await response.json()) as Record<string, unknown>;
      tokensLeft = typeof body.tokensLeft === "number" ? body.tokensLeft : tokensLeft;
      const matches = typeof body.totalResults === "number" ? body.totalResults : null;
      if (control === null) control = matches;

      results.push({
        rung: rung.label,
        matches,
        // The only test that means anything: did this key change the result?
        filtered:
          control !== null && matches !== null
            ? matches < control * 0.95
              ? "YES — this key works"
              : "no — silently ignored"
            : "unknown",
        returned: Array.isArray(body.asinList) ? body.asinList.length : 0,
        keepaError: body.error ?? null,
      });
    } catch (error) {
      results.push({
        rung: rung.label,
        failed: error instanceof Error ? error.message : "request failed",
      });
    }
  }

  const working = results.filter((r) => r.filtered === "YES — this key works");

  return Response.json({
    verdict:
      working.length > 0
        ? `These filter by category: ${working.map((r) => String(r.rung).split(":")[0]).join(", ")}. Use the one that works on a leaf.`
        : "No category key filtered anything. Every one was silently ignored, which means the sweep has never actually been filtering by category.",
    control,
    tokensLeft,
    ladder: results,
  });
}
