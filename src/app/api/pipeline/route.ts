import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  KEEPA_DOMAIN,
  fetchProductRaw,
  findProducts,
  findUsRisers,
} from "@/lib/keepa";
import {
  MAX_PER_CATEGORY,
  buildCandidate,
  capPerCategory,
  dedupeVariations,
  judgeFreely,
  type Candidate,
} from "@/lib/candidate";
import { alreadyCovered, saveScoutCandidates, saveTriageVerdict } from "@/lib/db";
import {
  TRIAGE_MODEL,
  describeError,
  guardedTriage,
  priceTriage,
} from "@/lib/claude";
import { isMedia } from "@/lib/exclusions";
import {
  TRIAGE_SYSTEM_PROMPT,
  TriageSchema,
  buildTriagePrompt,
} from "@/lib/judge";

/**
 * POST /api/pipeline
 *
 * The whole chain in one call: find what is growing in the US, sweep the
 * categories it points at in the UK, score everything for free, and spend
 * money only on what survives.
 *
 * ## Why the cutoffs are where they are
 *
 * Free arithmetic runs on everything because it costs nothing. Triage runs on
 * a slice, because at roughly 0.2p a product the cost is trivial but the time
 * is not — a Vercel function dies at 300 seconds and each triage call takes a
 * few. Judging with Opus is not in here at all: at ninety seconds a product it
 * cannot fit in one request, and that is the honest limit of a single-request
 * pipeline rather than a decision about value.
 *
 * Running hundreds a day means the run has to become a database row that
 * advances itself in bounded slices. This route is the whole chain proven end
 * to end in one request, which is what that architecture will call.
 */
export const maxDuration = 300;

/** Categories to sweep, taken from wherever the most US risers cluster. */
const CATEGORY_LIMIT = 3;
/** Products per category. Keepa charges per product on the detail fetch. */
const PER_CATEGORY = 10;
/** How many survivors get a paid opinion. */
const TRIAGE_LIMIT = 15;

