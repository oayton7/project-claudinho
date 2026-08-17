import {
  KEEPA_DOMAIN,
  KeepaTokensExhausted,
  MissingKeepaKey,
  fetchProductRaw,
  type KeepaDomain,
} from "@/lib/keepa";

/**
 * GET /api/keepa/product?asin=B0XXXXXXXX&domain=uk
 *
 * Pulls the handful of fields the margin engine can fill in for you: the FBA
 * fulfilment fee, the packed dimensions that decide the size band, and the
 * current selling price.
 *
 * Everything returned is reported as `found` or `null` rather than defaulted.
 * A silently defaulted fee looks identical to a real one on screen and ends up
 * in a decision about stock, which is the failure this whole phase has been
 * built to avoid.
 */

/** Keepa returns money as integer pence. -1 means no data. */
function pence(value: unknown): number | null {
  return typeof value === "number" && value >= 0 ? value : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const asin = url.searchParams.get("asin")?.toUpperCase().trim() ?? "";
  const domainParam = (url.searchParams.get("domain") ?? "uk").toLowerCase();

  if (!/^[A-Z0-9]{10}$/.test(asin)) {
    return Response.json(
      { error: "Pass a 10-character ASIN — the bit after /dp/ in the Amazon URL." },
      { status: 400 },
    );
  }

  const domain: KeepaDomain =
    domainParam === "us" ? KEEPA_DOMAIN.US : KEEPA_DOMAIN.UK;

  try {
    const { raw, tokensLeft } = await fetchProductRaw(asin, domain, {
      history: false,
      stats: 90,
    });

    const root = raw as Record<string, unknown>;
    const product = (root.products as Record<string, unknown>[] | undefined)?.[0];

    if (!product) {
      return Response.json(
        { error: `Keepa has no record of ${asin} on Amazon ${domainParam.toUpperCase()}.` },
        { status: 404 },
      );
    }

    const fbaFees = product.fbaFees as Record<string, unknown> | undefined;
    const stats = (product.stats ?? {}) as Record<string, unknown>;
    const current = stats.current as number[] | undefined;

    // Buy box is the honest "what does this actually sell for" figure. Fall
    // back to the new-price series if it is not populated.
    const buyBox = pence(stats.buyBoxPrice) ?? pence(current?.[1]);

    return Response.json({
      asin,
      domain: domainParam,
      title: product.title ?? null,
      brand: product.brand ?? null,
      tokensLeft,

      fillable: {
        sellPrice: buyBox === null ? null : buyBox / 100,
        fbaFee: pence(fbaFees?.pickAndPackFee) === null
          ? null
          : (pence(fbaFees?.pickAndPackFee) as number) / 100,
      },

      // Dimensions decide the FBA size band, not weight. This is the number
      // people budget wrong, so it is shown even though the engine does not
      // consume it directly.
      dimensions: {
        packageLengthMm: product.packageLength ?? null,
        packageWidthMm: product.packageWidth ?? null,
        packageHeightMm: product.packageHeight ?? null,
        packageWeightG: product.packageWeight ?? null,
        itemWeightG: product.itemWeight ?? null,
      },

      // Returned unparsed so a missing or renamed field is visible rather than
      // quietly becoming a plausible zero.
      rawFbaFees: fbaFees ?? null,

      notFound: [
        buyBox === null ? "sellPrice — no buy box or new price on record" : null,
        pence(fbaFees?.pickAndPackFee) === null
          ? "fbaFee — Keepa has no fulfilment fee for this ASIN"
          : null,
        "referralFeePct — not in Keepa. Look it up per category in the FBA Revenue Calculator",
      ].filter(Boolean),
    });
  } catch (error) {
    if (error instanceof MissingKeepaKey) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof KeepaTokensExhausted) {
      return Response.json({ error: error.message }, { status: 429 });
    }
    console.error("[keepa/product]", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Keepa request failed" },
      { status: 502 },
    );
  }
}
