import {
  KEEPA_DOMAIN,
  MissingKeepaKey,
  KeepaTokensExhausted,
  describeShape,
  fetchProductRaw,
  type KeepaDomain,
} from "@/lib/keepa";

/**
 * GET /api/keepa/probe?asin=B0XXXXXXX&domain=uk
 *
 * Verifies what Keepa actually returns before anything is built on top of it.
 *
 * Their docs block automated access, so the csv index constants in keepa.ts
 * come from memory. Wrong indices would not throw — they would quietly return
 * a plausible number that happens to be the used-price history rather than the
 * sales rank, and that number would end up in a decision about £1,400 of
 * stock. This route exists so the parsing can be written against fact.
 *
 * Returns shape and ranges, not the full history, so the response stays
 * readable and costs one token.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const asin = url.searchParams.get("asin");
  const domainParam = (url.searchParams.get("domain") ?? "uk").toLowerCase();

  if (!asin || !/^[A-Z0-9]{10}$/i.test(asin)) {
    return Response.json(
      {
        error:
          "Pass a 10-character ASIN, e.g. /api/keepa/probe?asin=B08N5WRWNW&domain=uk. The ASIN is in the Amazon URL after /dp/.",
      },
      { status: 400 },
    );
  }

  const domain: KeepaDomain =
    domainParam === "us" ? KEEPA_DOMAIN.US : KEEPA_DOMAIN.UK;

  try {
    const { raw, tokensLeft } = await fetchProductRaw(asin.toUpperCase(), domain, {
      history: true,
      stats: 365,
    });

    return Response.json({
      askedFor: { asin: asin.toUpperCase(), domain: domainParam },
      tokensLeft,
      shape: describeShape(raw),
      note: "Check each csvSeries entry against what it claims to be. Sales rank should be a large integer in the thousands or above; prices are integers in cents so 1499 means £14.99; -1 means no data for that point.",
    });
  } catch (error) {
    if (error instanceof MissingKeepaKey) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof KeepaTokensExhausted) {
      return Response.json({ error: error.message }, { status: 429 });
    }
    console.error("[keepa/probe]", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Keepa request failed" },
      { status: 502 },
    );
  }
}
