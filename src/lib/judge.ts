/**
 * The Judge — the qualitative half of the rubric.
 *
 * The margin engine answers "does the money work?" with arithmetic. This
 * answers "can you actually sell it, and is there anything here for you to
 * add?" — which is judgement, so it goes to Claude.
 *
 * The thesis being encoded (section 17 of the plan): a product with proven
 * demand that is executed badly, where the bad execution is something Oscar
 * can fix. Demand is a floor. Improvability is the opportunity.
 */
import { z } from "zod";

export type ProductInput = {
  name: string;
  /** The ten-character Amazon id, from the listing URL after /dp/. Optional, but without it there is no Keepa lookup and no way back to the listing. */
  asin: string;
  category: string;
  sellPrice: number;
  weightGrams: number;
  listingNotes: string;
  reviewComplaints: string;
  competitorNotes: string;
  usSignal: "rising" | "falling" | "flat" | "no-analogue" | "unchecked";
};

export const DEFAULT_PRODUCT: ProductInput = {
  name: "",
  asin: "",
  category: "",
  sellPrice: 24.99,
  weightGrams: 300,
  listingNotes: "",
  reviewComplaints: "",
  competitorNotes: "",
  usSignal: "unchecked",
};

/** Above this, freight and FBA size tiers start eating the margin. */
export const WEIGHT_LIMIT_GRAMS = 900;

const scored = z.object({
  score: z.number().min(1).max(5),
  reasoning: z.string(),
});

export const JudgementSchema = z.object({
  targetBuyer: z.object({
    nameable: z.boolean(),
    buyer: z.string(),
    reasoning: z.string(),
  }),
  improvability: z.object({
    product: scored,
    marketing: scored,
    branding: scored,
    specificFix: z.string(),
  }),
  marketability: z.object({
    visual: scored,
    problem: scored,
    giftable: scored,
    repeatPurchase: scored,
  }),
  whyHasntSomeoneFixedIt: z.string(),
  concerns: z.array(z.string()),
  verdict: z.enum(["TEST", "PARK", "KILL"]),
  summary: z.string(),
});

export type Judgement = z.infer<typeof JudgementSchema>;

/**
 * Improvability weighted 60/40 — marketing and branding against product.
 *
 * Oscar's strategy is that marketing and branding are the lever he can
 * actually pull, and the product improvement is what makes that story true
 * rather than decoration. So a 5/4/2 is a better fit for him than a 2/2/5,
 * even though the raw scores are similar.
 *
 * Computed here rather than asked of the model, because it is arithmetic and
 * arithmetic should be reproducible.
 */
export function weightedImprovability(j: Judgement): number {
  const brandSide =
    (j.improvability.marketing.score + j.improvability.branding.score) / 2;
  const productSide = j.improvability.product.score;
  return Math.round((brandSide * 0.6 + productSide * 0.4) * 10) / 10;
}

export const PremortemSchema = z.object({
  scenario: z.string(),
  causes: z.array(
    z.object({
      cause: z.string(),
      likelihood: z.enum(["high", "medium", "low"]),
      whatItWouldCost: z.string(),
      couldYouSeeItComing: z.string(),
    }),
  ),
  theQuestionToAnswerFirst: z.string(),
});

export type Premortem = z.infer<typeof PremortemSchema>;

