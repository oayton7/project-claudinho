import { KEEPA_DOMAIN, MissingKeepaKey } from "@/lib/keepa";

/**
 * GET /api/keepa/category-probe
 *
 * Finds Amazon UK's real Keepa category ids.
 *
 * The ladder probe proved every sweep filter works except rootCategory, which
 * matches nothing because the ids were written from memory. Guessing again
 * would be the same mistake twice, so this derives them from data instead.
 *
 * Two independent routes to the answer, because the useful one is whichever
 * actually returns something:
 *
 *   A. Pull real products off a bare search and read the categories Keepa has
 *      already assigned them. Slower and scattershot, but the ids it returns
 *      exist by definition, which is the property that matters here.
 *   B. Ask Keepa's category search for the names the sweep wants. Direct, but
 *      it depends on an endpoint shape that has not been verified.
 */
export const maxDuration = 120;

const WANTED = [
  "Home & Kitchen",
  "Garden & Outdoors",
  "Sports & Outdoors",
  "Toys & Games",
  "Pet Supplies",
  "Office Products",
  "Baby",
  "Beauty",
  "Health & Personal Care",
];

export async function GET() {
  const key = process.env.KEEPA_API_KEY?.trim();
  if (!key) {
    return Response.json({ error: new MissingKeepaKey().message }, { status: 503 });
  }

  const domain = KEEPA_DOMAIN.UK;
  const out: Record<string, unknown> = {};
  let tokensLeft: number | null = null;

  // ── A. Read the categories off real products ────────────────────────────
  try {
    const search = await fetch(
      `https://api.keepa.com/query?key=${key}&domain=${domain}&selection=${encodeURIComponent(
        JSON.stringify({
          productType: [0, 1],
          sort: [["current_SALES", "asc"]],
          perPage: 50,
          page: 0,
          current_NEW_gte: 800,
          current_NEW_lte: 6000,
        }),
      )}`,
      { signal: AbortSignal.timeout(30_000) },
    );
    const searchBody = (await search.json()) as Record<string, unknown>;
    const asins = Array.isArray(searchBody.asinList)
      ? (searchBody.asinList as string[]).slice(0, 25)
      : [];
    tokensLeft = (searchBody.tokensLeft as number) ?? tokensLeft;

    if (asins.length > 0) {
      const detail = await fetch(
        `https://api.keepa.com/product?key=${key}&domain=${domain}&asin=${asins.join(",")}&stats=0&history=0`,
        { signal: AbortSignal.timeout(60_000) },
      );
      const detailBody = (await detail.json()) as Record<string, unknown>;
      tokensLeft = (detailBody.tokensLeft as number) ?? tokensLeft;

      const products = (detailBody.products ?? []) as Record<string, unknown>[];

      // Count how often each root category shows up, and keep the name Keepa
      // gives it so the ids are recognisable rather than just numbers.
      const tally = new Map<string, { id: number; name: string; seen: number }>();
      for (const product of products) {
        const root = product.rootCategory;
        if (typeof root !== "number") continue;
        const tree = (product.categoryTree ?? []) as { catId: number; name: string }[];
        const name =
          Array.isArray(tree) && tree.length > 0
            ? (tree.find((t) => t.catId === root)?.name ?? tree[0]?.name ?? "unknown")
            : "unknown";
        const existing = tally.get(String(root));
        if (existing) existing.seen += 1;
        else tally.set(String(root), { id: root, name, seen: 1 });
      }

      out.fromRealProducts = [...tally.values()].sort((a, b) => b.seen - a.seen);
      out.productsInspected = products.length;
    } else {
      out.fromRealProducts = "the search returned no ASINs to inspect";
    }
  } catch (error) {
    out.fromRealProducts = `failed: ${error instanceof Error ? error.message : "unknown"}`;
  }

  // ── B. Ask Keepa's category search directly ─────────────────────────────
  const byName: Record<string, unknown> = {};
  for (const term of WANTED) {
    if (tokensLeft !== null && tokensLeft < 80) {
      byName[term] = "skipped to preserve tokens";
      continue;
    }
    try {
      const response = await fetch(
        `https://api.keepa.com/search?key=${key}&domain=${domain}&type=category&term=${encodeURIComponent(term)}`,
        { signal: AbortSignal.timeout(20_000) },
      );
      const body = (await response.json()) as Record<string, unknown>;
      tokensLeft = (body.tokensLeft as number) ?? tokensLeft;

      const categories = body.categories as Record<string, unknown> | undefined;
      if (categories && typeof categories === "object") {
        // Keyed by id, so the keys are the ids. Only the top few matter.
        byName[term] = Object.entries(categories)
          .slice(0, 4)
          .map(([id, value]) => ({
            id: Number(id),
            name: (value as Record<string, unknown>)?.name ?? null,
          }));
      } else {
        byName[term] = {
          httpStatus: response.status,
          topLevelKeys: Object.keys(body),
          keepaError: body.error ?? null,
        };
      }
    } catch (error) {
      byName[term] = `failed: ${error instanceof Error ? error.message : "unknown"}`;
    }
  }
  out.fromCategorySearch = byName;
  out.tokensLeft = tokensLeft;
  out.note =
    "Use whichever section actually returned ids. Anything under fromRealProducts is guaranteed to exist, because a real product is sitting in it.";

  return Response.json(out);
}
