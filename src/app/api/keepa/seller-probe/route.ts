import { KEEPA_DOMAIN, MissingKeepaKey } from "@/lib/keepa";

/**
 * GET /api/keepa/seller-probe?asin=…
 *
 * Can the tool see how much a seller shifts in a month, not just a product?
 *
 * Useful if so: a brand selling 2,400 units a month across eight listings is a
 * different opponent from one selling 200 across one, and the rubric currently
 * cannot tell them apart. It reads a product and infers the seller from it.
 *
 * Three things have to hold, and each is checked here rather than assumed:
 * that a seller id can be got from a product, that Keepa's seller endpoint
 * returns their other listings, and that monthlySold is available on those.
 * Any one missing and the answer is no.
 */
export const maxDuration = 120;

export async function GET(request: Request) {
  const key = process.env.KEEPA_API_KEY?.trim();
  if (!key) {
    return Response.json({ error: new MissingKeepaKey().message }, { status: 503 });
  }

  const asin =
    new URL(request.url).searchParams.get("asin")?.toUpperCase().trim() ||
    "B0BJ33T5DB";

  const out: Record<string, unknown> = { asin };

  // 1. Does the product carry a seller id at all?
  const productRes = await fetch(
    `https://api.keepa.com/product?key=${key}&domain=${KEEPA_DOMAIN.UK}&asin=${asin}&stats=90&history=0&offers=20`,
    { signal: AbortSignal.timeout(30_000) },
  );
  const productBody = (await productRes.json()) as Record<string, unknown>;
  const product = ((productBody.products ?? []) as Record<string, unknown>[])[0];

  if (!product) {
    return Response.json({ ...out, error: "Keepa has no record of that ASIN." });
  }

  const offers = (product.offers ?? []) as Record<string, unknown>[];
  const sellerIds = [
    ...new Set(
      offers
        .map((o) => o.sellerId)
        .filter((s): s is string => typeof s === "string" && s.length > 0),
    ),
  ];

  out.productMonthlySold = product.monthlySold ?? null;
  out.brand = product.brand ?? null;
  out.brandStoreName = product.brandStoreName ?? null;
  out.offersReturned = offers.length;
  out.sellerIdsFound = sellerIds.slice(0, 5);
  out.tokensAfterProduct = productBody.tokensLeft ?? null;

  if (sellerIds.length === 0) {
    return Response.json({
      ...out,
      verdict:
        "No seller id came back, so seller-level tracking cannot start from a product record. Offers may need a different request parameter.",
    });
  }

  // 2. Does the seller endpoint return their storefront?
  const sellerRes = await fetch(
    `https://api.keepa.com/seller?key=${key}&domain=${KEEPA_DOMAIN.UK}&seller=${sellerIds[0]}&storefront=1`,
    { signal: AbortSignal.timeout(30_000) },
  );
  const sellerBody = (await sellerRes.json()) as Record<string, unknown>;
  const sellers = (sellerBody.sellers ?? {}) as Record<string, Record<string, unknown>>;
  const seller = Object.values(sellers)[0];

  out.sellerHttpStatus = sellerRes.status;
  out.sellerKeys = seller ? Object.keys(seller) : [];
  out.sellerName = seller?.sellerName ?? null;
  out.totalStorefrontAsins = seller?.totalStorefrontAsins ?? null;
  out.storefrontSample = Array.isArray(seller?.asinList)
    ? (seller.asinList as string[]).slice(0, 5)
    : null;
  out.storefrontCount = Array.isArray(seller?.asinList)
    ? (seller.asinList as string[]).length
    : 0;
  out.tokensAfterSeller = sellerBody.tokensLeft ?? null;
  out.keepaError = sellerBody.error ?? null;

  const canList = (out.storefrontCount as number) > 0;

  return Response.json({
    ...out,
    verdict: canList
      ? `Yes. The seller's listings come back (${out.storefrontCount} sampled of ${out.totalStorefrontAsins ?? "unknown"} total), so monthlySold can be summed across them. The cost is one token per product, which is the thing to weigh.`
      : "The seller record came back but without a list of their products, so monthly sales cannot be summed across a storefront. Only the single product's own figure is available.",
    costNote:
      "A seller with 200 listings costs roughly 200 tokens to total, against a bucket of 1,100 that refills at 20 a minute. Worth doing for a shortlisted product, not for everything a sweep touches.",
  });
}