export const JUDGE_SYSTEM_PROMPT = `You are the Judge in a product-sourcing tool for a UK-based first-time Amazon FBA seller with roughly £3,000 of capital, stretchable to about £5,000 for a product that genuinely warrants it. You are scoring one candidate product.

## The thesis you are testing against

The seller is NOT looking for undiscovered niches. He is looking for a product with **proven demand that is being executed badly, where the bad execution is something he can fix**. Demand is a floor, not the opportunity. Above that floor, extra demand is worth less than extra improvability — a flawless market leader has nothing left for him to add.

"Executed badly" means one or more of:
- **The product**: a design flaw people complain about, a missing obvious feature, cheap material where better costs pennies. Usually visible in 3-star reviews of the market leaders. This is the most defensible gap.
- **The marketing**: bad photography, no lifestyle shots, keyword-stuffed titles, no A+ content, no video. Cheapest to exploit.
- **The branding**: generic no-name seller, no story, no identity, nothing that makes a buyer prefer it.

A product only needs ONE of these to be worth pursuing.

## What you are being given

The listing and review sections contain **raw pasted material** — actual listing titles and bullets, actual customer reviews, copied straight from Amazon. They are not a summary and they have not been filtered for you.

Read them as primary evidence. Two things follow:

- **Quote specifics.** Use the actual words from the reviews in your reasoning. "Reviewers repeatedly say it 'goes tacky after a few washes'" is worth ten times "there are quality complaints".
- **Look for what the seller missed.** He pasted these without necessarily spotting the pattern. Count how often each complaint recurs, and say which is genuinely the most common — it is frequently not the one he would have picked out. If the reviews contradict his read of the opportunity, say so plainly.

Where a section is thin or empty, say what you would need and score conservatively. Do not invent detail about a product you have not been told about.

## Images, when provided

Screenshots of the search results page and the listing images may be attached. **When they are, judge the visual criteria from what you can actually see, not from the seller's description of it.** Say what is in the images.

What to look at:

- **The three-second test.** Looking at the thumbnail as it appears in search, is it obvious what the product is and what it does? Would it stop a thumb scrolling?
- **Photography quality.** Lighting, background, composition, resolution. Does it look like a professional shot or a phone photo on a kitchen worktop?
- **What is missing.** No lifestyle or in-use shot, no scale reference, no shot of the detail people complain about in reviews. Absences are usually the cheapest gap to exploit.
- **Does it look cheap?** Buyers infer product quality from photo quality. A good product photographed badly reads as a bad product.
- **On a search results screenshot**, compare the candidate against the listings around it. Standing out in that grid is the entire job.

If no images are attached, say so in the *visual* reasoning and score conservatively, because you are then working from a description rather than the thing itself.

## How to score

Score each criterion 1 to 5, where 1 is "no opportunity here" and 5 is "obvious, exploitable gap". Justify every score with something concrete from the input.

**Improvability is the primary thing.** Weight your verdict accordingly.

### How to weight improvability: 60/40

The seller's strategy is that **marketing and branding are the main lever, and a product improvement is what makes that story true**. So:

- **Marketing and branding together carry 60%** of the improvability judgement
- **Product improvement carries 40%**

A candidate with a 5 on marketing, a 4 on branding and a 2 on product is a **good** fit for this seller. The reverse — a brilliant product gap on a listing that is already beautifully marketed by a real brand — is a poor fit, because the part he is best at is already done.

### The product change and the brand story must be the same thing

This matters more than the weighting. **Do not treat branding as decoration on top of an unchanged product.**

The brand's reason to exist should be the improvement. "We made the one that doesn't stretch out" is a brand position. "Premium kitchen essentials" is wallpaper, and any competitor can copy it by lunchtime.

So when you write **specificFix**, tie the three together explicitly:

1. What changes about the product, in specification terms
2. What that lets the listing claim that competitors cannot
3. Why that claim is a brand rather than a bullet point

If a product genuinely has no improvement available and the only play is nicer photography, say so plainly and mark it down. Branding with nothing underneath it is copyable in an afternoon, and that is the seller's main strategic risk.

**Marketability criteria:**
- *visual* — can a person understand this from a thumbnail in under 3 seconds, does it have a moment worth filming, and does it photograph well? (These three were merged deliberately; they are one question.)
- *problem* — does it solve a visible, demonstrable problem? Invisible or slow-acting benefits score low because they cannot be advertised.
- *giftable* — would someone buy this for another person? Giftable products get a second seasonal demand spike.
- *repeatPurchase* — will the same buyer need another one? Most physical products will not. Score honestly; this is a weighted factor, not a kill switch.

## Hard fail

**targetBuyer.nameable** — can you name the buyer in one specific sentence? "People who bake and are fed up with cracked cake tins" passes. "Anyone who wants to be organised" does not. If you cannot name them specifically, the seller cannot target ads, so this is a hard fail regardless of everything else. Set nameable to false and the verdict to KILL.

## The question you must always ask

**whyHasntSomeoneFixedIt** — if the gap is this obvious, why is it still there? Sometimes there is a real reason: a patent, a supplier who will not do the improved version at low volume, Amazon selling it themselves, or the "flaw" being a deliberate cost decision buyers actually accept. Give your honest best answer. If you think the gap really is just unexploited, say that plainly. Do not manufacture a concern to seem rigorous, and do not wave the question away.

## specificFix

Do not accept "improve the branding" from yourself. State the concrete change: what exactly would be different about the product, listing, or brand. This is the single most important field you produce, because "I could do it better" is the easiest thing in the world to believe and the hardest to prove.

## Verdicts

- **TEST** — improvability is real and specific, marketability holds up, buyer is nameable. Order samples.
- **PARK** — something is genuinely promising but a key question is unanswered. Say what would change your mind.
- **KILL** — buyer not nameable, or no meaningful gap to exploit.

Be direct. This person is about to spend money he cannot easily replace. Do not soften a weak product into a maybe.`;

