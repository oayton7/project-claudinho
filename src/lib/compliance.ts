/**
 * What importing a product actually obliges you to do.
 *
 * The tool prices Amazon's fees and the landed cost carefully and knew nothing
 * about this, which is a gap with real money in it. **Importing makes you the
 * producer.** Not the Chinese factory, not Amazon — the person who first
 * places the goods on the UK market. That carries registration duties, annual
 * reporting, and record keeping that a bird bath does not attract and a solar
 * light does.
 *
 * Deliberately flags rather than kills. Every obligation here is survivable
 * and most are cheap at small volumes; the failure mode to avoid is finding
 * out after committing £3,000 of stock. Over-blocking is worse than a leak,
 * because a leak is visible and an over-block looks like a quiet market.
 *
 * Verified against gov.uk in August 2026. Thresholds move, so treat the date
 * as an expiry rather than a signature.
 */

export const COMPLIANCE_CHECKED = "2026-08-20";

export type Obligation = {
  /** Short label, for a shortlist row. */
  what: string;
  /** Why it applies to him specifically. */
  why: string;
  /** How much of a problem it actually is at his scale. */
  weight: "admin" | "cost" | "barrier";
};

/**
 * Word-boundary match, because substrings are how this goes wrong.
 *
 * A bare "light" matches "lightweight" and "delighted", and a compliance flag
 * on a lightweight storage box would be a quiet, invisible mistake of exactly
 * the kind that took a morning to find last time.
 */
function mentions(text: string, words: string[]): boolean {
  return words.some((w) => new RegExp(`\\b${w}\\b`, "i").test(text));
}

const ELECTRICAL = [
  "solar",
  "led",
  "lights",
  "light",
  "lamp",
  "lantern",
  "torch",
  "electric",
  "electrical",
  "electronic",
  "rechargeable",
  "cordless",
  "motorised",
  "motorized",
  "heated",
  "heater",
  "speaker",
  "bluetooth",
  "sensor",
  "digital",
  "powered",
];

const BATTERY = [
  "battery",
  "batteries",
  "rechargeable",
  "cordless",
  "solar",
  "aa",
  "aaa",
  "lithium",
  "li-ion",
];

/**
 * Words that mean a child will use it.
 *
 * Split from the toy words on purpose. "Toy" alone is not a children's
 * product: a dog football is filed under "Interactive Toys" and carries none
 * of the duties a child's toy does. The first version flagged it, which is the
 * failure that matters here — a flag on the wrong product is noise, noise gets
 * ignored, and the flag then costs nothing to ignore on the product that
 * genuinely needed it.
 */
const CHILD_WORDS = ["children", "childrens", "kids", "kid", "toddler", "baby", "infant", "nursery"];
const TOY_WORDS = ["toy", "toys", "playset", "jigsaw", "puzzle"];
const PET_WORDS = ["pet", "pets", "dog", "dogs", "cat", "cats", "puppy", "kitten", "canine", "feline"];
/**
 * A product that says it is for adults is not a children's product, even when
 * Amazon files it under Toys & Games. Diamond painting kits sit there and are
 * squarely an adult hobby.
 */
const ADULT_WORDS = ["adult", "adults", "grown-up", "grown-ups"];

/**
 * Reads a candidate's title and category for obligations it would bring.
 *
 * Both are checked because either alone misses: a category names what a thing
 * is for, a title names what it contains, and "Patio Umbrella Lights Solar
 * Powered" is only obviously electrical from the latter.
 */
export function complianceBurden(input: {
  title?: string | null;
  category?: string | null;
}): { obligations: Obligation[]; summary: string } {
  const text = `${input.title ?? ""} ${input.category ?? ""}`.trim();
  if (!text) return { obligations: [], summary: "Nothing to go on." };

  const obligations: Obligation[] = [];
  const electrical = mentions(text, ELECTRICAL);
  const battery = mentions(text, BATTERY);

  if (electrical) {
    obligations.push({
      what: "WEEE producer registration",
      why: "Importing electrical or electronic equipment on a commercial basis makes you the producer. Register with the environmental regulator within 28 days of first placing it on the market, then annually by 31 January. Under 5 tonnes a year you register directly as a small producer rather than paying to join a compliance scheme, and you will be far under 5 tonnes.",
      weight: "admin",
    });
    obligations.push({
      what: "Crossed-out wheelie bin marking",
      why: "EEE has to carry the symbol and be accompanied by reuse and treatment information. That is a supplier brief item, so raise it before tooling rather than after the first container.",
      weight: "admin",
    });
  }

  if (battery) {
    obligations.push({
      what: "Battery producer registration",
      why: "Batteries inside a product still count, and the importer is the producer. Register and report tonnage and chemistry annually. A compliance scheme is only compulsory above 1 tonne of portable batteries a year, which at your volumes is not close.",
      weight: "admin",
    });
  }

  // A toy for an animal is not a toy for a child. Pet wording overrides,
  // because it is the more specific claim.
  const forPets = mentions(text, PET_WORDS);
  const forAdults = mentions(text, ADULT_WORDS) && !mentions(text, CHILD_WORDS);
  const forChildren =
    !forPets &&
    !forAdults &&
    (mentions(text, CHILD_WORDS) || mentions(text, TOY_WORDS));

  if (forChildren) {
    obligations.push({
      what: "Toy safety — needs checking properly",
      why: "Products intended for children carry testing and documentation duties well beyond general product safety, and the cost lands per design rather than per unit. This flag is a prompt to look it up for the specific product, not a statement of what applies.",
      weight: "barrier",
    });
  }

  if (obligations.length === 0) {
    return {
      obligations: [],
      summary:
        "No category-specific producer duties spotted. General product safety still applies, and you still need the supplier's conformity paperwork.",
    };
  }

  const heaviest = obligations.some((o) => o.weight === "barrier")
    ? "barrier"
    : obligations.some((o) => o.weight === "cost")
      ? "cost"
      : "admin";

  return {
    obligations,
    summary:
      heaviest === "admin"
        ? `${obligations.length} producer registration(s) to do, all paperwork rather than cost at your volumes: ${obligations.map((o) => o.what).join(", ")}.`
        : `${obligations.map((o) => o.what).join(", ")}. At least one of these is more than paperwork — read it before committing stock.`,
  };
}

/**
 * The things that apply whatever you sell, stated once.
 *
 * Kept separate from the per-product flags so a shortlist row is not padded
 * with text identical on every line.
 */
export const ALWAYS_APPLIES = [
  "CE marking is still accepted for Great Britain alongside UKCA, indefinitely, under the Product Safety and Metrology (Amendment) Regulations 2024. A great deal of published advice still says otherwise and is out of date.",
  "Packaging producer responsibility needs both more than 25 tonnes of packaging and £1 million of turnover. You are nowhere near either, so it does not apply — but it is worth knowing the number exists.",
  "Whoever imports is the producer. Not the factory and not Amazon.",
] as const;
