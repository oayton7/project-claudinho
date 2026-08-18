import {
  KEEPA_DOMAIN,
  KeepaTokensExhausted,
  MissingKeepaKey,
  categoriesForAsins,
  fetchProductRaw,
  findProducts,
} from "@/lib/keepa";
import { saveScoutCandidates } from "@/lib/db";
import { maxLandedCost } from "@/lib/margin";
import {
  DEFAULT_WEIGHTS,
  autoVerdict,
  hardKill,
  scoreCandidate,
  type ScoreResult,
  type Scorable,
  type Weights,
} from "@/lib/score";

/**
 * POST /api/keepa/sweep
 *
 * The Scout run without supervision. Rather than tuning filters by hand and
 * pressing search a dozen times, this walks every category on one set of
 * rules, pools the results and ranks them.
 *
 * Three things make it safe to leave running:
 *
 * 1. The first category doubles as a probe. If the Product Finder request
 *    shape is wrong the whole sweep aborts there, spending one search rather
 *    than twelve.
 * 2. A token floor. Keepa refills continuously but a sweep can drain the
 *    bucket, and running dry mid-way leaves you with partial results and no
 *    ability to check anything. It stops while there is still budget left.
 * 3. Progress streams as newline-delimited JSON, so a slow sweep shows what
 *    it is doing instead of hanging.
 */
export const maxDuration = 300;

/** Stop while there is still enough left to look up a few products by hand. */
const TOKEN_FLOOR = 100;

/** Per category. Ten categories at this rate is a manageable spend. */
const PER_CATEGORY = 10;

/**
 * How many of the best UK candidates get looked up on Amazon US as well.
 * Kept small because each one costs tokens on a second domain, and the answer
 * only matters for products that already survived the UK filters.
 */
const US_CROSS_CHECK_LIMIT = 15;

/**
 * Fallback categories, used only when no seed ASINs are given.
 *
 * These ids are unverified and one of them was proved wrong: rootCategory
 * 11052591 matches nothing at all. Seeding from an ASIN is the reliable path,
 * and the sweep says so rather than silently returning nothing.
 */
const FALLBACK_CATEGORIES: { id: number; label: string }[] = [
  { id: 11052591, label: "Home & Kitchen (unverified)" },
];

type Candidate = {
  asin: string;
  category: string;
  title: string | null;
  brand: string | null;
  price: number | null;
  salesRank: number | null;
  reviewCount: number | null;
  rating: number | null;
  sellers: number | null;
  rankDrops90: number | null;
  packageWeightG: number | null;
  unhappyBuyers: number | null;
  maxLandedCost: number | null;
  monthlySold: number | null;
  description: string | null;
  features: string[];
  imageCount: number;
  listingWeaknesses: string[];
  us: UsSignal | null;
  flags: string[];
  score: ScoreResult | null;
  killed: string | null;
  verdict: "TEST" | "PARK" | "KILL" | null;
  because: string;
};

type UsSignal = {
  price: number | null;
  monthlySold: number | null;
  salesRank: number | null;
  /** 30-day average rank better than the 90-day average means it is climbing. */
  growing: boolean | null;
};

/**
 * How lazy is the incumbent's listing?
 *
 * You cannot see a competitor's ad spend, but you can see their shop window,
 * and a neglected one is countable. Each of these is a specific job you could
 * do better for the price of an afternoon, which is the cheapest kind of
 * advantage there is.
 */
