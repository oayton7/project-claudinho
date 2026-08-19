/**
 * Pins the scout's soft scoring to the behaviour it exists for.
 *
 * The point of scoring rather than filtering is that a product can miss one
 * criterion and still surface if it is exceptional elsewhere. That is a claim
 * about behaviour, so it gets a test rather than a comment.
 */
import {
  DEFAULT_WEIGHTS,
  autoVerdict,
  hardKill,
  scoreCandidate,
  type Scorable,
} from "../src/lib/score.ts";

let failed = 0;

function expect(label: string, actual: unknown, wanted: unknown) {
  const pass = actual === wanted;
  if (!pass) failed++;
  console.log(
    `${pass ? "  ok  " : " FAIL "} ${label.padEnd(46)} got ${actual}, wanted ${wanted}`,
  );
}

function assert(label: string, condition: boolean, detail = "") {
  if (!condition) failed++;
  console.log(`${condition ? "  ok  " : " FAIL "} ${label}${detail ? `  (${detail})` : ""}`);
}

const base: Scorable = {
  price: 20,
  rating: 4.2,
  reviewCount: 400,
  unhappyBuyers: 120,
  monthlySold: 200,
  rankDrops90: 300,
  sellers: 6,
  packageWeightG: 400,
  maxLandedCost: 6,
  listingWeaknessCount: 1,
  usGrowing: null,
};

console.log("The case the old filters got wrong\n");

// Under the old rules this was excluded outright for being 50p under a £12
// floor, despite being the single most interesting product in the set.
const nearMiss: Scorable = {
  ...base,
  price: 11.5,
  unhappyBuyers: 6200,
  listingWeaknessCount: 5,
  maxLandedCost: 3.45,
};

// Meets every old threshold and is unremarkable on all of them.
const blandButCompliant: Scorable = {
  ...base,
  price: 24,
  unhappyBuyers: 90,
  listingWeaknessCount: 0,
  rating: 4.45,
};

const a = scoreCandidate(nearMiss);
const b = scoreCandidate(blandButCompliant);

console.log(`  under-priced but exceptional: ${a.total}`);
console.log(`  compliant but bland:          ${b.total}\n`);

assert(
  "a near-miss on price still beats a bland compliant product",
  a.total > b.total,
  `${a.total} vs ${b.total}`,
);
assert("the near-miss is not hard-killed", hardKill(nearMiss) === null);
assert(
  "its price still registers as a weakness",
  a.criteria.find((c) => c.key === "priceBand")!.score! < 1,
);
assert(
  "and its strengths are reported, not just the number",
  a.strengths.length > 0,
  a.strengths.join(" | "),
);

console.log("\nScoring mechanics\n");

// Missing data must not read as zero. A product Keepa has no weight for is
// unknown, not heavy, and scoring it as heavy would bury it silently.
const noWeightData: Scorable = { ...base, packageWeightG: null };
const withGoodWeight: Scorable = { ...base, packageWeightG: 250 };
assert(
  "missing data lowers coverage, not the score",
  scoreCandidate(noWeightData).coverage < scoreCandidate(withGoodWeight).coverage,
);
assert(
  "and does not drag the total to zero",
  scoreCandidate(noWeightData).total > 0,
);

// Diminishing returns: one enormous product must not flatten the rest.
const huge = scoreCandidate({ ...base, unhappyBuyers: 100000 });
const big = scoreCandidate({ ...base, unhappyBuyers: 8000 });
assert(
  "10x the unhappy buyers is not 10x the score",
  huge.total < big.total * 1.6,
  `${huge.total} vs ${big.total}`,
);

// A weight of 0 must switch a criterion off completely.
const ignoringPrice = scoreCandidate(nearMiss, { ...DEFAULT_WEIGHTS, priceBand: 0 });
assert(
  "zeroing a weight removes its drag",
  ignoringPrice.total > a.total,
  `${ignoringPrice.total} vs ${a.total}`,
);

console.log("\nHard kills, which stay absolute\n");
expect("£4 product is killed", hardKill({ ...base, price: 4 }) !== null, true);
expect("4kg product is killed", hardKill({ ...base, packageWeightG: 4000 }) !== null, true);
expect("an ordinary product is not", hardKill(base), null);

console.log("\nMissing evidence must not become a confident verdict\n");

// The real failure this pins: a sweep returned products scored 86 and marked
// TEST with rating and reviews both null, because the Keepa request was
// missing a parameter. The data bug is fixed; this stops the next one being
// invisible.
const strongScore = scoreCandidate({ ...base, unhappyBuyers: 5000, listingWeaknessCount: 4 });

const blind = autoVerdict(strongScore, null, { rating: null, reviewCount: null });
assert(
  "no rating or reviews cannot be a TEST",
  blind.verdict === "PARK",
  `${blind.verdict}: ${blind.because.slice(0, 70)}`,
);

const sighted = autoVerdict(strongScore, null, { rating: 3.8, reviewCount: 900 });
assert(
  "the same score with the evidence present can be",
  sighted.verdict === "TEST",
  `${sighted.verdict} at ${strongScore.total}`,
);

assert(
  "a hard kill still outranks missing evidence",
  autoVerdict(strongScore, "too heavy", { rating: null, reviewCount: null }).verdict === "KILL",
);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed.");
