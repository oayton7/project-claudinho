import {
  DIGITAL_SERVICES_FEE_PCT,
  FEE_CATEGORIES,
  FEE_CATEGORY_LABELS,
  MINIMUM_REFERRAL_FEE,
  fbaFee as lookUpFbaFee,
  referralFee as lookUpReferralFee,
  referralFeePctFor,
  type FeeCategory,
} from "./fees.ts";

export {
  FEE_CATEGORIES,
  FEE_CATEGORY_LABELS,
  DIGITAL_SERVICES_FEE_PCT,
  MINIMUM_REFERRAL_FEE,
  referralFee,
  referralFeePctFor,
  fbaFee as lookUpFbaFee,
  lowPriceThresholdFor,
  FEE_TABLE_VERSION,
  type Fee,
  type FeeCategory,
} from "./fees.ts";

/**
 * The margin engine.
 *
 * Pure arithmetic, no network calls, no AI. Mirrors section 6 of the plan.
 * Every number this produces should be reproducible by hand on paper.
 */

export type MarginInput = {
  sellPrice: number;
  /**
   * Decides the referral fee together with the price. Leave `referralFeePct`
   * undefined and the table works it out; set it to override the table when
   * you have checked the real figure in Seller Central.
   */
  feeCategory?: FeeCategory;
  /** Overrides the table. Undefined means "use the category and price band". */
  referralFeePct?: number;
  /**
   * Packed dimensions in millimetres, as Keepa reports them. Absent means the
   * FBA fee is assumed at the worst plausible tier and says so — Amazon charges
   * on the box, and weight alone cannot pick a tier.
   */
  packageLengthMm?: number | null;
  packageWidthMm?: number | null;
  packageHeightMm?: number | null;
  packageWeightG?: number | null;
  /** Overrides the FBA lookup when you have the real figure. */
  fbaFee?: number;
  fuelSurchargePct: number;
  storagePerUnit: number;
  fobUnitPrice: number;
  freightPerUnit: number;
  dutyPerUnit: number;
  prepPerUnit: number;
  returnsPct: number;
  adCostPerUnit: number;
  orderQty: number;
  totalCapital: number;
  unitsPerMonth: number;
  vatRatePct: number;
  /**
   * Import VAT charged at the border on goods + freight + duty. Set to 0 only
   * if you genuinely are not paying it. Below the £90k threshold this is
   * irrecoverable and is a real cost; once VAT-registered you reclaim it, so
   * it becomes a cash-flow problem rather than a margin one.
   */
  importVatRatePct: number;
};

export type WaterfallLine = {
  label: string;
  amount: number;
  note?: string;
};

export type Check = {
  label: string;
  actual: string;
  threshold: string;
  pass: boolean;
  /** A failed hard check kills the product outright. */
  hard: boolean;
  note?: string;
};

export type MarginResult = {
  /** What the table decided, so the number on screen can be explained. */
  referralFeePct: number;
  referralFee: number;
  /** The 2% Amazon adds on top of referral and fulfilment fees alike. */
  digitalServicesFee: number;
  fbaFee: number;
  /** Which size tier the fulfilment fee came from. */
  fbaTier: string;
  /**
   * Every figure that rests on a guess rather than a known value. Shown on
   * screen: a number without its provenance is how a tool becomes confidently
   * wrong.
   */
  assumptions: string[];
  /** Includes irrecoverable import VAT. This is what a non-registered seller pays. */
  landedUnitCost: number;
  /** Excludes import VAT, because a registered seller reclaims it. */
  landedUnitCostRegistered: number;
  importVat: number;
  waterfall: WaterfallLine[];
  contribution: number;
  netMarginPct: number;
  contributionVatRegistered: number;
  netMarginVatRegisteredPct: number;
  vatCliffDropPct: number;
  preAdMarginPct: number;
  landedCostPctOfSell: number;
  breakEvenUnits: number;
  cashTiedUp: number;
  daysToPayback: number;
  orderPctOfCapital: number;
  checks: Check[];
  verdict: "TEST" | "PARK" | "KILL";
};

