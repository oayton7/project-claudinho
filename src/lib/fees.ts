/**
 * Amazon UK fee tables.
 *
 * Verified 18 August 2026 against the brief's part 7. Amazon moved these twice
 * in 2026, so treat the date as an expiry rather than a signature: this file is
 * the single point of failure for every margin number the tool produces.
 *
 * Two rules run through everything here, both from the brief's hard rules:
 *
 *   Never invent a number silently. Every fee comes back with `assumed` and a
 *   `why` string, so a figure looked up from real dimensions reads differently
 *   on screen from one guessed because Keepa had none.
 *
 *   When data is missing, assume the expensive case. A cost estimate that
 *   flatters is worse than no estimate, because you act on it.
 */

export const FEE_TABLE_VERSION = "2026-08-18";

export type Fee = {
  /** Pounds. */
  amount: number;
  /** True when any part of this rests on a guess rather than a known value. */
  assumed: boolean;
  /** Plain English, shown on screen next to the number. */
  why: string;
};

export const FEE_CATEGORIES = [
  "home",
  "garden",
  "diy",
  "toys",
  "sports",
  "office",
  "pet",
  "petFood",
  "beauty",
  "health",
  "grocery",
  "clothing",
  "electronics",
  "videoGames",
  "jewellery",
  "deviceAccessories",
  "other",
] as const;

export type FeeCategory = (typeof FEE_CATEGORIES)[number];

export const FEE_CATEGORY_LABELS: Record<FeeCategory, string> = {
  home: "Home & Kitchen",
  garden: "Garden & Outdoors",
  diy: "DIY & Tools",
  toys: "Toys & Games",
  sports: "Sports & Outdoors",
  office: "Office Products",
  pet: "Pet Supplies",
  petFood: "Pet food & pet clothing",
  beauty: "Beauty",
  health: "Health & Personal Care",
  grocery: "Grocery",
  clothing: "Clothing & Accessories",
  electronics: "Consumer electronics",
  videoGames: "Video games & consoles",
  jewellery: "Jewellery",
  deviceAccessories: "Amazon device accessories",
  other: "Unknown category",
};

/**
 * Best guess at a fee category from Amazon's own category text.
 *
 * Deliberately cautious about what it claims to know. An unmatched category
 * falls to "other", which carries the highest referral rate, so an unknown
 * product is costed pessimistically rather than flatteringly.
 *
 * That pessimism cuts both ways, which is why the matching is worth doing
 * properly rather than shrugging at everything: a too-high fee shrinks the
 * landed ceiling, and a shrunken ceiling is what makes a product look like it
 * cannot survive VAT registration. Guessing badly here would kill good
 * products quietly, the way a keyword of "paint" once excluded diamond
 * painting kits.
 */
export function toFeeCategory(name: string | null | undefined): FeeCategory {
  const text = (name ?? "").toLowerCase();
  if (!text.trim()) return "other";

  // Order matters: the first match wins, so the more specific patterns of any
  // overlapping pair come first. Pet food before pet, video games before
  // electronics, jewellery before clothing.
  const rules: [FeeCategory, RegExp][] = [
    ["petFood", /pet\s*food|dog\s*food|cat\s*food|pet.*(clothing|apparel)/],
    ["pet", /\bpet\b|pet supplies|dog|cat|aquarium|reptile/],
    ["videoGames", /video\s*game|console|playstation|xbox|nintendo/],
    ["deviceAccessories", /(kindle|echo|fire tv|alexa).*(accessor|case)/],
    ["jewellery", /jewell?ery|necklace|bracelet|earring/],
    ["clothing", /clothing|apparel|shoe|footwear|fashion|garment/],
    ["electronics", /electronic|computer|camera|headphone|audio|hi-?fi|phone/],
    ["beauty", /beauty|cosmetic|skin\s*care|makeup|fragrance|hair care/],
    ["health", /health|personal care|medical|mobility|first aid/],
    ["grocery", /grocer|food|drink|beverage|coffee|tea\b/],
    ["office", /office|stationery|school supplies|printer/],
    ["toys", /toys?|games?|puzzle|lego|craft|hobby/],
    ["sports", /sport|fitness|exercise|cycling|camping|outdoor recreation/],
    ["garden", /garden|outdoors|patio|lawn|plant|greenhouse/],
    ["diy", /diy|tools|hardware|building|power tool|automotive/],
    ["home", /home|kitchen|furniture|bedding|storage|appliance|lighting|d[eé]cor/],
  ];

  for (const [category, pattern] of rules) {
    if (pattern.test(text)) return category;
  }
  return "other";
}

