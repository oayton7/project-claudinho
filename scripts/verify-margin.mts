/**
 * Pins the margin engine to known-good numbers.
 *
 * Run with:  npm run verify
 *
 * Two suites:
 *   1. Import VAT off. Must reproduce section 6 of the plan exactly. This is
 *      the regression test on the core arithmetic.
 *   2. Import VAT on at 20%. The corrected model, and the one you should
 *      actually use — below £90k that VAT is real money you cannot reclaim.
 */
import {
  referralFee,
  fbaFee,
  lowPriceThresholdFor,
} from "../src/lib/fees.ts";
import { orderCostAtMoq } from "../src/lib/margin.ts";
import {
  calculateMargin,
  maxLandedCost,
  referralFeePctFor,
  DIGITAL_SERVICES_FEE_PCT,
  MINIMUM_REFERRAL_FEE,
  DEFAULT_INPUT,
  type MarginInput,
} from "../src/lib/margin.ts";

let failed = 0;

function expect(label: string, actual: number, wanted: number, tol = 0.01) {
  const pass = Math.abs(actual - wanted) <= tol;
  if (!pass) failed++;
  console.log(
    `${pass ? "  ok  " : " FAIL "} ${label.padEnd(32)} got ${actual}, wanted ${wanted}`,
  );
}

// ── Suite 1: the plan's worked example, import VAT switched off ──────────────
console.log("Section 6 worked example (import VAT off) — regression check\n");

const planInput: MarginInput = { ...DEFAULT_INPUT, importVatRatePct: 0 };
const plan = calculateMargin(planInput);

expect("landed unit cost", plan.landedUnitCost, 6.0);
// Section 6's worked example predates the Digital Services Fee, which section
// 19.5 added on 18 Aug 2026. Every figure below is the plan's own number less
// £0.13: (£3.75 referral + £2.90 FBA + £0.04 fuel) x 2%. The code is right and
// the worked example is stale — the third time this has happened, and each
// time because the model got more honest rather than because it broke.
expect("contribution (7.05 less the 2% DSF)", plan.contribution, 6.91);
expect("net margin % (was 28.2)", plan.netMarginPct, 27.67, 0.05);
expect("VAT-reg contribution (was 2.88)", plan.contributionVatRegistered, 2.75);
expect("VAT-reg net margin % (was 11.5)", plan.netMarginVatRegisteredPct, 11.0, 0.05);
expect("margin before returns/ads % (was 48.2)", plan.preAdMarginPct, 47.68, 0.05);
expect("landed cost % of sell price", plan.landedCostPctOfSell, 24.0, 0.05);

// ── Suite 2: the corrected model ────────────────────────────────────────────
console.log("\nSame product with import VAT at 20% — the honest model\n");

const real = calculateMargin(DEFAULT_INPUT);

// FOB 4.50 + freight 1.00 + duty 0.00 = 5.50 base, at 20% = 1.10
expect("import VAT", real.importVat, 1.1);
expect("landed (not registered)", real.landedUnitCost, 7.1);
expect("landed (registered)", real.landedUnitCostRegistered, 6.0);

// Below the threshold you carry the import VAT, so contribution drops by it.
expect("contribution (5.95 less the DSF)", real.contribution, 5.81);

// Registered: you owe output VAT but reclaim the import VAT, which nets back
// to the same £2.88 the plan had. The registered figure was always right —
// it was the below-threshold one that was overstated.
expect("VAT-reg contribution (was 2.88)", real.contributionVatRegistered, 2.75);

console.log(
  `\nThe cliff, correctly modelled: £${real.contribution} → £${real.contributionVatRegistered} (${real.vatCliffDropPct}% drop)`,
);
console.log(
  `The plan's figure, which ignored import VAT: £${plan.contribution} → £${plan.contributionVatRegistered} (${plan.vatCliffDropPct}% drop)`,
);
console.log(
  "\nThe registered figure is unchanged. What moved is the below-threshold one,",
);
console.log(
  "which the plan overstated by the full import VAT. The cliff looks smaller only",
);
console.log("because the starting point was wrong, not because registering got cheaper.");
console.log(
  `verdict: ${real.verdict}   cash tied up: £${real.cashTiedUp}   payback: ${real.daysToPayback} days`,
);