/**
 * Ceiling on what a single first order may take of total capital.
 *
 * Raised from 25% to 40% on 11 Aug 2026, resolving a contradiction in the
 * plan: section 5 set the cap at 25% while section 7 allocated £1,100 of
 * £3,000 to the first bulk order, which is 37%. Both could not hold.
 *
 * 25% was also unworkable in practice. At a realistic landed cost it bought
 * roughly 180 units, below the minimum order quantity most suppliers will
 * accept, so it killed products on MOQ rather than on merit.
 *
 * 40% of £3,000 is £1,200: enough for a 300-unit order at a realistic landed
 * cost, and it still leaves a real second attempt plus the launch ad budget.
 *
 * £3,000 is the working figure and about £5,000 is reachable for a product
 * that earns it (Oscar, 19 Aug 2026). That is why this check has always been
 * a warning rather than a kill: "needs more money than you have today" is a
 * decision, not a fact about the product. What the tool owes him is the cash
 * figure so the decision is informed — see orderCostAtMoq.
 *
 * The cap exists to guarantee a second attempt, not to minimise spend. The
 * plan assumes the first product is probably wrong, and a bigger budget does
 * not change that.
 */
export const CAPITAL_CAP_PCT = 40;

export const DEFAULT_INPUT: MarginInput = {
  sellPrice: 24.99,
  feeCategory: "other",
  referralFeePct: 15,
  fbaFee: 2.9,
  packageLengthMm: null,
  packageWidthMm: null,
  packageHeightMm: null,
  packageWeightG: null,
  fuelSurchargePct: 1.5,
  storagePerUnit: 0.25,
  fobUnitPrice: 4.5,
  freightPerUnit: 1.0,
  dutyPerUnit: 0,
  prepPerUnit: 0.5,
  returnsPct: 4,
  adCostPerUnit: 4.0,
  orderQty: 200,
  totalCapital: 3000,
  unitsPerMonth: 60,
  vatRatePct: 20,
  importVatRatePct: 20,
};

const round = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number) => `${n.toFixed(1)}%`;
const gbp = (n: number) => `£${n.toFixed(2)}`;