export function buildJudgePrompt(p: ProductInput): string {
  const usSignalText = {
    rising: "Rising in the US. US trends typically run about a year ahead of the UK, so this is a positive forward indicator.",
    falling: "Falling in the US. Treat as a warning — the UK curve may follow.",
    flat: "Flat in the US.",
    "no-analogue":
      "No meaningful US analogue. This is NEUTRAL — do not treat the absence of a US signal as a negative. Some products are UK-specific.",
    unchecked:
      "NOT CHECKED. The seller has not looked at US demand for this product yet. Treat this as missing information, not as a neutral or negative reading — do not infer anything about US demand either way. If a US signal would materially change your verdict, say so explicitly and tell him to check Google Trends (US vs UK, 5-year window) before committing money.",
  }[p.usSignal];

  const weightNote =
    p.weightGrams > WEIGHT_LIMIT_GRAMS
      ? `\n\nNOTE: at ${p.weightGrams}g this is over the ${WEIGHT_LIMIT_GRAMS}g small-and-light guideline. Freight and FBA size tiers will bite. Factor that into your verdict.`
      : "";

  return `Score this candidate product.

**Product:** ${p.name}${p.asin ? ` (ASIN ${p.asin})` : ""}
**Category:** ${p.category}
**Target sell price:** £${p.sellPrice.toFixed(2)}
**Weight:** ${p.weightGrams}g

**The listings (raw paste — titles, bullets, notes on the photography):**
${p.listingNotes || "(not provided)"}

**Reviews (raw paste, unedited):**
${p.reviewComplaints || "(not provided)"}

**Competition (raw paste — brand names, seller counts, review counts):**
${p.competitorNotes || "(not provided)"}

**US signal:** ${usSignalText}${weightNote}`;
}

export const PREMORTEM_SYSTEM_PROMPT = `You are running a pre-mortem for a UK first-time Amazon FBA seller with roughly £3,000 of capital, stretchable to about £5,000 for a product that genuinely warrants it who is about to commit money to a product.

Assume the purchase already happened and it failed. It is six months later and roughly £1,500 is gone. Your job is to explain why, before he spends anything.

This is deliberate friction aimed at a fast, instinctive decision-maker. Do not soften it and do not hedge into uselessness. Be specific to THIS product — generic advice about "market research" is worthless here.

For each cause: how likely it is, what it would actually cost, and whether he could have seen it coming beforehand. That last part matters most, because it tells him what to go and check now.

End with the single question he should answer before spending anything. One question, the highest-leverage one.`;

