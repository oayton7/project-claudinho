/**
 * Pins the scout's soft scoring to the behaviour it exists for.
 *
 * The point of scoring rather than filtering is that a product can miss one
 * criterion and still surface if it is exceptional elsewhere. That is a claim
 * about behaviour, so it gets a test rather than a comment.
 */
import { isMedia } from "../src/lib/exclusions.ts";
import { complianceBurden } from "../src/lib/compliance.ts";
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

console.log("\nAn impossible margin is a kill, whatever else is true\n");

// The first working sweep marked a product TEST with a £1.90 ceiling. Nothing
// is manufactured, shipped, duty-paid and prepped for £1.90, so that verdict
// was impossible rather than optimistic.
assert(
  "£1.90 to land a unit is a kill",
  hardKill({ ...base, maxLandedCost: 1.9 }) !== null,
);
assert(
  "and it survives a strong score",
  autoVerdict(
    scoreCandidate({ ...base, maxLandedCost: 1.9, unhappyBuyers: 8000, listingWeaknessCount: 5 }),
    hardKill({ ...base, maxLandedCost: 1.9 }),
    { rating: 3.9, reviewCount: 2000 },
  ).verdict === "KILL",
);
assert("£4 of room is not a kill", hardKill({ ...base, maxLandedCost: 4 }) === null);

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

console.log("\nWhat is never a candidate\n");

// Every one of these has slipped through a filter at some point today, which
// is why they are pinned rather than trusted.
const tree = (...names: string[]) => ({ categoryTree: names.map((name) => ({ name })) });

assert("US clothing department", isMedia(tree("Clothing, Shoes & Jewelry", "Tops")));
assert("UK clothing department", isMedia(tree("Clothing", "Jumpers")));
assert("UK footwear", isMedia(tree("Shoes & Bags", "Cross Trainers")));
assert("a leaf inside a fine department", isMedia(tree("Sports & Outdoors", "Leggings")));
assert("supplements", isMedia(tree("Health & Personal Care", "Vitamins & Supplements")));
assert("sports nutrition", isMedia(tree("Health & Personal Care", "Sports Nutrition", "Protein")));
assert("food", isMedia(tree("Grocery", "Candy & Chocolate Bars")));
assert("vinyl by department", isMedia(tree("CDs & Vinyl", "Album-Oriented Rock")));
assert("DVDs, UK naming", isMedia(tree("DVD & Blu-ray", "Action")));

// And the things that must survive, or the filter has eaten the funnel.
assert("hats, wherever they are filed", isMedia(tree("Sports & Outdoors", "Hats & Caps")));
assert("gloves outside a clothing department", isMedia(tree("Automotive", "Motorbike Gloves")));
assert("socks", isMedia(tree("Clothing", "Socks")));
// Sizing is the test, not wearing. These have a size and are out.
assert("belts have a size", isMedia(tree("Accessories", "Belts")));

// These do not, so they stay in: one-size, and capable of going viral in a way
// a jumper is not.
assert("sunglasses stay in", !isMedia(tree("Accessories", "Sunglasses")));

// Hazardous goods, which reach the shortlist filed under the pest they kill
// rather than under anything that sounds chemical. Every word that should have
// caught the wasp killer was already on the list; none of them was in its
// category.
assert(
  "a wasp killer by category",
  isMedia(tree("Garden & Outdoors", "Bees, Wasps & Hornets")),
);
assert(
  "a wasp killer by title, in a clean category",
  isMedia({
    ...tree("Garden & Outdoors", "Garden Sprayers"),
    title: "Karlsten Hyper Power Wasp Nest Killer & Hornet Killer 600ml",
  }),
);
assert(
  "a hazard in the title is caught with no category tree at all",
  isMedia({ title: "Karlsten Hyper Power Wasp Nest Killer & Hornet Killer 600ml" }),
);
assert(
  "and a stored row shape, one category and a title",
  isMedia({ categoryTree: [{ name: "Garden Sprayers" }], title: "Doff Ant Killer Powder 300g" }),
);
assert("weed killer by title", isMedia({ ...tree("Garden & Outdoors", "Lawn Care"), title: "Resolva Weed Killer Concentrate 1L" }));
assert("slug pellets by title", isMedia({ ...tree("Garden & Outdoors", "Plant Care"), title: "Growing Success Slug Pellets 575g" }));

