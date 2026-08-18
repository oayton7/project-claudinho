/**
 * Soft scoring for scout candidates.
 *
 * Pure arithmetic, same contract as margin.ts: no network, no AI, every number
 * reproducible by hand.
 *
 * ## Why this exists
 *
 * The first version ANDed eight filters together and sent them all to Keepa.
 * Each one cut the pool and eight of them multiplied it to nothing. Worse, it
 * threw away exactly the products worth seeing: a £11.50 product with a huge
 * quality gap was binned for being 50p under an arbitrary floor.
 *
 * A threshold is a decision made in advance, with no knowledge of the product
 * it is about to reject. So there are now only a couple of genuinely
 * disqualifying gates, kept deliberately wide, and everything else scores on a
 * curve. A candidate can be weak on one thing and still surface if it is
 * exceptional elsewhere, which is the actual shape of the judgement.
 *
 * ## Reading the score
 *
 * Never on its own. Every score carries the per-criterion breakdown that
 * produced it, because one number hides which thing is wrong. The score ranks;
 * the breakdown explains.
 */

export type Scorable = {
  price: number | null;
  rating: number | null;
  reviewCount: number | null;
  unhappyBuyers: number | null;
  monthlySold: number | null;
  rankDrops90: number | null;
  sellers: number | null;
  packageWeightG: number | null;
  maxLandedCost: number | null;
  listingWeaknessCount: number;
  usGrowing: boolean | null;
};

export type CriterionResult = {
  key: string;
  label: string;
  /** 0 to 1, or null when the data is missing. */
  score: number | null;
  weight: number;
  explain: string;
};

export type ScoreResult = {
  /** 0 to 100. Weighted over criteria that had data. */
  total: number;
  criteria: CriterionResult[];
  /** How much of the total weight had data behind it. Low means low confidence. */
  coverage: number;
  strengths: string[];
  weaknesses: string[];
};

export type Weights = Record<string, number>;

/**
 * Full marks inside the ideal band, tapering to zero at the outer edge.
 *
 * This is the shape that replaces a threshold. Just outside ideal scores
 * slightly below one rather than zero, so near-misses stay visible.
 */
function band(
  value: number,
  ideal: [number, number],
  outer: [number, number],
): number {
  const [idealLo, idealHi] = ideal;
  const [outerLo, outerHi] = outer;
  if (value >= idealLo && value <= idealHi) return 1;
  if (value < idealLo) {
    if (value <= outerLo) return 0;
    return (value - outerLo) / (idealLo - outerLo);
  }
  if (value >= outerHi) return 0;
  return (outerHi - value) / (outerHi - idealHi);
}

/**
 * More is better, with diminishing returns.
 *
 * Log-shaped on purpose. The step from 100 unhappy buyers to 1,000 matters far
 * more than 9,000 to 10,000, and a linear scale would let one enormous product
 * flatten everything else to nearly zero.
 */
function moreIsBetter(value: number, good: number): number {
  if (value <= 0) return 0;
  const scaled = Math.log10(1 + value) / Math.log10(1 + good);
  return Math.max(0, Math.min(1, scaled));
}

/** Less is better, hitting zero at the point it stops being viable. */
function lessIsBetter(value: number, good: number, bad: number): number {
  if (value <= good) return 1;
  if (value >= bad) return 0;
  return (bad - value) / (bad - good);
}

/**
 * Defaults reflect the thesis rather than generic "good product" instincts.
 *
 * Unhappy buyers and listing weakness carry the most because they are the
 * opening: proven demand plus visible neglect. Margin headroom is close behind
 * because it kills fastest and costs nothing to check. Set any weight to 0 to
 * switch a criterion off entirely.
 */
export const DEFAULT_WEIGHTS: Weights = {
  unhappyBuyers: 25,
  listingWeakness: 20,
  marginHeadroom: 18,
  velocity: 12,
  priceBand: 8,
  weight: 7,
  ratingRoom: 5,
  sellers: 3,
  usGrowing: 2,
};