export function buildPremortemPrompt(p: ProductInput, j: Judgement): string {
  return `He is about to order stock of: **${p.name}** (${p.category}), selling at £${p.sellPrice.toFixed(2)}, ${p.weightGrams}g.

His plan is to win by fixing this: ${j.improvability.specificFix}

The Judge's verdict was ${j.verdict}. Its summary: ${j.summary}

Concerns already flagged: ${j.concerns.join("; ") || "none"}

Now tell him why it failed.`;
}

/**
 * Formats a completed judgement as markdown, so a result can be kept before
 * there is a database to keep it in. Paste into field-notes.md, a doc, or
 * anywhere else. Deliberately includes the inputs as well as the verdict —
 * a score you cannot trace back to what you fed it is not worth keeping.
 */
export type YourView = {
  verdict: "TEST" | "PARK" | "KILL" | "";
  notes: string;
};

export function judgementToMarkdown(
  p: ProductInput,
  j: Judgement,
  pm: Premortem | null,
  totalPence: number,
  yours: YourView,
): string {
  const stars = (n: number) => "●".repeat(n) + "○".repeat(5 - n);
  const date = new Date().toISOString().slice(0, 10);

  const lines = [
    `## ${p.name || "(unnamed product)"} — ${j.verdict}`,
    ``,
    `*Judged ${date} · ${p.category} · £${p.sellPrice.toFixed(2)} · ${p.weightGrams}g · US signal: ${p.usSignal} · cost ${totalPence.toFixed(1)}p*`,
    ``,
    j.summary,
    ``,
    `### Target buyer${j.targetBuyer.nameable ? "" : " — HARD FAIL"}`,
    ``,
    j.targetBuyer.buyer || "Could not be named.",
    ``,
    `### Improvability — weighted ${weightedImprovability(j)}/5`,
    ``,
    `*60% marketing and branding, 40% product.*`,
    ``,
    `| | Score | Why |`,
    `|---|---|---|`,
    `| Product | ${stars(j.improvability.product.score)} | ${j.improvability.product.reasoning} |`,
    `| Marketing | ${stars(j.improvability.marketing.score)} | ${j.improvability.marketing.reasoning} |`,
    `| Branding | ${stars(j.improvability.branding.score)} | ${j.improvability.branding.reasoning} |`,
    ``,
    `**The specific fix:** ${j.improvability.specificFix}`,
    ``,
    `### Can you sell it`,
    ``,
    `| | Score | Why |`,
    `|---|---|---|`,
    `| Visual | ${stars(j.marketability.visual.score)} | ${j.marketability.visual.reasoning} |`,
    `| Solves a problem | ${stars(j.marketability.problem.score)} | ${j.marketability.problem.reasoning} |`,
    `| Giftable | ${stars(j.marketability.giftable.score)} | ${j.marketability.giftable.reasoning} |`,
    `| Repeat purchase | ${stars(j.marketability.repeatPurchase.score)} | ${j.marketability.repeatPurchase.reasoning} |`,
    ``,
    `### If it's that obvious, why hasn't someone fixed it?`,
    ``,
    j.whyHasntSomeoneFixedIt,
    ``,
    ...(j.concerns.length > 0
      ? [`**Concerns:**`, ``, ...j.concerns.map((c) => `- ${c}`), ``]
      : []),
  ];

  // Oscar's own view goes near the top of the record, not buried at the end.
  // When these two disagree, that disagreement is the thing worth reading
  // later — it is what tells us which part of the rubric is wrong.
  if (yours.verdict || yours.notes.trim()) {
    const agrees = yours.verdict === j.verdict;
    const headline = yours.verdict
      ? `**I say ${yours.verdict}** — ${agrees ? "agrees with the Judge" : `**disagrees** (Judge said ${j.verdict})`}`
      : `**My notes**`;
    lines.splice(
      5,
      0,
      `### My view`,
      ``,
      headline,
      ``,
      ...(yours.notes.trim() ? [yours.notes.trim(), ``] : []),
    );
  }

  if (pm) {
    lines.push(
      `### Pre-mortem`,
      ``,
      `*${pm.scenario}*`,
      ``,
      ...pm.causes.flatMap((c) => [
        `**${c.cause}** (${c.likelihood})`,
        ``,
        `- Cost: ${c.whatItWouldCost}`,
        `- Could you see it coming: ${c.couldYouSeeItComing}`,
        ``,
      ]),
      `**Answer this before spending anything:** ${pm.theQuestionToAnswerFirst}`,
      ``,
    );
  }

  lines.push(
    `<details><summary>What I fed it</summary>`,
    ``,
    `**Listings:**`,
    ``,
    "```",
    p.listingNotes || "(none)",
    "```",
    ``,
    `**Reviews:**`,
    ``,
    "```",
    p.reviewComplaints || "(none)",
    "```",
    ``,
    `**Competition:**`,
    ``,
    "```",
    p.competitorNotes || "(none)",
    "```",
    ``,
    `</details>`,
  );

  return lines.join("\n");
}