function listingWeaknesses(
  title: string | null,
  brand: string | null,
  features: string[],
  description: string | null,
  imageCount: number,
): string[] {
  const weak: string[] = [];

  // Sellers who never intended to build a brand tend to register a random
  // string. No vowels, or letters plus digits, is the usual shape.
  if (brand) {
    const bare = brand.replace(/[^A-Za-z0-9]/g, "");
    if (bare.length >= 4 && !/[aeiou]/i.test(bare)) {
      weak.push(`brand "${brand}" looks like a random string, not a brand`);
    } else if (/^[A-Za-z]+\d+$/.test(bare) || /\d{2,}/.test(bare)) {
      weak.push(`brand "${brand}" reads as a placeholder`);
    }
  } else {
    weak.push("no brand set");
  }

  if (title) {
    if (title.length > 150) weak.push(`title is ${title.length} chars, keyword stuffed`);
    if (title.length < 30) weak.push(`title is only ${title.length} chars, barely tries`);
    // A title that repeats the same word is written for a search engine
    // rather than a person, and it reads that way on the page.
    const words: string[] = title.toLowerCase().match(/[a-z]{4,}/g) ?? [];
    const repeated = words.filter((w, i) => words.indexOf(w) !== i);
    if (new Set(repeated).size >= 3) weak.push("title repeats the same keywords");
  } else {
    weak.push("no title");
  }

  if (features.length === 0) weak.push("no bullet points");
  else if (features.length < 4) weak.push(`only ${features.length} bullet points`);

  if (!description || description.length < 100) weak.push("thin or missing description");
  if (imageCount > 0 && imageCount < 5) weak.push(`only ${imageCount} images`);
  if (imageCount === 0) weak.push("no images on record");

  return weak;
}

function buildCandidate(
  product: Record<string, unknown>,
  category: string,
): Candidate {
  const stats = (product.stats ?? {}) as Record<string, unknown>;
  const current = stats.current as number[] | undefined;
  const pence = (v: unknown) => (typeof v === "number" && v >= 0 ? v / 100 : null);
  const int = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);

  const price = pence(stats.buyBoxPrice) ?? pence(current?.[1]);
  const reviewCount = int(current?.[17]);
  const rating = int(current?.[16]) === null ? null : (current![16] as number) / 10;
  const weight = int(product.packageWeight);
  const rankDrops90 = int(stats.salesRankDrops90);

  const unhappyBuyers =
    reviewCount !== null && rating !== null
      ? Math.round(reviewCount * Math.max(0, 4.5 - rating))
      : null;

  // Amazon's own "bought in the past month" figure, which Keepa passes
  // through. Far better than inferring sales from rank drops, though it is
  // only populated on some listings.
  const monthlySold = int(product.monthlySold);

  const features = Array.isArray(product.features)
    ? (product.features as string[]).filter((f) => typeof f === "string")
    : [];
  // Descriptions run to thousands of characters and there may be a hundred
  // products in a sweep. Enough to judge the tone, not the whole thing.
  const rawDescription =
    typeof product.description === "string"
      ? product.description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
      : null;
  const description =
    rawDescription && rawDescription.length > 400
      ? rawDescription.slice(0, 400) + "…"
      : rawDescription;
  const imageCount =
    typeof product.imagesCSV === "string" && product.imagesCSV.length > 0
      ? product.imagesCSV.split(",").length
      : 0;

  // Free, because it is arithmetic. Solving for the supplier price you would
  // need is the only margin question answerable before you have a quote.
  const ceiling = price === null ? null : maxLandedCost(price).landed;

  // Concerns rather than a composite score. A single blended number would
  // hide which thing is actually wrong, and the rest of this app reports
  // pass/fail checks for exactly that reason.
  const flags: string[] = [];
  if (price !== null && price < 12) flags.push("under the £12 floor");
  if (weight !== null && weight > 1000) flags.push("over 1kg, freight will hurt");
  if (rankDrops90 !== null && rankDrops90 < 30)
    flags.push("barely sells, under 30 in 90 days");
  if (ceiling !== null && ceiling < 3)
    flags.push(`needs landing under £${ceiling.toFixed(2)}, very tight`);
  if (rating !== null && rating >= 4.4)
    flags.push("well liked already, less room to improve");

  return {
    asin: String(product.asin ?? ""),
    category,
    title: (product.title as string) ?? null,
    brand: (product.brand as string) ?? null,
    price,
    salesRank: int(current?.[3]),
    reviewCount,
    rating,
    sellers: int(stats.totalOfferCount),
    rankDrops90,
    packageWeightG: weight,
    unhappyBuyers,
    maxLandedCost: ceiling,
    monthlySold,
    description,
    features,
    imageCount,
    listingWeaknesses: listingWeaknesses(
      (product.title as string) ?? null,
      (product.brand as string) ?? null,
      features,
      rawDescription,
      imageCount,
    ),
    us: null,
    flags,
    // Filled in after the US check, so the US signal can count towards it.
    score: null,
    killed: null,
    verdict: null,
    because: "",
  };
}