export function calculateMargin(input: MarginInput): MarginResult {
  const {
    sellPrice,
    feeCategory = "other",
    fuelSurchargePct,
    storagePerUnit,
    fobUnitPrice,
    freightPerUnit,
    dutyPerUnit,
    prepPerUnit,
    returnsPct,
    adCostPerUnit,
    orderQty,
    totalCapital,
    unitsPerMonth,
    vatRatePct,
    importVatRatePct,
  } = input;

  const assumptions: string[] = [];

  // The tables unless explicitly overridden. An override of 0 is a real answer
  // and must survive, so these check for undefined rather than falsiness.
  const referralFeePct =
    input.referralFeePct ?? referralFeePctFor(feeCategory, sellPrice);
  const referralLookup = lookUpReferralFee(feeCategory, sellPrice);
  const referralFee =
    input.referralFeePct === undefined
      ? referralLookup.amount
      : Math.max(sellPrice * (referralFeePct / 100), MINIMUM_REFERRAL_FEE);
  if (input.referralFeePct === undefined && referralLookup.assumed) {
    assumptions.push(`Referral fee: ${referralLookup.why}`);
  }

  const fbaLookup = lookUpFbaFee({
    lengthMm: input.packageLengthMm,
    widthMm: input.packageWidthMm,
    heightMm: input.packageHeightMm,
    weightG: input.packageWeightG,
    sellPrice,
    category: feeCategory,
  });
  const fbaFee = input.fbaFee ?? fbaLookup.amount;
  const fbaTier = input.fbaFee === undefined ? fbaLookup.tier : "entered by hand";
  if (input.fbaFee === undefined && fbaLookup.assumed) {
    assumptions.push(`FBA fee: ${fbaLookup.why}`);
  }

  const fuelSurcharge = fbaFee * (fuelSurchargePct / 100);

  // Charged on Amazon's fees, not on the sale. Kept as one line computed from
  // the subtotal so a fee type added later is covered without being remembered.
  const digitalServicesFee =
    (referralFee + fbaFee + fuelSurcharge) * (DIGITAL_SERVICES_FEE_PCT / 100);

  // Import VAT is charged on goods + freight + duty at the border. Prep is a
  // UK service billed separately, so it sits outside this base.
  const importVat =
    (fobUnitPrice + freightPerUnit + dutyPerUnit) * (importVatRatePct / 100);

  // The two VAT states have genuinely different landed costs. Below the
  // threshold you cannot reclaim import VAT, so it is a real cost. Once
  // registered you reclaim it and it drops out of the margin entirely.
  const landedUnitCostRegistered =
    fobUnitPrice + freightPerUnit + dutyPerUnit + prepPerUnit;
  const landedUnitCost = landedUnitCostRegistered + importVat;

  const returnsProvision = sellPrice * (returnsPct / 100);

  // Output VAT is the VAT element inside a VAT-inclusive shelf price, so it is
  // backed out of the price rather than added on top.
  const outputVat = sellPrice - sellPrice / (1 + vatRatePct / 100);

  const beforeReturnsAndAds =
    sellPrice -
    referralFee -
    fbaFee -
    fuelSurcharge -
    digitalServicesFee -
    storagePerUnit -
    landedUnitCost;

  const contribution = beforeReturnsAndAds - returnsProvision - adCostPerUnit;

  // Registered: you owe output VAT, but you get the import VAT back. Both
  // legs matter — modelling only the output VAT overstates the cliff.
  const contributionVatRegistered = contribution - outputVat + importVat;

  const netMarginPct = sellPrice > 0 ? (contribution / sellPrice) * 100 : 0;
  const netMarginVatRegisteredPct =
    sellPrice > 0 ? (contributionVatRegistered / sellPrice) * 100 : 0;
  const preAdMarginPct =
    sellPrice > 0 ? (beforeReturnsAndAds / sellPrice) * 100 : 0;
  const landedCostPctOfSell =
    sellPrice > 0 ? (landedUnitCost / sellPrice) * 100 : 0;

  const vatCliffDropPct =
    contribution > 0
      ? ((contribution - contributionVatRegistered) / contribution) * 100
      : 0;

  const cashTiedUp = landedUnitCost * orderQty;
  const breakEvenUnits =
    contribution > 0 ? Math.ceil(cashTiedUp / contribution) : Infinity;
  const daysToPayback =
    unitsPerMonth > 0 && Number.isFinite(breakEvenUnits)
      ? Math.ceil((breakEvenUnits / unitsPerMonth) * 30)
      : Infinity;
  const orderPctOfCapital =
    totalCapital > 0 ? (cashTiedUp / totalCapital) * 100 : 0;

  const waterfall: WaterfallLine[] = [
    { label: "Sell price", amount: sellPrice },
    {
      label: `Referral fee (${referralFeePct}%)`,
      amount: -referralFee,
      note:
        input.referralFeePct === undefined
          ? `${FEE_CATEGORY_LABELS[feeCategory]} at £${sellPrice.toFixed(2)}${referralFee === MINIMUM_REFERRAL_FEE ? ", raised to the £0.25 minimum" : ""}`
          : "Overridden by hand, not from the fee table",
    },
    {
      label: "FBA fulfilment",
      amount: -fbaFee,
      note:
        input.fbaFee === undefined
          ? fbaLookup.why
          : "Entered by hand, not from the size tiers",
    },
    {
      label: `Fuel & logistics surcharge (${fuelSurchargePct}%)`,
      amount: -fuelSurcharge,
      note: "Charged on the fulfilment fee, not the sell price",
    },
    {
      label: `Digital Services Fee (${DIGITAL_SERVICES_FEE_PCT}%)`,
      amount: -digitalServicesFee,
      note: "Charged on Amazon's fees rather than on the sale, so a quoted 15% referral is really 15.3%",
    },
    { label: "Storage while held", amount: -storagePerUnit },
    {
      label: "Landed unit cost",
      amount: -landedUnitCostRegistered,
      note: `FOB ${gbp(fobUnitPrice)} + freight ${gbp(freightPerUnit)} + duty ${gbp(dutyPerUnit)} + prep ${gbp(prepPerUnit)}`,
    },
    {
      label: `Import VAT (${importVatRatePct}%)`,
      amount: -importVat,
      note: "Charged at the border on goods, freight and duty. You cannot reclaim this until you are VAT-registered, so below £90k it is a real cost",
    },
    { label: `Returns provision (${returnsPct}%)`, amount: -returnsProvision },
    {
      label: "Advertising per unit sold",
      amount: -adCostPerUnit,
      note: "The line beginners forget",
    },
  ];

  const checks: Check[] = [
    {
      label: "Sell price above the floor",
      actual: gbp(sellPrice),
      threshold: "≥ £12.00",
      pass: sellPrice >= 12,
      hard: true,
    },
    {
      label: "Landed cost as share of sell price",
      actual: pct(landedCostPctOfSell),
      threshold: "≤ 30%",
      pass: landedCostPctOfSell <= 30,
      hard: true,
    },
    {
      label: "Margin before returns and advertising",
      actual: pct(preAdMarginPct),
      threshold: "≥ 35%",
      pass: preAdMarginPct >= 35,
      hard: true,
    },
    {
      label: "Net margin after advertising",
      actual: pct(netMarginPct),
      threshold: "≥ 15%",
      pass: netMarginPct >= 15,
      hard: true,
    },
    {
      label: "Net margin if VAT-registered",
      actual: pct(netMarginVatRegisteredPct),
      threshold: "≥ 15%",
      pass: netMarginVatRegisteredPct >= 15,
      hard: false,
      note: "A warning, not a kill. Both legs of registration are now modelled — you owe output VAT but reclaim import VAT — so this figure is honest rather than pessimistic. A product that only works below £90k still needs a repricing plan before you get there.",
    },
    {
      label: "Days to pay back the first order",
      actual: Number.isFinite(daysToPayback) ? `${daysToPayback} days` : "never",
      threshold: "≤ 90 days",
      pass: daysToPayback <= 90,
      hard: false,
    },
    {
      label: "First order (landed) as share of capital",
      actual: pct(orderPctOfCapital),
      threshold: `≤ ${CAPITAL_CAP_PCT}%`,
      pass: orderPctOfCapital <= CAPITAL_CAP_PCT,
      hard: false,
      note: "Measured on landed cost, not supplier cost, which is the conservative reading. The point of the cap is not to spend little — it is to guarantee you get a second attempt. Cut the order quantity rather than the cap.",
    },
  ];

  const hardFailure = checks.some((c) => c.hard && !c.pass);
  const softFailure = checks.some((c) => !c.hard && !c.pass);
  const verdict: MarginResult["verdict"] = hardFailure
    ? "KILL"
    : softFailure
      ? "PARK"
      : "TEST";

  return {
    referralFeePct,
    fbaFee: round(fbaFee),
    fbaTier,
    assumptions,
    referralFee: round(referralFee),
    digitalServicesFee: round(digitalServicesFee),
    landedUnitCost: round(landedUnitCost),
    landedUnitCostRegistered: round(landedUnitCostRegistered),
    importVat: round(importVat),
    waterfall: waterfall.map((l) => ({ ...l, amount: round(l.amount) })),
    contribution: round(contribution),
    netMarginPct: round(netMarginPct),
    contributionVatRegistered: round(contributionVatRegistered),
    netMarginVatRegisteredPct: round(netMarginVatRegisteredPct),
    vatCliffDropPct: round(vatCliffDropPct),
    preAdMarginPct: round(preAdMarginPct),
    landedCostPctOfSell: round(landedCostPctOfSell),
    breakEvenUnits,
    cashTiedUp: round(cashTiedUp),
    daysToPayback,
    orderPctOfCapital: round(orderPctOfCapital),
    checks,
    verdict,
  };
}