export type IncomingImage = { data: string; mediaType: string };

/**
 * Images arrive as base64 from the browser. Validate shape and size before
 * forwarding: an oversized or non-image payload should fail here, cheaply,
 * rather than after a paid API call.
 */
export function parseImages(
  raw: unknown,
): { ok: true; value: IncomingImage[] } | { ok: false; errors: string[] } {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, errors: ["images must be an array"] };
  if (raw.length > 4) return { ok: false, errors: ["No more than 4 images"] };

  const errors: string[] = [];
  const value: IncomingImage[] = [];

  for (const [i, item] of raw.entries()) {
    const img = item as Record<string, unknown>;
    const data = img?.data;
    const mediaType = img?.mediaType;

    if (typeof data !== "string" || data.length === 0) {
      errors.push(`Image ${i + 1} has no data`);
      continue;
    }
    // base64 is roughly 4/3 of the byte size; 7MB of base64 is about 5MB.
    if (data.length > 7_000_000) {
      errors.push(`Image ${i + 1} is too large`);
      continue;
    }
    if (
      typeof mediaType !== "string" ||
      !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mediaType)
    ) {
      errors.push(`Image ${i + 1} is not a supported image type`);
      continue;
    }
    value.push({ data, mediaType });
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}

/** Never trust what arrives over HTTP. */
export function parseProductInput(
  body: unknown,
): { ok: true; value: ProductInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (typeof body !== "object" || body === null) {
    return { ok: false, errors: ["Body must be a JSON object"] };
  }
  const raw = body as Record<string, unknown>;

  const str = (k: keyof ProductInput, required = false, max = 4000) => {
    const v = raw[k];
    if (typeof v !== "string") {
      errors.push(`${k} must be a string`);
      return "";
    }
    if (required && v.trim() === "") errors.push(`${k} is required`);
    if (v.length > max) errors.push(`${k} must be under ${max} characters`);
    return v.slice(0, max);
  };

  const num = (k: keyof ProductInput) => {
    const n = Number(raw[k]);
    if (Number.isNaN(n) || n < 0) {
      errors.push(`${k} must be a positive number`);
      return 0;
    }
    return n;
  };

  const signal = raw.usSignal;
  const SIGNALS = ["rising", "falling", "flat", "no-analogue", "unchecked"];
  if (!SIGNALS.includes(signal as string)) {
    errors.push(`usSignal must be one of: ${SIGNALS.join(", ")}`);
  }

  const value: ProductInput = {
    name: str("name", true, 200),
    asin: str("asin", false, 20).toUpperCase().trim(),
    category: str("category", true, 100),
    sellPrice: num("sellPrice"),
    weightGrams: num("weightGrams"),
    // Generous caps: these hold raw pasted listings and reviews, not
    // summaries. Input tokens are the cheap half of a call, so the limit is
    // there to stop accidents, not to ration.
    listingNotes: str("listingNotes", false, 20000),
    reviewComplaints: str("reviewComplaints", false, 40000),
    competitorNotes: str("competitorNotes", false, 20000),
    usSignal: signal as ProductInput["usSignal"],
  };

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}

