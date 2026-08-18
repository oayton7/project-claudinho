import {
  KEEPA_DOMAIN,
  KeepaTokensExhausted,
  MissingKeepaKey,
  fetchProductRaw,
  findProducts,
  type FinderFilters,
  type KeepaDomain,
} from "@/lib/keepa";

/**
 * POST /api/keepa/scout
 *
 * Searches Keepa for products matching the rubric's shape, then fetches the
 * detail for each hit so the results are judgeable rather than a list of bare
 * ASINs.
 *
 * A search costs materially more than a lookup, so results are capped and the
 * detail fetch is batched into a single request rather than one per ASIN.
 */
export const maxDuration = 120;

/** Keepa charges by result volume, so this ceiling protects the token bucket. */
const MAX_RESULTS = 25;

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  const num = (key: string): number | undefined => {
    const value = Number(body[key]);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  };

  const filters: FinderFilters = {
    categoryId: num("categoryId"),
    minRank: num("minRank"),
    maxRank: num("maxRank"),
    minPrice: num("minPrice"),
    maxPrice: num("maxPrice"),
    maxReviewCount: num("maxReviewCount"),
    minSellerCount: num("minSellerCount"),
    maxSellerCount: num("maxSellerCount"),
    limit: Math.min(num("limit") ?? MAX_RESULTS, MAX_RESULTS),
  };

  const domain: KeepaDomain =
    String(body.domain).toLowerCase() === "us" ? KEEPA_DOMAIN.US : KEEPA_DOMAIN.UK;

  try {
    const { asins, tokensLeft } = await findProducts(filters, domain);

    if (asins.length === 0) {
      return Response.json({
        candidates: [],
        tokensLeft,
        note: "No matches. Widen the rank or price range, or drop the review ceiling — the filters are ANDed together, so a narrow combination returns nothing rather than erroring.",
      });
    }

    // One request for up to 25 products rather than 25 requests. Keepa still
    // charges per product, but the round trips matter for a serverless
    // function with a time limit.
    const { raw } = await fetchProductRaw(asins.slice(0, MAX_RESULTS).join(","), domain, {
      history: false,
      stats: 90,
    });

    const products = ((raw as Record<string, unknown>).products ??
      []) as Record<string, unknown>[];

    const candidates = products.map((product) => {
      const stats = (product.stats ?? {}) as Record<string, unknown>;
      const current = stats.current as number[] | undefined;
      const pence = (v: unknown) =>
        typeof v === "number" && v >= 0 ? v / 100 : null;

      return {
        asin: product.asin,
        title: product.title ?? null,
        brand: product.brand ?? null,
        price: pence(stats.buyBoxPrice) ?? pence(current?.[1]),
        salesRank: typeof current?.[3] === "number" && current[3] > 0 ? current[3] : null,
        reviewCount:
          typeof current?.[17] === "number" && current[17] > 0 ? current[17] : null,
        rating:
          typeof current?.[16] === "number" && current[16] > 0
            ? current[16] / 10
            : null,
        sellers: stats.totalOfferCount ?? null,
        // The velocity proxy. Roughly one rank drop per sale.
        rankDrops90: stats.salesRankDrops90 ?? null,
        outOfStock90: stats.outOfStockPercentage90 ?? null,
        packageWeightG: product.packageWeight ?? null,
      };
    });

    return Response.json({ candidates, tokensLeft, found: asins.length });
  } catch (error) {
    if (error instanceof MissingKeepaKey) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof KeepaTokensExhausted) {
      return Response.json({ error: error.message }, { status: 429 });
    }
    console.error("[keepa/scout]", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Keepa search failed" },
      { status: 502 },
    );
  }
}