// --- The engine run backwards -------------------------------------------
//
// The scout solves for landed cost instead of margin, so it needs pinning to
// the same worked example. At £24.99 on default fees the 30% cap bites before
// the margin floor does, giving a ceiling of £7.50. The worked example's real
// landed cost is £7.10, which sits just under it — consistent with the plan's
// PARK verdict, where every hard check passes and only soft ones fail.
console.log("\n--- Reverse: the most you can pay to land a unit ---");

const ceiling = maxLandedCost(24.99);
expect("max landed cost at £24.99", ceiling.landed, 7.5);
expect(
  "binding constraint is the 30% cap",
  ceiling.bindingConstraint === "landed cost cap" ? 1 : 0,
  1,
);

const workedExampleLanded = calculateMargin(DEFAULT_INPUT).landedUnitCost;
expect(
  "worked example under its ceiling",
  workedExampleLanded <= ceiling.landed ? 1 : 0,
  1,
);
console.log(
  `       worked example lands at £${workedExampleLanded}, ceiling £${ceiling.landed}`,
);

// At a low enough price the margin floor bites first instead. £13 leaves so
// little after the fixed fees that the fee stack, not the cap, sets the limit.
expect(
  "at £13 the margin floor binds",
  maxLandedCost(13).bindingConstraint === "margin" ? 1 : 0,
  1,
);

// --- The referral fee table (plan section 19.5, step 1) ------------------
//
// The change that motivated this: a flat 15% on an £18 home product invented
// £1.26 a unit of cost on a product whose contribution might be £4, so the
// engine was rejecting things it should have kept.
console.log("\n--- Referral fees by category and price band ---");

expect("£18 home product", referralFeePctFor("home", 18), 8);
expect("£25 home product", referralFeePctFor("home", 25), 15);
expect("home at exactly £20", referralFeePctFor("home", 20), 8);
// Garden looks like Home and is not. This is the mistake worth pinning.
expect("£18 garden product", referralFeePctFor("garden", 18), 15);
expect("£9 beauty product", referralFeePctFor("beauty", 9), 8);
expect("£12 beauty product", referralFeePctFor("beauty", 12), 15);
expect("£14 clothing", referralFeePctFor("clothing", 14), 5);
expect("£18 clothing", referralFeePctFor("clothing", 18), 10);
expect("£30 clothing", referralFeePctFor("clothing", 30), 15);
expect("unknown category", referralFeePctFor("other", 18), 15);

// The floor. 8% of £2 is 16p, and Amazon does not charge less than 25p.
expect("£2 home product hits the floor", referralFee("home", 2).amount, MINIMUM_REFERRAL_FEE);
expect("£18 home fee in pounds", referralFee("home", 18).amount, 1.44);

// --- The Digital Services Fee -------------------------------------------
//
// Charged on Amazon's fees, not on the sale. Easy to leave out and it is on
// every unit, so it gets pinned to a figure workable by hand.
console.log("\n--- The 2% Digital Services Fee ---");

const homeItem = calculateMargin({
  ...DEFAULT_INPUT,
  sellPrice: 18,
  feeCategory: "home",
  referralFeePct: undefined,
});

expect("referral fee charged", homeItem.referralFee, 1.44);
expect("referral % reported", homeItem.referralFeePct, 8);
// (1.44 referral + 2.90 FBA + 0.0435 fuel) x 2% = 0.0876
expect("DSF on the fee subtotal", homeItem.digitalServicesFee, 0.09);

const noDsf = 18 - 1.44 - 2.9 - 0.0435 - 0.25 - homeItem.landedUnitCost;
expect(
  "DSF actually comes out of contribution",
  Math.round((noDsf - homeItem.digitalServicesFee - 18 * 0.04 - 4) * 100) / 100,
  homeItem.contribution,
);

// The old flat 15% on the same product, to show what it was costing.
const atFlat15 = calculateMargin({
  ...DEFAULT_INPUT,
  sellPrice: 18,
  feeCategory: "home",
  referralFeePct: 15,
});
console.log(
  `       £18 home: table £${homeItem.referralFee} vs flat 15% £${atFlat15.referralFee} — ${Math.round((atFlat15.referralFee - homeItem.referralFee) * 100)}p a unit the old code invented`,
);
expect(
  "table keeps what flat 15% squeezed",
  homeItem.contribution > atFlat15.contribution ? 1 : 0,
  1,
);

expect("DSF rate is the documented 2%", DIGITAL_SERVICES_FEE_PCT, 2);

// --- FBA fulfilment by packed dimensions (brief session 1) ---------------
//
// Amazon charges on the box, not the contents, which is why weight alone
// cannot pick a tier and why the 900g check in the Judge was only a proxy.
console.log("\n--- FBA fees by size tier ---");

