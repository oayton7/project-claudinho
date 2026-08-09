/**
 * Pins the margin engine to the worked example in section 6 of the plan.
 *
 * Run with:  npm run verify
 *
 * If this fails, either the engine is wrong or the plan changed. Find out which
 * before trusting any number the app shows you.
 */
import { calculateMargin, DEFAULT_INPUT } from "../src/lib/margin.ts";

const r = calculateMargin(DEFAULT_INPUT);

let failed = 0;

function expect(label: string, actual: number, wanted: number, tol = 0.01) {
  const pass = Math.abs(actual - wanted) <= tol;
  if (!pass) failed++;
  console.log(
    `${pass ? "  ok  " : " FAIL "} ${label.padEnd(30)} got ${actual}, wanted ${wanted}`,
  );
}

console.log("Worked example: £24.99 item, £6.00 landed, small standard\n");

expect("landed unit cost", r.landedUnitCost, 6.0);
expect("contribution", r.contribution, 7.05);
expect("net margin %", r.netMarginPct, 28.2, 0.05);
expect("VAT-registered contribution", r.contributionVatRegistered, 2.88);
expect("VAT-registered net margin %", r.netMarginVatRegisteredPct, 11.5, 0.05);
expect("VAT cliff drop %", r.vatCliffDropPct, 59, 0.5);
expect("margin before returns/ads %", r.preAdMarginPct, 48.2, 0.05);
expect("landed cost % of sell price", r.landedCostPctOfSell, 24.0, 0.05);
expect("break-even units", r.breakEvenUnits, 171, 1);

console.log(
  `\nverdict: ${r.verdict}   cash tied up: £${r.cashTiedUp}   payback: ${r.daysToPayback} days`,
);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed.");
