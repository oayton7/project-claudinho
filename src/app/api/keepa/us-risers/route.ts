import {
  KEEPA_DOMAIN,
  KeepaTokensExhausted,
  MissingKeepaKey,
  fetchProductRaw,
  findUsRisers,
} from "@/lib/keepa";
import { describeError } from "@/lib/claude";

/**
 * POST /api/keepa/us-risers
 *
 * Starts where trends start. Finds products whose Amazon US sales rank has
 * climbed hard over a year, then asks whether Amazon UK has noticed.
 *
 * The mechanism is a ratio, not a delta field: Keepa has no 365-day delta —
 * deltaPercent365_SALES, delta365_SALES and trendPercent365_SALES are all
 * silently ignored, which a probe on 18 Aug 2026 established by watching the
 * match count fail to move. avg365_SALES and current_SALES are real, and an
 * average rank 1.5x worse than today's is a product that has grown by half.
 *
 * ## The split, which is the point
 *
 * A product growing in the US may not be on Amazon UK at all, and the two
 * cases are different bets rather than degrees of the same one:
 *
 *   ALREADY HERE — there is a UK listing, so it has a UK price, rating and
 *   review count. It goes through the normal pipeline, with US growth as one
 *   more signal. This is the safer bet: you are competing on execution against
 *   someone whose demand is already proven twice.
 *
 *   NOT HERE YET — no UK listing. There is nothing to score, because every
 *   metric the rubric uses is a fact about a UK listing that does not exist.
 *   This is a first-mover bet, and it is a different kind of risk: no UK
 *   demand evidence at all, only the inference that what sells there sells
 *   here. Worth seeing, never worth scoring as if it were the same thing.
 *
 * Blurring those two would be the flattering error — a first-mover gamble
 * dressed up with numbers borrowed from another country.
 */
export const maxDuration = 300;

/**
 * Above this, a growth ratio is describing a launch rather than a trend.
 *
 * Ten times over a year is already exceptional. The first live run produced
 * ratios of 1,192,595 and 497,541 — products that were effectively unranked a
 * year ago and are now near the top, which is a new listing finding its feet,
 * not a category shifting underneath it.
 */
const MAX_PLAUSIBLE_GROWTH = 25;