// ── Referral fees ──────────────────────────────────────────────────────────

/** Ordered bands. The first whose ceiling covers the price wins. */
const REFERRAL_BANDS: Record<FeeCategory, { upTo: number; pct: number }[]> = {
  // The 2026 cut applies to Home and not to the categories people assume are
  // the same. Garden and DIY look adjacent and are charged 15% at every price.
  home: [{ upTo: 20, pct: 8 }, { upTo: Infinity, pct: 15 }],
  garden: [{ upTo: Infinity, pct: 15 }],
  diy: [{ upTo: Infinity, pct: 15 }],
  toys: [{ upTo: Infinity, pct: 15 }],
  sports: [{ upTo: Infinity, pct: 15 }],
  office: [{ upTo: Infinity, pct: 15 }],
  pet: [{ upTo: Infinity, pct: 15 }],
  petFood: [{ upTo: 10, pct: 5 }, { upTo: Infinity, pct: 15 }],
  beauty: [{ upTo: 10, pct: 8 }, { upTo: Infinity, pct: 15 }],
  health: [{ upTo: 10, pct: 8 }, { upTo: Infinity, pct: 15 }],
  grocery: [{ upTo: 10, pct: 8 }, { upTo: Infinity, pct: 15 }],
  clothing: [
    { upTo: 15, pct: 5 },
    { upTo: 20, pct: 10 },
    { upTo: Infinity, pct: 15 },
  ],
  electronics: [{ upTo: Infinity, pct: 7 }],
  videoGames: [{ upTo: Infinity, pct: 8 }],
  jewellery: [{ upTo: Infinity, pct: 20 }],
  deviceAccessories: [{ upTo: Infinity, pct: 45 }],
  // Unknown assumes the common rate, never the cheapest.
  other: [{ upTo: Infinity, pct: 15 }],
};

export const MINIMUM_REFERRAL_FEE = 0.25;

/**
 * Amazon adds this on top of referral and fulfilment fees alike, so a quoted
 * 15% referral is really 15.3%. Applied as a multiplier on the fee subtotal in
 * margin.ts rather than as its own line, so a fee type added later cannot
 * escape it.
 */
export const DIGITAL_SERVICES_FEE_PCT = 2;

export function referralFeePctFor(category: FeeCategory, sellPrice: number): number {
  const bands = REFERRAL_BANDS[category] ?? REFERRAL_BANDS.other;
  return (bands.find((b) => sellPrice <= b.upTo) ?? bands[bands.length - 1]).pct;
}

export function referralFee(category: FeeCategory, sellPrice: number): Fee {
  const pct = referralFeePctFor(category, sellPrice);
  const raw = sellPrice * (pct / 100);
  const floored = raw < MINIMUM_REFERRAL_FEE;
  const unknown = category === "other";

  return {
    amount: Math.round(Math.max(raw, MINIMUM_REFERRAL_FEE) * 100) / 100,
    assumed: unknown,
    why: unknown
      ? `Category unknown, so 15% assumed — the common rate, not the cheapest`
      : `${FEE_CATEGORY_LABELS[category]} at £${sellPrice.toFixed(2)} is ${pct}%${
          floored ? `, raised to the £${MINIMUM_REFERRAL_FEE.toFixed(2)} minimum` : ""
        }`,
  };
}

// ── FBA fulfilment ─────────────────────────────────────────────────────────

/**
 * Size tiers, cheapest first. A product pays the first tier it fits inside on
 * every dimension and on weight.
 *
 * Where the published rate is a range, the top of the range is used. The
 * spread is Amazon's own banding within the tier and guessing the bottom of it
 * is the flattering error.
 */
