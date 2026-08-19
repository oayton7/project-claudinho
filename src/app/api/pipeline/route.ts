import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  KEEPA_DOMAIN,
  fetchProductRaw,
  findProducts,
  findUsRisers,
} from "@/lib/keepa";
import {
  buildCandidate,
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

        const risers = await findUsRisers({
          minGrowth: num("minGrowth", 1.5),
          minPrice: num("minPrice", 10),
          maxPrice: num("maxPrice", 60),
          limit: 30,
        });

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

        // What has been covered already. The US riser search is fairly stable
        // week to week, so without this every run re-sweeps the same
        // categories and re-finds the same products.
        const covered = await alreadyCovered().catch(() => ({
          asins: new Set<string>(),
          categories: new Set<string>(),
        }));

        const ranked = [...tally.values()].sort((a, b) => b.risers - a.risers);
        const unseen = ranked.filter((c) => !covered.categories.has(c.name));

        // Fall back to covered ground only if there is nothing new, and say so
        // — "we have run out of new categories" is a finding about the funnel,
        // not a reason to silently repeat.
        const exhausted = unseen.length === 0;
        const categories = (exhausted ? ranked : unseen).slice(
          0,
          num("categoryLimit", CATEGORY_LIMIT),
        );

        send(controller, {
          type: "categories",
          categories,
          skipped,
          skippedAsAlreadyCovered: ranked.length - unseen.length,
          exhausted,
          exhaustedNote: exhausted
            ? "Every category the US risers point at has been swept before. Widen the growth band or the price range to reach new ground."
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
        const survivors = fresh.slice(0, num("triageLimit", TRIAGE_LIMIT));

        send(controller, {
          type: "scored",
          scanned: all.length,
          killed: all.length - all.filter((c) => !c.killed).length,
          saved,
          alreadyJudged: repeats,
          toTriage: survivors.length,
          note:
            repeats > 0
              ? `${repeats} survived the arithmetic but have been judged before, or are a sibling of something judged before. Not paid for again.`
              : null,
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