// And the things near them that must survive. A physical trap is not a
// chemical, and an over-block here is invisible.
assert("a non-chemical wasp trap survives", !isMedia({ ...tree("Garden & Outdoors", "Traps"), title: "Reusable Outdoor Wasp Trap, Chemical Free" }));
assert("bird baths survive", !isMedia({ ...tree("Garden & Outdoors", "Bird Baths"), title: "35In Metal Bird Bath for Garden, Vintage Freestanding" }));
assert("sprinklers survive", !isMedia({ ...tree("Garden & Outdoors", "Sprinklers"), title: "Garden Sprinkler Watering System" }));
assert("dog toys survive", !isMedia({ ...tree("Pet Supplies", "Interactive Toys"), title: "Dog Football with Grab Tabs, Floating Toy" }));
assert(
  "diamond painting survives, still",
  !isMedia({ ...tree("Toys & Games", "Diamond Painting Kits"), title: "Personalised Diamond Painting Kits for Adults" }),
);
assert(
  "a craft set calling itself non-poisonous survives",
  !isMedia({ ...tree("Toys & Games", "Art Sets"), title: "Kids Paint Set, Washable and Non-Poisonous" }),
);
assert("bags stay in", !isMedia(tree("Luggage", "Backpacks")));
assert("wallets stay in", !isMedia(tree("Accessories", "Wallets & Card Cases")));

// Mains electrical is out: saturated, and UKCA marking plus liability is a
// barrier rather than a cost for a first-timer.
assert("USB-C chargers", isMedia(tree("Electronics", "Chargers & Power Supplies")));
assert("wireless chargers too", isMedia(tree("Electronics", "Wireless Chargers")));
assert("power strips", isMedia(tree("DIY & Tools", "Power Strips")));
assert("cables", isMedia(tree("Electronics", "USB Cables")));
assert("pool chemicals", isMedia(tree("Garden", "Pool Clarifiers & Enzymes")));
assert("batteries", isMedia(tree("Electronics", "Batteries")));

assert("a parasol base is fine", !isMedia(tree("Garden & Outdoors", "Parasol Stands & Bases")));
assert("a kitchen gadget is fine", !isMedia(tree("Home & Kitchen", "Kitchen Tools & Gadgets")));
assert("a diamond painting kit is fine", !isMedia(tree("Home & Kitchen", "Diamond Painting Kits")));

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed.");

// ── Producer obligations ──────────────────────────────────────────────────
//
// Importing makes you the producer, so a product with an LED in it carries
// duties a bird bath does not. These flag rather than kill, so the risk being
// guarded against is not over-blocking but silent wrongness: a flag on the
// wrong product is noise, and noise gets ignored, which costs the flag its
// value on the product that needed it.
const burden = (title: string, category = "") =>
  complianceBurden({ title, category }).obligations.map((o) => o.what);

assert(
  "solar lights need WEEE registration",
  burden("ANGMLN Patio Umbrella Lights Solar Powered Outdoor", "Umbrella Lights").includes(
    "WEEE producer registration",
  ),
);
assert(
  "and the batteries inside them count separately",
  burden("ANGMLN Patio Umbrella Lights Solar Powered Outdoor", "Umbrella Lights").includes(
    "Battery producer registration",
  ),
);
assert(
  "a cordless product is caught by the battery rule",
  burden("Cordless Handheld Vacuum").includes("Battery producer registration"),
);

// The substring traps. A bare "light" matches "lightweight" and "delighted",
// and a compliance flag on a storage box is the kind of quiet mistake that
// takes a morning to find.
assert(
  "lightweight is not electrical",
  burden("Woodluv Lightweight Seagrass Storage Boxes with Lids", "Shelf Baskets").length === 0,
);
assert(
  "a bird bath has no producer duties",
  burden("35In Metal Bird Bath for Garden, Vintage Freestanding", "Bird Baths").length === 0,
);
assert(
  "nor does a paper towel holder",
  burden("Paper Towel Holder Chrome Kitchen Roll Holder", "Paper Towel Holders").length === 0,
);
assert(
  "nor a golf grip",
  burden("Golf Grip Tour Fit Dual Compound Premium Half Cord", "Grips").length === 0,
);

// Children's products are flagged as needing a proper look rather than
// answered, because the answer is product-specific and guessing it would be
// worse than saying nothing.
assert(
  "a children's toy is flagged for checking",
  burden("Wooden Stacking Toy for Toddlers", "Toys & Games").some((w) => w.startsWith("Toy safety")),
);
assert(
  "a dog toy is not a children's toy",
  burden("SPORTSPET Dog Football with Grab Tabs, Floating Toy", "Interactive Toys").every(
    (w) => !w.startsWith("Toy safety"),
  ),
);

assert(
  "a hobby kit for adults is not a children's toy, even under Toys & Games",
  burden("Personalised Diamond Painting Kits for Adults", "Toys & Games").every(
    (w) => !w.startsWith("Toy safety"),
  ),
);
assert(
  "but a product for adults and children keeps the flag",
  burden("Jigsaw Puzzle for Adults and Kids", "Toys & Games").some((w) =>
    w.startsWith("Toy safety"),
  ),
);
assert(
  "an empty candidate says so rather than guessing",
  complianceBurden({}).summary.length > 0,
);