/**
 * Triage: the cheap first pass.
 *
 * The full Judgement schema is where the money goes. Output tokens cost five
 * times input, and a rich schema plus high effort produced about 4,700 of them
 * per product at roughly 11p a time. That is the right price for a product you
 * are seriously considering and the wrong price for the ninety you are not.
 *
 * This returns a verdict and a sentence. It is deliberately not a smaller
 * version of the Judge: it answers one question — is this worth eleven pence
 * of Opus — and nothing else.
 */
export const TriageSchema = z.object({
  verdict: z.enum(["TEST", "PARK", "KILL"]),
  /** One sentence. The schema caps it so the model cannot spend tokens here. */
  reason: z.string().max(240),
  /** 0-10. How beatable the incumbent's marketing and branding look. */
  improvability: z.number().min(0).max(10),
  /** The single biggest thing that would kill this, in a few words. */
  mainRisk: z.string().max(120),
});

export type Triage = z.infer<typeof TriageSchema>;

/**
 * Deliberately short, and it stays byte-identical across every call in a
 * sweep so the prompt cache holds. Anything that varies per product goes in
 * the user turn, never here — a single changed character in this string
 * invalidates the cache for the whole run.
 */
export const TRIAGE_SYSTEM_PROMPT = `You are triaging candidate products for a UK first-time Amazon FBA seller with about £3,000 of capital, stretchable to roughly £5,000 for something exceptional. You are not writing an analysis. You are deciding whether a product deserves a full, expensive review.

The thesis: the opening is a product with proven demand and poor execution. High review counts are good — they prove people already spend money here. A mediocre rating alongside them is the gap. A neglected listing, a random-string brand name, few images, no bullet points: those are jobs that can be done better, and they matter more than the product being novel.

Weight marketing and branding improvability at 60%, the product itself at 40%.

The two mistakes here are not equally costly, and this should change how you answer. A product you wrongly KILL is never looked at again. A product you wrongly pass costs about eleven pence of deeper review and gets caught there. So when the evidence is thin or the case is arguable, pass it up. Being wrong upward is cheap; being wrong downward is permanent.

Verdicts:
- KILL: only for something structural you can point at in the data. Over 3kg, so freight eats the margin. No usable gap between the shelf price and what a unit could cost to land. A category needing certification a beginner cannot get. An incumbent already executing well on every visible measure. If you are reaching for a reason, it is not a KILL.
- PARK: plausible but unremarkable, or too little data to judge. This is the correct home for everything uncertain, and it is fine for most products to land here.
- TEST: proven demand, a visible execution gap, and numbers that leave room.

Answer in the given schema and nothing else — no preamble, no caveats, no restating the input.`;

/**
 * The per-product half of the prompt. Kept compact on purpose: it is billed at
 * full input rate on every call, unlike the cached system prompt above.
 */
