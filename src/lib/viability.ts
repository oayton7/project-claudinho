/**
 * Which of the survivors to actually chase, and in what order.
 *
 * Once the deep look has rejected four in five, what is left is a handful of
 * products that all sound good. The shortlist score cannot separate them: it
 * is free arithmetic computed before anyone had an opinion, and it ranks a
 * product nobody has examined alongside one that survived a paid review.
 *
 * This is a different question from "is it any good", which the Judge already
 * answered. This asks "given it is good, how hard will it be" — because the
 * constraint is £3,000 and one person, so a product that needs £4,000 of stock
 * or three producer registrations is worse than an equally good one that needs
 * neither, even though nothing is wrong with it.
 *
 * Deliberately not another opinion from a model. Every input is a number the
 * tool already holds, so the ranking is reproducible and arguable.
 */
import { complianceBurden } from "./compliance.ts";
import { orderCostAtMoq, CAPITAL_CAP_PCT } from "./margin.ts";

export type ViabilityInput = {
  asin: string;
  title?: string | null;
  category?: string | null;
  price?: number | null;
  maxLandedCost?: number | null;
  unhappyBuyers?: number | null;
  reviewCount?: number | null;
  monthlySold?: number | null;
  weightGrams?: number | null;
  /** 0-10, weighted 60/40 towards marketing and branding, from the Judge. */
  improvability?: number | null;
  hasReviews?: boolean;
};

export type Viability = {
  asin: string;
  score: number;
  /** Best to worst, each a short phrase. */
  forIt: string[];
  againstIt: string[];
  /** The one thing that most limits this product. */
  bindingConstraint: string;
};

const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));

/**
 * Scores a judged candidate out of 100.
 *
 * The weights say what this project believes. Improvability is the thesis, so
 * it carries the most. Affordability is next, because a product you cannot
 * fund is not an opportunity however good it is. Evidence is weighted at all
 * because a judgement made without reading buyer complaints is a guess with
 * better grammar.
 */
export function viability(input: ViabilityInput): Viability {
  const forIt: string[] = [];
  const againstIt: string[] = [];

  // The thesis: proven demand, executed badly, in a way he can fix.
  const improvability = input.improvability ?? 5;
  const improvabilityPts = (clamp(improvability / 10) ) * 35;
  if (improvability >= 7) forIt.push(`clear room to improve (${improvability}/10)`);
  if (improvability <= 4) againstIt.push(`little to improve (${improvability}/10)`);

  // Can he fund a first order? Priced at the landed ceiling, which is the
  // worst case that still clears the margin floor.
  let affordabilityPts = 0;
  let cheapestFundable: number | null = null;
  if (input.maxLandedCost && input.maxLandedCost > 0) {
    const orders = orderCostAtMoq(input.maxLandedCost, 3000);
    const fundable = orders.filter((o) => o.withinCap);
    cheapestFundable = fundable.length ? fundable[fundable.length - 1].units : null;
    affordabilityPts = fundable.length ? clamp(fundable.length / orders.length) * 20 : 0;
    if (cheapestFundable && cheapestFundable >= 500) {
      forIt.push(`fundable at ${cheapestFundable} units inside ${CAPITAL_CAP_PCT}% of capital`);
    } else if (!fundable.length) {
      againstIt.push("no realistic MOQ fits the capital cap");
    }
  }

  // Demand, as a floor rather than the opportunity. Unhappy buyers is the
  // sharper signal than raw reviews: it is demand and dissatisfaction at once.
  const unhappy = input.unhappyBuyers ?? 0;
  const demandPts = clamp(unhappy / 1200) * 15;
  if (unhappy >= 500) forIt.push(`${unhappy.toLocaleString()} unhappy buyers to win over`);
  if (unhappy > 0 && unhappy < 100) againstIt.push("thin evidence of dissatisfaction");

  // Was the judgement actually informed?
  const evidencePts = input.hasReviews ? 15 : 0;
  if (!input.hasReviews) againstIt.push("judged without reading buyer reviews");

  // What importing it drags along.
  const burden = complianceBurden({ title: input.title, category: input.category });
  const compliancePts = burden.obligations.length === 0
    ? 10
    : burden.obligations.some((o) => o.weight === "barrier")
      ? 0
      : 5;
  if (burden.obligations.length === 0) forIt.push("no producer registrations");
  else againstIt.push(`${burden.obligations.length} producer obligation(s)`);

  // Size, because freight and FBA tiers are decided by the box.
  const grams = input.weightGrams ?? 0;
  const weightPts = grams === 0 ? 2 : grams <= 500 ? 5 : grams <= 900 ? 3 : 0;
  if (grams > 900) againstIt.push(`${grams}g, over the small-and-light guideline`);

  const score = Math.round(
    improvabilityPts + affordabilityPts + demandPts + evidencePts + compliancePts + weightPts,
  );

  // Name the single thing most limiting it, which is more useful than a list.
  const bindingConstraint = !input.hasReviews
    ? "No buyer reviews were read, so the judgement is weaker than it looks. Collect them first."
    : cheapestFundable === null && input.maxLandedCost
      ? "Capital. No supplier MOQ fits inside 40% of £3,000 at this landed ceiling."
      : improvability <= 5
        ? "Improvability. It is competent already, so there is less for you to add."
        : burden.obligations.some((o) => o.weight === "barrier")
          ? "Compliance. Something here needs checking properly before you commit."
          : unhappy < 100
            ? "Evidence of demand. Few unhappy buyers means a small pool to win from."
            : "Nothing structural. This one comes down to whether a supplier can build the fix.";

  return { asin: input.asin, score, forIt, againstIt, bindingConstraint };
}

/** Best first. */
export function rankByViability(inputs: ViabilityInput[]): Viability[] {
  return inputs.map(viability).sort((a, b) => b.score - a.score);
}
