/**
 * The margin engine.
 *
 * Pure arithmetic, no network calls, no AI. Mirrors section 6 of the plan.
 * Every number this produces should be reproducible by hand on paper.
 */

export type MarginInput = {
  sellPrice: number;
  referralFeePct: number;
  fbaFee: number;
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
 * 40% of £3,000 is £1,200: enough for a 300-unit order, and it still leaves
 * a real second attempt plus the launch ad budget. The cap exists to
 * guarantee a second attempt, not to minimise spend — the plan assumes the
 * first product is probably wrong.
 */
export const CAPITAL_CAP_PCT = 40;

export const DEFAULT_INPUT: MarginInput = {
  sellPrice: 24.99,
  referralFeePct: 15,
  fbaFee: 2.9,
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
    referralFeePct,
    fbaFee,
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

  const referralFee = sellPrice * (referralFeePct / 100);
  const fuelSurcharge = fbaFee * (fuelSurchargePct / 100);

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
    { label: `Referral fee (${referralFeePct}%)`, amount: -referralFee },
    { label: "FBA fulfilment", amount: -fbaFee },
    {
      label: `Fuel & logistics surcharge (${fuelSurchargePct}%)`,
      amount: -fuelSurcharge,
      note: "Charged on the fulfilment fee, not the sell price",
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

const NUMERIC_FIELDS: (keyof MarginInput)[] = [
  "sellPrice",
  "referralFeePct",
  "fbaFee",
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

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}