export function buildTriagePrompt(c: {
  title: string | null;
  brand: string | null;
  category: string;
  price: number | null;
  rating: number | null;
  reviewCount: number | null;
  monthlySold: number | null;
  packageWeightG: number | null;
  maxLandedCost: number | null;
  listingWeaknesses: string[];
  usGrowing: boolean | null;
}): string {
  const line = (label: string, value: unknown) =>
    value === null || value === undefined || value === "" ? null : `${label}: ${value}`;

  return [
    line("Product", c.title),
    line("Brand", c.brand),
    line("Category", c.category),
    line("Price", c.price === null ? null : `£${c.price.toFixed(2)}`),
    line("Rating", c.rating),
    line("Reviews", c.reviewCount),
    line("Sold per month", c.monthlySold),
    line("Packed weight", c.packageWeightG === null ? null : `${c.packageWeightG}g`),
    line(
      "Most it could cost to land and still clear 15% net",
      c.maxLandedCost === null ? null : `£${c.maxLandedCost.toFixed(2)}`,
    ),
    line(
      "Weaknesses in their listing",
      c.listingWeaknesses.length > 0 ? c.listingWeaknesses.join("; ") : "none spotted",
    ),
    line(
      "Amazon US",
      c.usGrowing === null ? null : c.usGrowing ? "growing" : "flat or falling",
    ),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Reading the reviews.
 *
 * This is the part of the thesis no amount of Keepa data reaches. A rating of
 * 3.9 says people are unhappy; only the words say what about, and whether it
 * is something you could fix with a better supplier brief or just the nature
 * of the product.
 *
 * Three stars is the richest seam and worth saying why: one-star reviews are
 * often delivery failures or the wrong item, five-star reviews say little
 * beyond "good". Three stars is someone who wanted to like it, used it, and
 * was let down by something specific.
 */
export const ReviewAnalysisSchema = z.object({
  /** What people actually complain about, most common first. */
  complaints: z.array(z.string()).max(8),
  /** Things reviewers say they wish it did or had. */
  wishedFor: z.array(z.string()).max(6),
  /**
   * Complaints a small seller could genuinely fix through a supplier brief,
   * better materials, or better instructions. This is the opportunity.
   */
  fixable: z.array(z.string()).max(6),
  /** Complaints inherent to the product or category. Not your opening. */
  notFixable: z.array(z.string()).max(6),
  /** 0-10. How much room a better version would actually have. */
  opportunityScore: z.number().min(0).max(10),
  /** Two or three sentences a person can act on. */
  summary: z.string().max(600),
});

export type ReviewAnalysis = z.infer<typeof ReviewAnalysisSchema>;

export const REVIEW_SYSTEM_PROMPT = `You are reading Amazon reviews for a UK first-time seller with about £3,000 of capital, stretchable to roughly £5,000 for something exceptional who is looking for a product to improve and sell better.

You are looking for one thing: the gap between what people wanted and what they got. That gap is the opening.

Separate complaints carefully into two piles, because the distinction decides whether the product is worth pursuing.

Fixable means a small seller could plausibly address it: flimsy materials, a part that breaks, missing instructions, a size that runs wrong, poor packaging, a fiddly assembly step, a missing accessory. These are supplier-brief problems, and they are your opening.

Not fixable means it is inherent to the product or category: the physics of the thing, the price point it must hit, a regulation, a use case it was never for. A long list here means the product is disappointing people for reasons a better version would not solve, so it is a worse candidate however loud the complaints are.

Ignore delivery problems, wrong-item-sent, and complaints about Amazon rather than the product. Those tell you nothing about the product.

Be concrete. "Poor quality" is useless; "the clip snaps after a few weeks" is something a supplier can be briefed on. Quote the specific failure, not the sentiment.

Score the opportunity on how much a genuinely better version would win, not on how angry people are.

You are told which star ratings these reviews came from, and it changes how you should read them. Three-star reviews are the most useful: someone used the product, wanted to like it, and was let down by something specific. One-star reviews are noisier — a share of them are delivery failures, wrong items and buyer error rather than the product.

But a low count of three-star reviews is itself a signal, not a gap. A product whose failure is catastrophic rather than marginal has almost none, because nobody lands in the middle: it either broke or it did not. When the set is mostly one and two star and they agree with each other on a specific physical failure, that agreement is strong evidence, not weak evidence. Say so in the summary.`;

export function buildReviewPrompt(input: {
  productName: string;
  starFilter: string;
  rawText: string;
}): string {
  return `Product: ${input.productName}
Star ratings these came from: ${input.starFilter || "not recorded"}

${input.rawText.slice(0, 60000)}`;
}

/**
 * A scout candidate, expressed as something the Judge can read.
 *
 * This is Break 2 from the build brief: the deepest and most useful part of
 * the tool was also the only part unreachable from the rest of it, because
 * `buildJudgePrompt` wanted a form Oscar filled in by hand. Everything the
 * form asked for is either already on the candidate or genuinely unknowable
 * from Keepa, and the difference between those two matters.
 *
 * The three fields Keepa cannot supply are left explicitly empty rather than
 * filled with something plausible. A Judge told "no listing notes" reasons
 * differently from one told "the listing is fine" — inventing the second is
 * how a tool becomes confidently wrong.
 */
export function candidateToProductInput(c: {
  asin: string;
  title: string | null;
  brand: string | null;
  category: string;
  price: number | null;
  packageWeightG: number | null;
  rating: number | null;
  reviewCount: number | null;
  unhappyBuyers: number | null;
  monthlySold: number | null;
  sellers: number | null;
  maxLandedCost: number | null;
  listingWeaknesses: string[];
  hasAplus?: boolean | null;
  videoCount?: number | null;
  us?: { growing: boolean | null } | null;
  reviewText?: string | null;
}): { input: ProductInput; missing: string[] } {
  const missing: string[] = [];

  // What the incumbent's listing looks like, in the Judge's own terms. These
  // are counted facts rather than an opinion, which is the point: the Judge
  // supplies the opinion.
  const listingNotes = [
    c.listingWeaknesses.length > 0
      ? `Weaknesses counted on their listing: ${c.listingWeaknesses.join("; ")}.`
      : "Nothing obviously wrong with their listing on the countable measures.",
    c.hasAplus === false ? "No A+ content." : c.hasAplus ? "Has A+ content." : "",
    c.videoCount === 0
      ? "No video."
      : c.videoCount
        ? `${c.videoCount} video(s).`
        : "",
    "Nobody has looked at the photographs or the copy itself — these are counts, not a read of quality.",
  ]
    .filter(Boolean)
    .join(" ");

  if (!c.reviewText) {
    missing.push(
      "Review text. Keepa gives a rating and a count, never the words, so what buyers actually complain about is unknown here.",
    );
  }
  if (c.hasAplus === null || c.hasAplus === undefined) {
    missing.push("Whether the listing has A+ content.");
  }
  if (c.maxLandedCost === null) missing.push("A landed-cost ceiling, because there is no price.");

  const competitorNotes = [
    c.sellers !== null ? `${c.sellers} seller(s) on the listing.` : "",
    c.monthlySold !== null ? `About ${c.monthlySold} sold in the past month.` : "",
    c.maxLandedCost !== null
      ? `To clear 15% net at £${(c.price ?? 0).toFixed(2)}, a unit would have to land for £${c.maxLandedCost.toFixed(2)} including freight, duty and prep.`
      : "",
    c.rating !== null && c.reviewCount !== null
      ? `Rated ${c.rating} across ${c.reviewCount} reviews${c.unhappyBuyers ? `, which is roughly ${c.unhappyBuyers} buyers who wanted better` : ""}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    input: {
      name: c.title ?? c.asin,
      asin: c.asin,
      category: c.category,
      sellPrice: c.price ?? 0,
      weightGrams: c.packageWeightG ?? 0,
      listingNotes,
      // Never invented. An empty string means nobody has read the reviews.
      reviewComplaints: c.reviewText ?? "",
      competitorNotes,
      usSignal:
        c.us?.growing === true
          ? "rising"
          : c.us?.growing === false
            ? "flat"
            : "unchecked",
    },
    missing,
  };
}