export function scoreCandidate(c: Scorable, weights: Weights = DEFAULT_WEIGHTS): ScoreResult {
  const criteria: CriterionResult[] = [
    {
      key: "unhappyBuyers",
      label: "Unhappy buyers",
      weight: weights.unhappyBuyers ?? 0,
      score: c.unhappyBuyers === null ? null : moreIsBetter(c.unhappyBuyers, 4000),
      explain:
        c.unhappyBuyers === null
          ? "no rating or review data"
          : `${c.unhappyBuyers.toLocaleString("en-GB")} buyers already let down`,
    },
    {
      key: "listingWeakness",
      label: "Listing weakness",
      weight: weights.listingWeakness ?? 0,
      // Their neglect is your opening, so more weaknesses scores higher.
      score: moreIsBetter(c.listingWeaknessCount, 5),
      explain:
        c.listingWeaknessCount === 0
          ? "listing is competently done, nothing obvious to beat"
          : `${c.listingWeaknessCount} weakness${c.listingWeaknessCount === 1 ? "" : "es"} in their listing`,
    },
    {
      key: "marginHeadroom",
      label: "Margin headroom",
      weight: weights.marginHeadroom ?? 0,
      // Absolute pounds, not a percentage. £8 of room buys options that £2
      // does not, whatever the sell price.
      score: c.maxLandedCost === null ? null : moreIsBetter(c.maxLandedCost, 9),
      explain:
        c.maxLandedCost === null
          ? "no price, so no ceiling can be worked out"
          : `£${c.maxLandedCost.toFixed(2)} to land a unit and still clear 15%`,
    },
    {
      key: "velocity",
      label: "Sales velocity",
      weight: weights.velocity ?? 0,
      score:
        c.monthlySold !== null
          ? moreIsBetter(c.monthlySold, 800)
          : c.rankDrops90 !== null
            ? moreIsBetter(c.rankDrops90, 900)
            : null,
      explain:
        c.monthlySold !== null
          ? `${c.monthlySold.toLocaleString("en-GB")} sold last month`
          : c.rankDrops90 !== null
            ? `${c.rankDrops90.toLocaleString("en-GB")} rank drops in 90 days`
            : "no sales signal on record",
    },
    {
      key: "priceBand",
      label: "Price",
      weight: weights.priceBand ?? 0,
      // Wide outer band on purpose. £11.50 is not meaningfully different from
      // £12, and the old hard floor threw that product away.
      score: c.price === null ? null : band(c.price, [15, 30], [8, 45]),
      explain:
        c.price === null
          ? "no price on record"
          : `£${c.price.toFixed(2)}${c.price < 12 ? ", under the comfortable floor" : ""}`,
    },
    {
      key: "weight",
      label: "Shipping weight",
      weight: weights.weight ?? 0,
      score: c.packageWeightG === null ? null : lessIsBetter(c.packageWeightG, 300, 2000),
      explain:
        c.packageWeightG === null
          ? "no weight on record"
          : `${c.packageWeightG}g`,
    },
    {
      key: "ratingRoom",
      label: "Room to improve",
      weight: weights.ratingRoom ?? 0,
      score: c.rating === null ? null : lessIsBetter(c.rating, 3.6, 4.7),
      explain:
        c.rating === null ? "no rating" : `rated ${c.rating.toFixed(1)}`,
    },
    {
      key: "sellers",
      label: "Competition on the listing",
      weight: weights.sellers ?? 0,
      score: c.sellers === null ? null : lessIsBetter(c.sellers, 3, 25),
      explain: c.sellers === null ? "no seller count" : `${c.sellers} sellers`,
    },
    {
      key: "usGrowing",
      label: "Growing in the US",
      weight: weights.usGrowing ?? 0,
      score: c.usGrowing === null ? null : c.usGrowing ? 1 : 0.2,
      explain:
        c.usGrowing === null
          ? "not checked against the US"
          : c.usGrowing
            ? "climbing the US rankings"
            : "flat or falling in the US",
    },
  ];

  // Missing data must not be scored as zero. A product Keepa has no weight for
  // is unknown, not heavy. Renormalising over the criteria that do have data
  // keeps it comparable, and coverage reports how much was actually known.
  const scored = criteria.filter((x) => x.score !== null && x.weight > 0);
  const totalWeight = criteria.reduce((sum, x) => sum + (x.score !== null ? x.weight : 0), 0);
  const allWeight = criteria.reduce((sum, x) => sum + x.weight, 0);

  const total =
    totalWeight > 0
      ? Math.round(
          (scored.reduce((sum, x) => sum + (x.score as number) * x.weight, 0) / totalWeight) * 100,
        )
      : 0;

  const ranked = [...scored].sort(
    (a, b) => (b.score as number) * b.weight - (a.score as number) * a.weight,
  );

  return {
    total,
    criteria,
    coverage: allWeight > 0 ? Math.round((totalWeight / allWeight) * 100) : 0,
    strengths: ranked.filter((x) => (x.score as number) >= 0.65).slice(0, 3).map((x) => x.explain),
    weaknesses: ranked
      .filter((x) => (x.score as number) <= 0.35)
      .slice(-3)
      .map((x) => x.explain),
  };
}

