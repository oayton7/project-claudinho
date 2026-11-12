/**
 * Getting the goods here, and what that leaves for the factory.
 *
 * The tool has always reported a landed ceiling: the most a unit can cost by
 * the time it reaches the warehouse. That is the right number for the margin
 * engine and the wrong number for a supplier conversation, because a factory
 * quotes FOB — the price at their port, before anything is shipped. Comparing
 * an FOB quote against a landed ceiling is how you end up underwater, and the
 * gap between them is mostly decided by one thing nobody looks at: the size of
 * the box.
 *
 * Where these numbers come from, stated honestly:
 *
 * - **The freight rate is a guess, not a quote.** Searching in November 2026
 *   returned $55 to $300 per CBM for LCL China to UK, and the spread is
 *   because some figures are port to port and others door to door. Every
 *   source was a freight forwarder's own marketing page, which is somebody
 *   selling something. £180 is a number this file picked near the pessimistic
 *   end of the door-to-door range, not a figure anybody quoted. Treat it as a
 *   placeholder until a forwarder gives you a real rate for a real carton, and
 *   then change it: it is one constant and everything downstream follows.
 * - China has no free trade agreement with the UK, so standard tariff rates
 *   apply. Homeware and garden goods sit around 0 to 6.5% depending on the
 *   ten-digit commodity code. 5% is used as the planning assumption.
 * - Anti-dumping duty is the trap: a code you think is 6% can carry a trade
 *   remedy on top, and those run to tens of percent. It cannot be guessed from
 *   a product description, so it is flagged rather than modelled.
 *
 * The duty figure has better provenance than the freight one — the absence of
 * a UK-China trade agreement is a fact, and the 0 to 6.5% band for homeware
 * appears consistently — but the only authority is the ten-digit code on
 * gov.uk/trade-tariff.
 *
 * Every figure is an estimate until a forwarder quotes. The point is to stop
 * the tool quietly pretending freight is free.
 */

export const FREIGHT_CHECKED = "2026-11-12";

/**
 * Door-to-door LCL, pounds per cubic metre.
 *
 * A placeholder chosen near the pessimistic end of what forwarders advertise,
 * not a quote. Replace it the day you have a real one.
 */
export const FREIGHT_PER_CBM = 180;

/** Planning assumption for homeware and garden goods. Check the real code. */
export const DEFAULT_DUTY_PCT = 5;

/** What a prep centre charges to receive, label and forward one unit. */
export const PREP_PER_UNIT = 0.5;

/**
 * Cubic metres for one unit's packed box.
 *
 * Volumetric rather than weight, because sea freight is sold by space. A light
 * bulky product is expensive twice: once on the water and again in the FBA
 * size tier.
 */
export function boxCbm(dims: {
  lengthMm?: number | null;
  widthMm?: number | null;
  heightMm?: number | null;
}): number | null {
  const { lengthMm, widthMm, heightMm } = dims;
  if (!lengthMm || !widthMm || !heightMm) return null;
  return (lengthMm / 1000) * (widthMm / 1000) * (heightMm / 1000);
}

/**
 * Sea freight for one unit, with the assumption stated.
 *
 * No dimensions means no estimate rather than a flattering zero. Everywhere
 * else in this tool a missing measurement produces the expensive case, and
 * pretending freight is free would do the opposite.
 */
export function freightPerUnit(
  dims: Parameters<typeof boxCbm>[0],
  perCbm = FREIGHT_PER_CBM,
): { amount: number | null; cbm: number | null; why: string } {
  const cbm = boxCbm(dims);
  if (cbm === null) {
    return {
      amount: null,
      cbm: null,
      why: "No packed dimensions, so freight cannot be estimated. Ask the supplier for the carton size and how many units fit in one.",
    };
  }
  const amount = Math.round(cbm * perCbm * 100) / 100;
  return {
    amount,
    cbm: Math.round(cbm * 100000) / 100000,
    why: `${(cbm * 1000).toFixed(1)} litres a unit at £${perCbm} per cubic metre, door to door.`,
  };
}

/**
 * The most you can pay the factory, which is the number for the brief.
 *
 * Works backwards from the landed ceiling the margin engine produces:
 *
 *   landed (includes irrecoverable import VAT below the threshold)
 *     less import VAT          → landed, ex-VAT
 *     less prep                → cost at the UK door
 *     less freight             → cost at the Chinese port, plus duty
 *     less duty on (FOB + freight)
 *     = FOB
 *
 * Returns null where the box size is unknown, because the honest answer then
 * is that nobody can say.
 */
export function fobCeiling(input: {
  landedCeiling: number;
  dims: Parameters<typeof boxCbm>[0];
  dutyPct?: number;
  importVatPct?: number;
  /** Below the VAT threshold import VAT is a real cost; registered, it is not. */
  vatRegistered?: boolean;
  perCbm?: number;
}): {
  fob: number | null;
  freight: number | null;
  duty: number | null;
  cbm: number | null;
  why: string;
  assumptions: string[];
} {
  const {
    landedCeiling,
    dims,
    dutyPct = DEFAULT_DUTY_PCT,
    importVatPct = 20,
    vatRegistered = false,
    perCbm = FREIGHT_PER_CBM,
  } = input;

  const f = freightPerUnit(dims, perCbm);
  const assumptions = [
    `Freight at £${perCbm} per cubic metre door to door. This is a placeholder near the pessimistic end of advertised LCL rates, not a quote — replace it once a forwarder prices your actual carton.`,
    `Duty at ${dutyPct}%, the planning figure for homeware. Your ten-digit commodity code decides the real rate, and some codes carry anti-dumping duty on top.`,
    `Prep at £${PREP_PER_UNIT.toFixed(2)} a unit.`,
  ];

  if (f.amount === null) {
    return { fob: null, freight: null, duty: null, cbm: null, why: f.why, assumptions };
  }

  // Below the threshold the landed ceiling carries irrecoverable import VAT.
  const exVat = vatRegistered ? landedCeiling : landedCeiling / (1 + importVatPct / 100);
  const atUkDoor = exVat - PREP_PER_UNIT;
  // Duty is charged on goods plus freight, so FOB falls out of one equation
  // rather than being guessed at: atUkDoor = fob + freight + duty(fob+freight).
  const beforeDuty = atUkDoor / (1 + dutyPct / 100);
  const fob = Math.round((beforeDuty - f.amount) * 100) / 100;
  const duty = Math.round((beforeDuty * (dutyPct / 100)) * 100) / 100;

  return {
    fob,
    freight: f.amount,
    duty,
    cbm: f.cbm,
    assumptions,
    why:
      fob <= 0
        ? `Freight and duty alone exceed the landed ceiling. At ${(f.cbm! * 1000).toFixed(1)} litres a unit this product cannot be imported profitably at this price, whatever the factory charges.`
        : `Of a £${landedCeiling.toFixed(2)} landed ceiling, £${f.amount.toFixed(2)} is freight and £${duty.toFixed(2)} is duty, leaving £${fob.toFixed(2)} to pay the factory.`,
  };
}