const FBA_TIERS = [
  { name: "Light envelope", mm: [330, 230, 25], maxG: 100, standard: 2.08, lowPrice: 1.7 },
  { name: "Standard envelope", mm: [330, 230, 25], maxG: 460, standard: 2.16, lowPrice: 1.87 },
  { name: "Large envelope", mm: [330, 230, 40], maxG: 960, standard: 2.72, lowPrice: 2.42 },
  { name: "Extra-large envelope", mm: [330, 230, 60], maxG: 960, standard: 2.94, lowPrice: null },
  { name: "Small parcel", mm: [350, 250, 120], maxG: 400, standard: 3.0, lowPrice: 2.7 },
  { name: "Small parcel", mm: [350, 250, 120], maxG: 3900, standard: 3.27, lowPrice: null },
  { name: "Standard parcel", mm: [450, 340, 260], maxG: 11900, standard: 3.58, lowPrice: null },
] as const;

/**
 * Low-Price FBA has two thresholds and the tool has to know the category to
 * pick the right one. Getting it wrong in the optimistic direction is how a
 * product looks viable and is not.
 *
 * Home sits in the £10 list because Amazon's list names Kitchen, and this
 * codebase's `home` covers Home & Kitchen. Treating the whole category as the
 * lower threshold is the conservative reading: it makes Low-Price eligibility
 * harder to claim, and Low-Price is the cheaper rate.
 */
const LOW_PRICE_TEN_POUND: readonly FeeCategory[] = [
  "beauty",
  "health",
  "grocery",
  "office",
  "home",
];

export function lowPriceThresholdFor(category: FeeCategory): number {
  return LOW_PRICE_TEN_POUND.includes(category) ? 10 : 20;
}

/** The tier a product with no known dimensions is charged at. */
const WORST_PLAUSIBLE = FBA_TIERS[FBA_TIERS.length - 1];

export function fbaFee(input: {
  lengthMm?: number | null;
  widthMm?: number | null;
  heightMm?: number | null;
  weightG?: number | null;
  sellPrice: number;
  category: FeeCategory;
}): Fee & { tier: string } {
  const eligibleForLowPrice = input.sellPrice <= lowPriceThresholdFor(input.category);
  const rate = (t: (typeof FBA_TIERS)[number]) =>
    eligibleForLowPrice && t.lowPrice !== null ? t.lowPrice : t.standard;

  const dims = [input.lengthMm, input.widthMm, input.heightMm];
  const haveDims = dims.every((d) => typeof d === "number" && d > 0);
  const haveWeight = typeof input.weightG === "number" && input.weightG > 0;

  if (!haveDims) {
    // Rule 3: assume the expensive case. Weight alone cannot pick a tier —
    // a 200g item can be an envelope or a bulky parcel, and Amazon charges on
    // the box, not the contents.
    return {
      amount: rate(WORST_PLAUSIBLE),
      tier: WORST_PLAUSIBLE.name,
      assumed: true,
      why: `Keepa has no packed dimensions for this product, so it is costed at ${WORST_PLAUSIBLE.name}, the worst plausible tier. Get the real box size from the supplier before trusting this.`,
    };
  }

  // Amazon compares the longest edge to the longest limit, and so on down.
  const sorted = (dims as number[]).slice().sort((a, b) => b - a);
  const weight = haveWeight ? (input.weightG as number) : WORST_PLAUSIBLE.maxG;

  const tier = FBA_TIERS.find((t) => {
    const limits = t.mm.slice().sort((a, b) => b - a);
    return sorted.every((d, i) => d <= limits[i]) && weight <= t.maxG;
  });

  if (!tier) {
    return {
      amount: rate(WORST_PLAUSIBLE),
      tier: "Oversize",
      assumed: true,
      why: `At ${sorted[0]}×${sorted[1]}×${sorted[2]}mm and ${weight}g this is bigger than any standard tier. Costed at ${WORST_PLAUSIBLE.name} as a floor — a real oversize quote will be higher.`,
    };
  }

  return {
    amount: rate(tier),
    tier: tier.name,
    assumed: !haveWeight,
    why: haveWeight
      ? `${tier.name} at ${sorted[0]}×${sorted[1]}×${sorted[2]}mm, ${weight}g${
          eligibleForLowPrice && tier.lowPrice !== null
            ? `. Low-Price FBA applies below £${lowPriceThresholdFor(input.category)}`
            : ""
        }`
      : `${tier.name} on dimensions, but Keepa has no weight, so the tier's ceiling of ${tier.maxG}g is assumed`,
  };
}