/**
 * The only genuinely disqualifying rules, kept deliberately wide.
 *
 * Everything else is a matter of degree and belongs in the score. These are
 * the cases where no amount of strength elsewhere rescues the product.
 */
export function hardKill(c: Scorable): string | null {
  if (c.price !== null && c.price < 8)
    return `£${c.price.toFixed(2)} is too low for the fees to leave anything`;
  if (c.packageWeightG !== null && c.packageWeightG > 3000)
    return `${c.packageWeightG}g, freight will eat the margin`;
  if (c.maxLandedCost !== null && c.maxLandedCost < 1.5)
    return `only £${c.maxLandedCost.toFixed(2)} to land a unit, nothing is makeable for that`;
  return null;
}

export type Verdict = "TEST" | "PARK" | "KILL";

/**
 * A verdict on every candidate, for free.
 *
 * The AI Judge costs money and about ninety seconds per product, so it cannot
 * run on a hundred of them. This does not replace it: it triages, so the
 * expensive judgement is spent on things that have already earned it. Paying
 * Claude to read a product that fails on arithmetic is paying to confirm a no.
 *
 * Deliberately the same three words the Judge and the margin engine use, so
 * one product carries one vocabulary. Where they disagree, that disagreement
 * is information — this one has never read a review or looked at a photograph.
 */
export function autoVerdict(
  score: ScoreResult,
  killed: string | null,
): { verdict: Verdict; because: string } {
  if (killed) return { verdict: "KILL", because: killed };

  // Low coverage means the score rests on very little. That is a reason to
  // look, not to trust, so it parks rather than passing or failing.
  if (score.coverage < 40) {
    return {
      verdict: "PARK",
      because: `only ${score.coverage}% of the data was available, so the score of ${score.total} is not worth much either way`,
    };
  }

  if (score.total >= 60) {
    return {
      verdict: "TEST",
      because:
        score.strengths.length > 0
          ? `scored ${score.total} on ${score.strengths.join(", ")}`
          : `scored ${score.total}`,
    };
  }

  if (score.total >= 35) {
    return {
      verdict: "PARK",
      because:
        score.weaknesses.length > 0
          ? `scored ${score.total}, held back by ${score.weaknesses.join(", ")}`
          : `scored ${score.total}, nothing stands out`,
    };
  }

  return {
    verdict: "KILL",
    because:
      score.weaknesses.length > 0
        ? `scored ${score.total}: ${score.weaknesses.join(", ")}`
        : `scored ${score.total}, too weak on every measure`,
  };
}