export async function POST(request: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // No body means defaults, which is a reasonable way to ask.
  }

  const num = (key: string, fallback: number) => {
    const value = Number(body[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };

  const minGrowth = num("minGrowth", 1.5);
  const limit = Math.min(num("limit", 20), 40);

  try {
    const risers = await findUsRisers({
      minGrowth,
      maxCurrentRank: num("maxCurrentRank", 20000),
      minCurrentRank: num("minCurrentRank", 500),
      maxAvg365Rank: num("maxAvg365Rank", 200000),
      minPrice: num("minPrice", 10),
      maxPrice: num("maxPrice", 60),
      limit,
    });

    if (risers.asins.length === 0) {
      return Response.json({
        note: `Nothing in the US has an average yearly rank ${minGrowth}x worse than its rank today, within that price band. Lower the growth multiple or widen the price range.`,
        criteria: risers,
      });
    }

    // One batched call per domain. The US call says what it is doing there;
    // the UK call answers the only question that matters — is it here.
    const [us, uk] = await Promise.all([
      fetchProductRaw(risers.asins.join(","), KEEPA_DOMAIN.US, {
        history: false,
        stats: 365,
      }),
      fetchProductRaw(risers.asins.join(","), KEEPA_DOMAIN.UK, {
        history: false,
        stats: 90,
        listing: true,
      }),
    ]);

    const usProducts = ((us.raw as Record<string, unknown>).products ??
      []) as Record<string, unknown>[];
    const ukProducts = ((uk.raw as Record<string, unknown>).products ??
      []) as Record<string, unknown>[];

    const ukByAsin = new Map(
      ukProducts
        .filter((p) => typeof p.asin === "string")
        .map((p) => [p.asin as string, p]),
    );

    const alreadyHere: Record<string, unknown>[] = [];
    const notHereYet: Record<string, unknown>[] = [];

    for (const usProduct of usProducts) {
      const asin = usProduct.asin as string;
      const usStats = (usProduct.stats ?? {}) as Record<string, unknown>;
      const usCurrent = (usStats.current as number[] | undefined)?.[3] ?? null;
      const usAvg365 = (usStats.avg365 as number[] | undefined)?.[3] ?? null;

      const growth =
        usCurrent && usAvg365 && usCurrent > 0 && usAvg365 > 0
          ? Math.round((usAvg365 / usCurrent) * 100) / 100
          : null;

      // A ratio in the thousands is not a product that grew, it is a product
      // that did not exist. A year's average rank of 1.2 million against a
      // rank of 1 today means the listing spent most of the year unranked, and
      // dividing by a rank of 1 turns that into a number that dwarfs every
      // genuine riser and sorts them off the bottom of the page.
      //
      // Real, sustainable growth is a few times over, not a million. Anything
      // past the ceiling is reported as an outlier rather than ranked, because
      // it is usually a launch and occasionally a data artefact — and either
      // way it is not evidence a UK gap exists.
      const implausible = growth !== null && growth > MAX_PLAUSIBLE_GROWTH;

      const shared = {
        asin,
        title: usProduct.title ?? null,
        brand: usProduct.brand ?? null,
        usCurrentRank: usCurrent && usCurrent > 0 ? usCurrent : null,
        usAvg365Rank: usAvg365 && usAvg365 > 0 ? usAvg365 : null,
        growthRatio: growth,
        looksLikeALaunch: implausible,
        note: implausible
          ? `Ranked around ${usAvg365?.toLocaleString("en-GB")} on average over the year and ${usCurrent} today. That is a listing that spent most of the year unranked, so treat it as a launch rather than growth.`
          : null,
      };

      const ukProduct = ukByAsin.get(asin);
      const ukStats = (ukProduct?.stats ?? {}) as Record<string, unknown>;
      const ukCurrent = ukStats.current as number[] | undefined;
      // A UK record with no price and no rank is Keepa knowing the ASIN
      // exists, not Amazon UK selling it.
      const ukPrice =
        typeof ukCurrent?.[1] === "number" && ukCurrent[1] >= 0
          ? ukCurrent[1] / 100
          : null;
      const ukRank =
        typeof ukCurrent?.[3] === "number" && ukCurrent[3] > 0 ? ukCurrent[3] : null;

      // A price is the test, not a rank or a review count. The first run
      // returned a product with 103,693 UK reviews and no price — Amazon knows
      // the listing and nobody can buy it, which is not "already here".
      if (ukProduct && ukPrice !== null) {
        alreadyHere.push({
          ...shared,
          ukPrice,
          ukRank,
          ukRating:
            typeof ukCurrent?.[16] === "number" && ukCurrent[16] > 0
              ? ukCurrent[16] / 10
              : null,
          ukReviews:
            typeof ukCurrent?.[17] === "number" && ukCurrent[17] > 0
              ? ukCurrent[17]
              : null,
        });
      } else {
        notHereYet.push(shared);
      }
    }

    // Launches sort below real growth rather than above it, which is the whole
    // reason for the flag: unranked-to-rank-1 produces the biggest ratio in the
    // set and would otherwise occupy every top slot.
    const sortByGrowth = (a: Record<string, unknown>, b: Record<string, unknown>) => {
      if (!!a.looksLikeALaunch !== !!b.looksLikeALaunch) {
        return a.looksLikeALaunch ? 1 : -1;
      }
      return ((b.growthRatio as number) ?? 0) - ((a.growthRatio as number) ?? 0);
    };

    return Response.json({
      criteria: {
        grownBy: `${Math.round((minGrowth - 1) * 100)}% or more over the year`,
        rankTodayBetween: `${risers.currentFloor}–${risers.currentCeiling}`,
        yearAverageBetween: `${risers.yearFloor}–${risers.yearCeiling}`,
        whyBothEnds:
          "Bounded at both ends so the search finds products that were ranked all year and improved, rather than products that were unranked a year ago. Without the upper bound on the year's average, every result is a launch.",
        totalUsMatches: risers.totalMatches,
      },
      alreadyHere: alreadyHere.sort(sortByGrowth),
      notHereYet: notHereYet.sort(sortByGrowth),
      guidance:
        `${alreadyHere.length} are buyable on Amazon UK and can go through the normal pipeline, with US growth as an extra signal. ` +
        `${notHereYet.length} are not — no UK price, so nothing the rubric measures exists yet. Those are a first-mover bet on the inference that what sells there sells here, and a different risk. ` +
        `${[...alreadyHere, ...notHereYet].filter((r) => r.looksLikeALaunch).length} of them look like launches rather than growth and are sorted last.`,
      tokensLeft: uk.tokensLeft ?? us.tokensLeft,
    });
  } catch (error) {
    if (error instanceof MissingKeepaKey) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof KeepaTokensExhausted) {
      return Response.json({ error: error.message }, { status: 429 });
    }
    return Response.json({ error: describeError(error) }, { status: 502 });
  }
}