/**
 * The keys a numeric form field may bind to. Excludes the category, which is a
 * string, and the packed dimensions, which are nullable and come from Keepa
 * rather than being typed in.
 */
export type EditableNumericField = Exclude<
  NumericField,
  "packageLengthMm" | "packageWidthMm" | "packageHeightMm" | "packageWeightG"
>;

/**
 * Only the keys that genuinely hold a number, so the loop below stays typed.
 * feeCategory is a string and referralFeePct is now optional, so both are
 * handled separately after it.
 */
type NumericField = {
  [K in keyof MarginInput]-?: NonNullable<MarginInput[K]> extends number
    ? K
    : never;
}[keyof MarginInput];

/** Required in every posted body. Optional fields are handled after the loop. */
const NUMERIC_FIELDS: Exclude<
  NumericField,
  | "referralFeePct"
  | "fbaFee"
  | "packageLengthMm"
  | "packageWidthMm"
  | "packageHeightMm"
  | "packageWeightG"
>[] = [
  "sellPrice",
  "fuelSurchargePct",
  "storagePerUnit",
  "fobUnitPrice",
  "freightPerUnit",
  "dutyPerUnit",
  "prepPerUnit",
  "returnsPct",
  "adCostPerUnit",
  "orderQty",
  "totalCapital",
  "unitsPerMonth",
  "vatRatePct",
  "importVatRatePct",
];

