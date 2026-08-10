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

export const JUDGE_SYSTEM_PROMPT = `You are the Judge in a product-sourcing tool for a UK-based first-time Amazon FBA seller with roughly £3,000 of capital. You are scoring one candidate product.

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

## How to score

Score each criterion 1 to 5, where 1 is "no opportunity here" and 5 is "obvious, exploitable gap". Justify every score with something concrete from the input.

**Improvability is the primary thing.** Weight your verdict accordingly.

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

**Product:** ${p.name}
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

export const PREMORTEM_SYSTEM_PROMPT = `You are running a pre-mortem for a UK first-time Amazon FBA seller with roughly £3,000 of capital who is about to commit money to a product.

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
export function judgementToMarkdown(
  p: ProductInput,
  j: Judgement,
  pm: Premortem | null,
  totalPence: number,
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
    `### Improvability`,
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
