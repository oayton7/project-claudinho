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
  calculateMargin,
  maxLandedCost,
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
expect("contribution", plan.contribution, 7.05);
expect("net margin %", plan.netMarginPct, 28.2, 0.05);
expect("VAT-registered contribution", plan.contributionVatRegistered, 2.88);
expect("VAT-registered net margin %", plan.netMarginVatRegisteredPct, 11.5, 0.05);
expect("margin before returns/ads %", plan.preAdMarginPct, 48.2, 0.05);
expect("landed cost % of sell price", plan.landedCostPctOfSell, 24.0, 0.05);

// ── Suite 2: the corrected model ────────────────────────────────────────────
console.log("\nSame product with import VAT at 20% — the honest model\n");

const real = calculateMargin(DEFAULT_INPUT);

// FOB 4.50 + freight 1.00 + duty 0.00 = 5.50 base, at 20% = 1.10
expect("import VAT", real.importVat, 1.1);
expect("landed (not registered)", real.landedUnitCost, 7.1);
expect("landed (registered)", real.landedUnitCostRegistered, 6.0);

// Below the threshold you carry the import VAT, so contribution drops by it.
expect("contribution", real.contribution, 5.95);

// Registered: you owe output VAT but reclaim the import VAT, which nets back
// to the same £2.88 the plan had. The registered figure was always right —
// it was the below-threshold one that was overstated.
expect("VAT-registered contribution", real.contributionVatRegistered, 2.88);

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

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed.");