function toScorable(c: Candidate): Scorable {
  return {
    price: c.price,
    rating: c.rating,
    reviewCount: c.reviewCount,
    unhappyBuyers: c.unhappyBuyers,
    monthlySold: c.monthlySold,
    rankDrops90: c.rankDrops90,
    sellers: c.sellers,
    packageWeightG: c.packageWeightG,
    maxLandedCost: c.maxLandedCost,
    listingWeaknessCount: c.listingWeaknesses.length,
    usGrowing: c.us?.growing ?? null,
  };
}

export async function POST(request: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // A sweep with no body is valid: it means "use the defaults".
  }

  const num = (key: string, fallback: number) => {
    const value = Number(body[key]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };

  // Deliberately few and deliberately wide.
  //
  // The first version sent eight filters and ANDed them, which cut the pool to
  // nothing and threw away the near-misses worth looking at. Keepa's job is
  // now only to keep the result set to a sane size; every finer judgement
  // happens in scoreCandidate, for free, on what comes back.
  const filters = {
    minPrice: num("minPrice", 8),
    maxPrice: num("maxPrice", 60),
    maxRank: num("maxRank", 200000),
    limit: PER_CATEGORY,
  };

  const seedAsins = Array.isArray(body.seedAsins)
    ? (body.seedAsins as unknown[])
        .map((a) => String(a).toUpperCase().trim())
        .filter((a) => /^[A-Z0-9]{10}$/.test(a))
        .slice(0, 10)
    : [];

  const weights: Weights = {
    ...DEFAULT_WEIGHTS,
    ...(typeof body.weights === "object" && body.weights !== null
      ? (body.weights as Weights)
      : {}),
  };

  const encoder = new TextEncoder();
  const send = (c: ReadableStreamDefaultController, event: unknown) =>
    c.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

  const stream = new ReadableStream({
    async start(controller) {
      const seen = new Set<string>();
      const all: Candidate[] = [];
      let tokensLeft: number | null = null;

      try {
        // Seed ASINs decide where to look. "More things like this" is a
        // sharper instruction than a category name, and it sidesteps the
        // guessed ids entirely: the category comes off a real product.
        let categories = FALLBACK_CATEGORIES;

        if (seedAsins.length > 0) {
          send(controller, {
            type: "progress",
            index: 0,
            of: 1,
            category: `Reading categories from ${seedAsins.length} seed ASIN${seedAsins.length === 1 ? "" : "s"}`,
          });

          const derived = await categoriesForAsins(seedAsins, KEEPA_DOMAIN.UK);
          tokensLeft = derived.tokensLeft ?? tokensLeft;

          if (derived.categories.length === 0) {
            send(controller, {
              type: "error",
              error: `Keepa had no record of ${seedAsins.join(", ")} on Amazon UK, so there is no category to sweep. Check the ASINs are UK listings.`,
            });
            return;
          }

          categories = derived.categories.map((c) => ({ id: c.id, label: c.name }));
          send(controller, {
            type: "seeded",
            categories: derived.categories,
            missing: derived.missing,
          });
        }

        send(controller, {
          type: "start",
          categories: categories.length,
          filters,
          seeded: seedAsins.length > 0,
        });

        for (const [index, category] of categories.entries()) {
          if (tokensLeft !== null && tokensLeft < TOKEN_FLOOR) {
            send(controller, {
              type: "halted",
              reason: `Stopped after ${index} of ${categories.length} categories: ${tokensLeft} Keepa tokens left, which is below the ${TOKEN_FLOOR} floor. Results so far are below. Keepa refills over time, so try the rest later.`,
            });
            break;
          }

          send(controller, {
            type: "progress",
            index: index + 1,
            of: categories.length,
            category: category.label,
          });

          try {
            const search = await findProducts(
              { ...filters, categoryId: category.id },
              KEEPA_DOMAIN.UK,
            );
            tokensLeft = search.tokensLeft ?? tokensLeft;

            const fresh = search.asins.filter((a) => !seen.has(a));
            fresh.forEach((a) => seen.add(a));

            if (fresh.length === 0) {
              send(controller, {
                type: "category",
                category: category.label,
                found: 0,
              });
              continue;
            }

            const detail = await fetchProductRaw(fresh.join(","), KEEPA_DOMAIN.UK, {
              history: false,
              stats: 90,
            });
            tokensLeft = detail.tokensLeft ?? tokensLeft;

            const products = ((detail.raw as Record<string, unknown>).products ??
              []) as Record<string, unknown>[];
            const candidates = products.map((p) => buildCandidate(p, category.label));
            all.push(...candidates);

            send(controller, {
              type: "category",
              category: category.label,
              found: candidates.length,
              tokensLeft,
            });
          } catch (error) {
            // The first category is the probe. A failure there means the
            // request shape is wrong, not that this one category is empty,
            // so stop rather than burn the remaining searches.
            const message =
              error instanceof Error ? error.message : "Keepa request failed";
            if (index === 0) {
              send(controller, {
                type: "error",
                error: `Aborted on the first category, so nothing else was tried. ${message}`,
              });
              // Return, do not close: the finally block owns closing the
              // controller. Closing twice throws, and that throw kills the
              // response before the browser has read any of it.
              return;
            }
            send(controller, {
              type: "category",
              category: category.label,
              found: 0,
              error: message,
            });
          }
        }

        // Provisional ranking so the US check spends its budget on the most
        // promising candidates. Scored again afterwards, once the US signal
        // is known.
        const provisional = (c: Candidate) =>
          scoreCandidate(toScorable(c), weights).total;
        all.sort((a, b) => provisional(b) - provisional(a));

        // ── The US cross-reference ──────────────────────────────────────
        //
        // A product already growing in the US and quiet here is the clearest
        // signal there is: someone else has proved the demand, and the UK
        // listing has not caught up yet.
        //
        // Only the top candidates get checked. Every ASIN costs tokens on the
        // US domain too, and cross-checking a product that already failed on
        // weight or price would be paying to confirm a no.
        const topForUs = all.slice(0, US_CROSS_CHECK_LIMIT).filter((c) => c.asin);

        if (topForUs.length > 0 && (tokensLeft === null || tokensLeft >= TOKEN_FLOOR)) {
          send(controller, {
            type: "progress",
            index: categories.length,
            of: categories.length,
            category: `Checking the top ${topForUs.length} against the US`,
          });

          try {
            const us = await fetchProductRaw(
              topForUs.map((c) => c.asin).join(","),
              KEEPA_DOMAIN.US,
              { history: false, stats: 90 },
            );
            tokensLeft = us.tokensLeft ?? tokensLeft;

            const usProducts = ((us.raw as Record<string, unknown>).products ??
              []) as Record<string, unknown>[];

            for (const usProduct of usProducts) {
              const match = all.find((c) => c.asin === usProduct.asin);
              if (!match) continue;

              const stats = (usProduct.stats ?? {}) as Record<string, unknown>;
              const current = stats.current as number[] | undefined;
              const avg30 = stats.avg30 as number[] | undefined;
              const avg90 = stats.avg90 as number[] | undefined;

              const rank30 = avg30?.[3];
              const rank90 = avg90?.[3];
              // Sales rank is inverted: a smaller number is a better seller.
              // So a 30-day average below the 90-day average means it has been
              // climbing recently.
              const growing =
                typeof rank30 === "number" &&
                typeof rank90 === "number" &&
                rank30 > 0 &&
                rank90 > 0
                  ? rank30 < rank90
                  : null;

              match.us = {
                price:
                  typeof current?.[1] === "number" && current[1] >= 0
                    ? current[1] / 100
                    : null,
                monthlySold:
                  typeof usProduct.monthlySold === "number" && usProduct.monthlySold > 0
                    ? usProduct.monthlySold
                    : null,
                salesRank:
                  typeof current?.[3] === "number" && current[3] > 0 ? current[3] : null,
                growing,
              };
            }

            send(controller, {
              type: "category",
              category: `US cross-check`,
              found: usProducts.length,
              tokensLeft,
            });
          } catch (error) {
            // A failed cross-check is not a failed sweep. The UK results are
            // still worth having, so say what went wrong and carry on.
            send(controller, {
              type: "category",
              category: "US cross-check",
              found: 0,
              error: error instanceof Error ? error.message : "US lookup failed",
            });
          }
        }

        // Final scoring, now that the US signal is in.
        for (const c of all) {
          const scorable = toScorable(c);
          c.killed = hardKill(scorable);
          c.score = scoreCandidate(scorable, weights);
          const decided = autoVerdict(c.score, c.killed);
          c.verdict = decided.verdict;
          c.because = decided.because;
        }

        // Killed products sink but are not deleted: seeing why something died
        // is worth more than a shorter list.
        all.sort((a, b) => {
          if (!a.killed !== !b.killed) return a.killed ? 1 : -1;
          return (b.score?.total ?? 0) - (a.score?.total ?? 0);
        });

        // Persist before returning. A sweep costs tokens, so losing the
        // results to a closed tab means paying for them twice, and the plan's
        // own rule is that dead products stay on record with their reason so
        // they stop being re-found.
        let saved = 0;
        let saveError: string | null = null;
        try {
          const result = await saveScoutCandidates(
            all.map((c) => ({
              asin: c.asin,
              title: c.title ?? "",
              brand: c.brand ?? "",
              category: c.category,
              price: c.price,
              rating: c.rating,
              review_count: c.reviewCount,
              unhappy_buyers: c.unhappyBuyers,
              monthly_sold: c.monthlySold,
              sellers: c.sellers,
              weight_grams: c.packageWeightG,
              max_landed_cost: c.maxLandedCost,
              score: c.score?.total ?? null,
              coverage: c.score?.coverage ?? null,
              strengths: c.score?.strengths.join(" · ") ?? "",
              listing_weaknesses: c.listingWeaknesses.join(" · "),
              killed_reason: c.killed,
              us_growing: c.us?.growing ?? null,
              us_monthly_sold: c.us?.monthlySold ?? null,
              auto_verdict: c.verdict,
              auto_because: c.because,
            })),
          );
          saved = result.saved;
        } catch (error) {
          // Reported, never swallowed. A save that silently fails looks
          // identical to one that worked.
          saveError = error instanceof Error ? error.message : "save failed";
        }

        send(controller, {
          type: "done",
          candidates: all,
          saved,
          saveError,
          tokensLeft,
          scanned: seen.size,
          clean: all.filter((c) => !c.killed).length,
          weights,
          usGrowing: all.filter((c) => c.us?.growing === true).length,
        });
      } catch (error) {
        if (error instanceof MissingKeepaKey || error instanceof KeepaTokensExhausted) {
          send(controller, { type: "error", error: error.message });
        } else {
          console.error("[keepa/sweep]", error);
          send(controller, {
            type: "error",
            error: error instanceof Error ? error.message : "Sweep failed",
          });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