/**
 * Never trust what arrives over HTTP. Anyone can post anything to the API
 * route, so every field is checked before it reaches the maths.
 */
export function parseMarginInput(
  body: unknown,
): { ok: true; value: MarginInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (typeof body !== "object" || body === null) {
    return { ok: false, errors: ["Body must be a JSON object"] };
  }

  const raw = body as Record<string, unknown>;
  const value = {} as MarginInput;

  for (const field of NUMERIC_FIELDS) {
    const n = Number(raw[field]);
    if (raw[field] === undefined || raw[field] === "" || Number.isNaN(n)) {
      errors.push(`${field} must be a number`);
      continue;
    }
    if (n < 0) {
      errors.push(`${field} cannot be negative`);
      continue;
    }
    value[field] = n;
  }

  // The category picks the referral fee, so an unrecognised one must not fall
  // through to a cheap default. Missing is fine and means "other".
  if (raw.feeCategory !== undefined && raw.feeCategory !== "") {
    if (!FEE_CATEGORIES.includes(raw.feeCategory as FeeCategory)) {
      errors.push(
        `feeCategory must be one of: ${FEE_CATEGORIES.join(", ")}`,
      );
    } else {
      value.feeCategory = raw.feeCategory as FeeCategory;
    }
  }

  // Optional by design: absent means the tables decide. Present means the user
  // checked Seller Central and is overriding them.
  if (raw.fbaFee !== undefined && raw.fbaFee !== "") {
    const fee = Number(raw.fbaFee);
    if (Number.isNaN(fee) || fee < 0) {
      errors.push("fbaFee must be a number, or left out entirely");
    } else {
      value.fbaFee = fee;
    }
  }

  if (raw.referralFeePct !== undefined && raw.referralFeePct !== "") {
    const pct = Number(raw.referralFeePct);
    if (Number.isNaN(pct) || pct < 0) {
      errors.push("referralFeePct must be a number, or left out entirely");
    } else {
      value.referralFeePct = pct;
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}

/**
 * The margin engine run backwards.
 *
 * At scout time you know the shelf price but not the supplier price, so
 * `calculateMargin` cannot help: its most important input is the one thing you
 * have not got. Solving for it instead turns that gap into the useful number.
 *
 * Given a sell price and the fees, this returns the most you can pay to get one
 * unit into an Amazon warehouse and still clear your margin threshold. That is
 * the figure to take to a supplier: not "what do you charge" but "I need to
 * land these under £4.20, can you do it".
 *
 * Two constraints bind, and the tighter one wins:
 *   1. the net margin floor, and
 *   2. the hard rule that landed cost stays under 30% of the sell price.
 *
 * Returns landed cost, which includes irrecoverable import VAT. Freight, duty
 * and prep still have to come out of it before you reach the FOB price a
 * supplier quotes.
 */
export function maxLandedCost(
  sellPrice: number,
  opts: {
    feeCategory?: FeeCategory;
    referralFeePct?: number;
    fbaFee?: number;
    packageLengthMm?: number | null;
    packageWidthMm?: number | null;
    packageHeightMm?: number | null;
    packageWeightG?: number | null;
    fuelSurchargePct?: number;
    storagePerUnit?: number;
    returnsPct?: number;
    adCostPerUnit?: number;
    targetNetMarginPct?: number;
  } = {},
): { landed: number; bindingConstraint: "margin" | "landed cost cap" } {
  const {
    feeCategory = "other",
    fuelSurchargePct = DEFAULT_INPUT.fuelSurchargePct,
    storagePerUnit = DEFAULT_INPUT.storagePerUnit,
    returnsPct = DEFAULT_INPUT.returnsPct,
    adCostPerUnit = DEFAULT_INPUT.adCostPerUnit,
    targetNetMarginPct = 15,
  } = opts;

  const referralFee =
    opts.referralFeePct === undefined
      ? lookUpReferralFee(feeCategory, sellPrice).amount
      : Math.max(sellPrice * (opts.referralFeePct / 100), MINIMUM_REFERRAL_FEE);

  // Same treatment as the forward calculation: no dimensions means the worst
  // plausible tier, so the ceiling this returns is conservative rather than
  // flattering. A supplier brief built on a flattering ceiling is worthless.
  const fbaFee =
    opts.fbaFee ??
    lookUpFbaFee({
      lengthMm: opts.packageLengthMm,
      widthMm: opts.packageWidthMm,
      heightMm: opts.packageHeightMm,
      weightG: opts.packageWeightG,
      sellPrice,
      category: feeCategory,
    }).amount;
  const fuelSurcharge = fbaFee * (fuelSurchargePct / 100);
  const digitalServicesFee =
    (referralFee + fbaFee + fuelSurcharge) * (DIGITAL_SERVICES_FEE_PCT / 100);

  const fromMargin =
    sellPrice -
    referralFee -
    fbaFee -
    fuelSurcharge -
    digitalServicesFee -
    storagePerUnit -
    sellPrice * (returnsPct / 100) -
    adCostPerUnit -
    sellPrice * (targetNetMarginPct / 100);

  // The 30% rule is a hard check in calculateMargin, so a product that passes
  // on margin alone can still fail here. Report whichever bites first.
  const fromCap = sellPrice * 0.3;

  return fromMargin <= fromCap
    ? { landed: round(Math.max(0, fromMargin)), bindingConstraint: "margin" }
    : { landed: round(Math.max(0, fromCap)), bindingConstraint: "landed cost cap" };
}

/**
 * What a first order costs, at the MOQs suppliers actually quote.
 *
 * The capital cap has always been a warning rather than a kill, because
 * "needs more money than you have" is a decision rather than a fact — Oscar
 * can find more for a product worth funding. But that decision needs a
 * number, and until now the tool gave a percentage.
 *
 * This turns it into cash. Priced at the landed ceiling rather than a guessed
 * supplier price: the ceiling is the most a unit could cost and still clear
 * the margin floor, so this is the worst case that still works. A real quote
 * below the ceiling only makes it cheaper.
 */
export function orderCostAtMoq(
  maxLanded: number,
  capital: number,
  quantities: number[] = [100, 300, 500, 1000],
): {
  units: number;
  cost: number;
  pctOfCapital: number;
  withinCap: boolean;
  shortfall: number;
}[] {
  return quantities.map((units) => {
    const cost = Math.round(maxLanded * units * 100) / 100;
    const pct = capital > 0 ? (cost / capital) * 100 : 0;
    return {
      units,
      cost,
      pctOfCapital: Math.round(pct * 10) / 10,
      withinCap: pct <= CAPITAL_CAP_PCT,
      // What you would need to find to make this order at this quantity,
      // staying inside the cap. Zero when it already fits.
      shortfall:
        pct <= CAPITAL_CAP_PCT
          ? 0
          : Math.round((cost / (CAPITAL_CAP_PCT / 100) - capital) * 100) / 100,
    };
  });
}