export async function POST(request: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // No body means defaults.
  }

  const num = (k: string, d: number) => {
    const v = Number(body[k]);
    return Number.isFinite(v) && v > 0 ? v : d;
  };

  const encoder = new TextEncoder();
  const send = (c: ReadableStreamDefaultController, e: unknown) =>
    c.enqueue(encoder.encode(JSON.stringify(e) + "\n"));

  const stream = new ReadableStream({
    async start(controller) {
      const started = Date.now();
      let spentPence = 0;

      try {
        // ── 1. Where is the market moving ────────────────────────────────
        send(controller, { type: "stage", stage: "us-risers", detail: "asking what has grown in the US" });

        // Walk deeper into the result set until something new turns up.
        //
        // Page 0 every time is why five categories kept reappearing: the same
        // fifty products, run after run. There are hundreds of thousands of
        // matches behind these filters, so when the front of the list is
        // exhausted the answer is to go further into it rather than to report
        // that the market has stopped moving.
        const covered = await alreadyCovered().catch(() => ({
          asins: new Set<string>(),
          categories: new Set<string>(),
        }));

        const startPage = num("page", 0);
        const maxPages = num("maxPages", 6);
        let risers = await findUsRisers({
          minGrowth: num("minGrowth", 1.5),
          minPrice: num("minPrice", 10),
          maxPrice: num("maxPrice", 60),
          limit: 30,
          page: startPage,
        });
        let pagesTried = 1;

        if (risers.asins.length === 0) {
          send(controller, {
            type: "error",
            error: "No US risers matched. Widen the growth band or the price range.",
          });
          return;
        }

        // Both markets, because the US tells us what is moving and only the
        // UK can tell us where to look for it here.
        const [usDetail, ukDetail] = await Promise.all([
          fetchProductRaw(risers.asins.join(","), KEEPA_DOMAIN.US, {
            history: false,
            stats: 365,
          }),
          fetchProductRaw(risers.asins.join(","), KEEPA_DOMAIN.UK, {
            history: false,
            stats: 0,
          }),
        ]);
        const usProducts = ((usDetail.raw as Record<string, unknown>).products ??
          []) as Record<string, unknown>[];
        const ukProducts = ((ukDetail.raw as Record<string, unknown>).products ??
          []) as Record<string, unknown>[];
        const ukByAsin = new Map(
          ukProducts
            .filter((p) => typeof p.asin === "string")
            .map((p) => [p.asin as string, p]),
        );

        // Categories, tallied by how many risers sit in each.
        //
        // Read from the UK record, not the US one. Amazon's category trees are
        // per-marketplace: a US catId means nothing to a UK search, so the
        // first version of this swept three real categories and found nothing
        // in all three. The US product says a market is moving; its UK twin
        // says where that market lives here.
        //
        // Media and apparel are dropped before the tally, or a run proposes
        // sweeping Pullovers and Movies.
        const tally = new Map<number, { id: number; name: string; risers: number }>();
        let skipped = 0;
        for (const p of usProducts) {
          if (isMedia(p)) {
            skipped += 1;
            continue;
          }
          const twin = ukByAsin.get(p.asin as string);
          if (!twin || isMedia(twin)) {
            skipped += 1;
            continue;
          }
          const tree = (twin.categoryTree ?? []) as { catId: number; name: string }[];
          const leaf = Array.isArray(tree) ? tree[tree.length - 1] : null;
          if (!leaf?.catId) continue;
          const seen = tally.get(leaf.catId);
          if (seen) seen.risers += 1;
          else tally.set(leaf.catId, { id: leaf.catId, name: leaf.name, risers: 1 });
        }

        const ranked = [...tally.values()].sort((a, b) => b.risers - a.risers);
        const unseen = ranked.filter((c) => !covered.categories.has(c.name));

        // Fall back to covered ground only if there is nothing new, and say so
        // — "we have run out of new categories" is a finding about the funnel,
        // not a reason to silently repeat.
        let workingUnseen = unseen;
        let workingRanked = ranked;

        while (workingUnseen.length === 0 && pagesTried < maxPages) {
          send(controller, {
            type: "stage",
            stage: "us-risers",
            detail: `page ${startPage + pagesTried} — the front of the list is ground already covered`,
          });

          risers = await findUsRisers({
            minGrowth: num("minGrowth", 1.5),
            minPrice: num("minPrice", 10),
            maxPrice: num("maxPrice", 60),
            limit: 30,
            page: startPage + pagesTried,
          });
          pagesTried += 1;
          if (risers.asins.length === 0) break;

          const more = await fetchProductRaw(risers.asins.join(","), KEEPA_DOMAIN.UK, {
            history: false,
            stats: 0,
          });
          const moreUk = ((more.raw as Record<string, unknown>).products ??
            []) as Record<string, unknown>[];

          const tally2 = new Map<number, { id: number; name: string; risers: number }>();
          for (const twin of moreUk) {
            if (isMedia(twin)) continue;
            const tree = (twin.categoryTree ?? []) as { catId: number; name: string }[];
            const leaf = Array.isArray(tree) ? tree[tree.length - 1] : null;
            if (!leaf?.catId) continue;
            const seen2 = tally2.get(leaf.catId);
            if (seen2) seen2.risers += 1;
            else tally2.set(leaf.catId, { id: leaf.catId, name: leaf.name, risers: 1 });
          }
          workingRanked = [...tally2.values()].sort((a, b) => b.risers - a.risers);
          workingUnseen = workingRanked.filter((c) => !covered.categories.has(c.name));
        }

        const exhausted = workingUnseen.length === 0;
        const categories = (exhausted ? workingRanked : workingUnseen).slice(
          0,
          num("categoryLimit", CATEGORY_LIMIT),
        );

        send(controller, {
          type: "categories",
          categories,
          skipped,
          pagesTried,
          skippedAsAlreadyCovered: workingRanked.length - workingUnseen.length,
          exhausted,
          exhaustedNote: exhausted
            ? `Nothing new after ${pagesTried} page(s) of risers. Widen the growth band or the price range, or raise maxPages.`
            : null,
          note: "UK category ids, read from each riser's UK listing. A US id would find nothing here — the trees are per-marketplace.",
        });

        if (categories.length === 0) {
          send(controller, {
            type: "error",
            error: `None of the US risers has a UK listing to take a category from (${skipped} were media, apparel, or absent from Amazon UK). That is itself a finding: the trend has not crossed yet.`,
          });
          return;
        }

        // ── 2. Sweep those categories in the UK ──────────────────────────
        const all: Candidate[] = [];
        const seen = new Set<string>();

        for (const category of categories) {
          send(controller, { type: "stage", stage: "sweep", detail: category.name });

          try {
            const found = await findProducts(
              {
                categoryId: category.id,
                minPrice: num("minPrice", 8),
                maxPrice: num("maxPrice", 60),
                maxRank: 200000,
                limit: PER_CATEGORY,
              },
              KEEPA_DOMAIN.UK,
            );

            const fresh = found.asins.filter((a) => !seen.has(a));
            fresh.forEach((a) => seen.add(a));
            if (fresh.length === 0) {
              send(controller, { type: "swept", category: category.name, found: 0 });
              continue;
            }

            const detail = await fetchProductRaw(fresh.join(","), KEEPA_DOMAIN.UK, {
              history: false,
              stats: 90,
              listing: true,
            });
            const products = ((detail.raw as Record<string, unknown>).products ??
              []) as Record<string, unknown>[];

            const candidates = products.map((p) =>
              judgeFreely(buildCandidate(p, category.name)),
            );
            all.push(...candidates);

            send(controller, {
              type: "swept",
              category: category.name,
              found: candidates.length,
              tokensLeft: detail.tokensLeft,
            });
          } catch (error) {
            // One dead category must not end the run.
            send(controller, {
              type: "swept",
              category: category.name,
              found: 0,
              error: describeError(error),
            });
          }
        }

        if (all.length === 0) {
          send(controller, {
            type: "error",
            error: "Every category swept empty. The US categories may have no UK equivalent at these filters.",
          });
          return;
        }

        // ── 3. Free arithmetic has already run; save before spending ─────
        //
        // Collapse variations first. Paying for five opinions on one product
        // in five sizes is the most obvious waste in the whole chain, and it
        // fills the shortlist with rows that read identically.
        const { unique, collapsed } = dedupeVariations(all);
        if (collapsed > 0) {
          send(controller, {
            type: "deduped",
            collapsed,
            note: `${collapsed} were size or colour variations of a product already on the list.`,
          });
        }
        all.length = 0;
        all.push(...unique);
        all.sort((a, b) => (b.score?.total ?? 0) - (a.score?.total ?? 0));

        let saved = 0;
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
              has_aplus: c.hasAplus,
              video_count: c.videoCount,
              found_via: "us risers",
            })),
          );
          saved = result.saved;
        } catch (error) {
          send(controller, { type: "warning", warning: `Could not save: ${describeError(error)}` });
        }

        // Never pay twice for the same opinion. A product already judged has a
        // verdict on its row, and a sibling of one has the same reviews, the
        // same rating and the same fix.
        const judgedParents = new Set(
          all
            .filter((c) => covered.asins.has(c.asin))
            .map((c) => c.parentAsin)
            .filter(Boolean) as string[],
        );

        const fresh = all.filter(
          (c) =>
            !c.killed &&
            !covered.asins.has(c.asin) &&
            !(c.parentAsin && judgedParents.has(c.parentAsin)),
        );

        const repeats = all.filter((c) => !c.killed).length - fresh.length;

        // Three per category is the useful number. The fourth costs 0.2p to
        // repeat what the first three said, and takes the slot of a category
        // nobody has looked at.
        const { capped, dropped } = capPerCategory(
          fresh,
          num("maxPerCategory", MAX_PER_CATEGORY),
        );
        const survivors = capped.slice(0, num("triageLimit", TRIAGE_LIMIT));

        send(controller, {
          type: "scored",
          scanned: all.length,
          killed: all.length - all.filter((c) => !c.killed).length,
          saved,
          alreadyJudged: repeats,
          beyondThreePerCategory: dropped,
          toTriage: survivors.length,
          note:
            [
              repeats > 0
                ? `${repeats} survived the arithmetic but were judged before, or are a sibling of something judged before.`
                : "",
              dropped > 0
                ? `${dropped} were a fourth or later product from a category already represented — three competitors tell you what the category is like, a fifth does not.`
                : "",
            ]
              .filter(Boolean)
              .join(" ") || null,
        });

        // ── 4. Paid opinions, on survivors only ──────────────────────────
        for (const c of survivors) {
          try {
            const result = await guardedTriage((client) =>
              client.messages.create({
                model: TRIAGE_MODEL,
                max_tokens: 2000,
                output_config: {
                  effort: "low",
                  format: zodOutputFormat(TriageSchema),
                },
                system: [
                  {
                    type: "text",
                    text: TRIAGE_SYSTEM_PROMPT,
                    cache_control: { type: "ephemeral" },
                  },
                ],
                messages: [
                  {
                    role: "user",
                    content: buildTriagePrompt({
                      ...c,
                      usGrowing: c.us?.growing ?? null,
                    }),
                  },
                ],
              }),
            );

            const parsed = TriageSchema.safeParse(
              JSON.parse(result.content.find((b) => b.type === "text")?.text ?? "{}"),
            );
            spentPence += priceTriage(result.usage).costPence;

            if (!parsed.success) {
              send(controller, { type: "judged", asin: c.asin, error: "output did not match the schema" });
              continue;
            }

            await saveTriageVerdict(c.asin, {
              triage_verdict: parsed.data.verdict,
              triage_because: parsed.data.reason,
              triage_improvability: parsed.data.improvability,
              triage_main_risk: parsed.data.mainRisk,
            }).catch(() => {});

            send(controller, {
              type: "judged",
              asin: c.asin,
              title: c.title,
              verdict: parsed.data.verdict,
              because: parsed.data.reason,
              risk: parsed.data.mainRisk,
              improvability: parsed.data.improvability,
              score: c.score?.total ?? null,
            });
          } catch (error) {
            send(controller, { type: "judged", asin: c.asin, error: describeError(error) });
          }
        }

        send(controller, {
          type: "done",
          seconds: Math.round((Date.now() - started) / 1000),
          scanned: all.length,
          saved,
          triaged: survivors.length,
          spentPence: Math.round(spentPence * 100) / 100,
        });
      } catch (error) {
        send(controller, { type: "error", error: describeError(error) });
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