const smallLight = fbaFee({
  lengthMm: 300, widthMm: 200, heightMm: 20, weightG: 90,
  sellPrice: 15, category: "toys",
});
expect("300x200x20mm, 90g, £15 toy", smallLight.amount, 1.7);
expect("  and it is not an assumption", smallLight.assumed ? 1 : 0, 0);

// The same box above the Low-Price threshold pays the standard rate.
const sameBoxDearer = fbaFee({
  lengthMm: 300, widthMm: 200, heightMm: 20, weightG: 90,
  sellPrice: 25, category: "toys",
});
expect("same box at £25 loses Low-Price", sameBoxDearer.amount, 2.08);

// Two thresholds, and picking the wrong one is how a product looks viable.
expect("Low-Price threshold, toys", lowPriceThresholdFor("toys"), 20);
expect("Low-Price threshold, beauty", lowPriceThresholdFor("beauty"), 10);
expect("Low-Price threshold, home", lowPriceThresholdFor("home"), 10);

// Rule 3: missing data assumes the expensive case, and says so.
const noDims = fbaFee({
  lengthMm: null, widthMm: null, heightMm: null, weightG: 200,
  sellPrice: 15, category: "toys",
});
expect("no dimensions costs the worst tier", noDims.amount, 3.58);
expect("  and is flagged as assumed", noDims.assumed ? 1 : 0, 1);
expect(
  "  and explains itself",
  noDims.why.includes("no packed dimensions") ? 1 : 0,
  1,
);

// Dimensions are compared longest-edge to longest-limit, so the order the
// numbers arrive in must not change the answer.
const oneWay = fbaFee({
  lengthMm: 20, widthMm: 300, heightMm: 200, weightG: 90,
  sellPrice: 15, category: "toys",
});
expect("dimension order does not matter", oneWay.amount, smallLight.amount);

// A margin run with no dimensions must surface the assumption, not bury it.
const assumedRun = calculateMargin({
  ...DEFAULT_INPUT,
  sellPrice: 18,
  feeCategory: "home",
  referralFeePct: undefined,
  fbaFee: undefined,
});
expect("assumption reaches the result", assumedRun.assumptions.length > 0 ? 1 : 0, 1);
expect(
  "worst tier used",
  assumedRun.fbaTier === "Standard parcel" ? 1 : 0,
  1,
);
console.log(`       ${assumedRun.assumptions[0]}`);

// --- What a first order costs -------------------------------------------
//
// The capital cap is a warning, not a kill: "needs more money than you have"
// is a decision, and Oscar can find more for a product worth funding. That
// decision needs cash rather than a percentage.
console.log("\n--- First order cost at supplier MOQs (£3,000 working capital) ---");

const orders = orderCostAtMoq(9.29, 3000);
const at300 = orders.find((o) => o.units === 300)!;
const at1000 = orders.find((o) => o.units === 1000)!;

// The diamond painting kit's real ceiling, priced at the MOQs suppliers quote.
expect("300 units at a £9.29 ceiling", at300.cost, 2787);
expect("which is over the 40% cap", at300.withinCap ? 1 : 0, 0);
// What Oscar would need in total to make this order inside the cap. He has
// said about £5,000 is reachable, so a shortfall near that is a live option
// and one far past it is not.
expect("total capital it would need", at300.shortfall, 3967.5);

expect("1000 units", at1000.cost, 9290);
expect("also over", at1000.withinCap ? 1 : 0, 0);

// A cheaper product at the same quantity should fit.
const cheap = orderCostAtMoq(4, 3000).find((o) => o.units === 300)!;
// £4 x 300 is £1,200, which is exactly 40% of £3,000 — the boundary sits on
// "fits", and a product landing at exactly the cap is not a product to reject.
expect("£4 landed at 300 units sits exactly on the cap", cheap.withinCap ? 1 : 0, 1);
expect("with nothing to find", cheap.shortfall, 0);

// A penny more and it does not.
const overByAPenny = orderCostAtMoq(4.01, 3000).find((o) => o.units === 300)!;
expect("£4.01 does not", overByAPenny.withinCap ? 1 : 0, 0);

orders.forEach((o) =>
  console.log(
    `       ${o.units} units: £${o.cost} (${o.pctOfCapital}% of capital)${o.withinCap ? "" : ` — needs £${o.shortfall} more`}`,
  ),
);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed.");
