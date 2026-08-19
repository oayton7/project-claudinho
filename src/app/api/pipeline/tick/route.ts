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
} from "@/lib/candidate";
import { isMedia } from "@/lib/exclusions";
import {
  alreadyCovered,
  getCandidate,
  getRun,
  nextRunnable,
  saveScoutCandidates,
  saveTriageVerdict,
  updateRun,
  type RunRow,
} from "@/lib/db";
import {
  TRIAGE_MODEL,
  describeError,
  guardedTriage,
  priceTriage,
} from "@/lib/claude";
import {
  TRIAGE_SYSTEM_PROMPT,
  TriageSchema,
  buildTriagePrompt,
} from "@/lib/judge";

/**
 * POST /api/pipeline/tick
 *
 * One bounded slice of one run, then commit, then hand off.
 *
 * A full pass cannot be a single request: Vercel kills a function at 300
 * seconds, and paging plus judging is well past that. So a run is a database
 * row and this advances it by exactly one unit of work — the finding stage,
 * or one category, or a handful of triage calls.
 *
 * The property worth protecting is that every slice commits before the next
 * begins. A crash during triage never re-pays for the sweep. Closing the
 * laptop is safe. Deploying mid-run is safe.
 *
 * A tick fires the next one before returning, so a run walks itself forward
 * with nothing watching. If an invocation is lost the run simply stops, which
 * is what the watchdog is for: a schedule hitting this endpoint restarts
 * anything gone quiet, so a lost tick costs minutes rather than the run.
 */
export const maxDuration = 300;

/** Products given a paid opinion per tick. Bounded so a tick always returns. */
const TRIAGE_PER_TICK = 5;

/**
 * How long one invocation keeps working before handing back.
 *
 * Vercel kills the function at 300 seconds, so this stops well short and
 * returns cleanly rather than being cut off mid-slice.
 */
const TIME_BUDGET_MS = 230_000;

async function doOneSlice(request: Request, runId?: string) {
  let run: RunRow | null = null;
  try {
    run = runId ? await getRun(runId) : await nextRunnable();
  } catch (error) {
    return Response.json({ error: describeError(error) }, { status: 502 });
  }

  if (!run) return Response.json({ idle: true, note: "Nothing to do." });
  if (["done", "failed", "halted"].includes(run.status)) {
    return Response.json({ idle: true, run: run.id, status: run.status });
  }

  const p = run.params as Record<string, number>;
  const num = (k: string, d: number) =>
    Number.isFinite(Number(p?.[k])) && Number(p[k]) > 0 ? Number(p[k]) : d;

  try {
    await updateRun(run.id, { ticks: run.ticks + 1, last_tick_at: new Date().toISOString() });

    // ── Stage: find where the market is moving ──────────────────────────
    if (run.status === "queued" || run.status === "finding") {
      await updateRun(run.id, { status: "finding", stage_detail: "asking what has grown in the US" });

      const covered = await alreadyCovered().catch(() => ({
        asins: new Set<string>(),
        categories: new Set<string>(),
      }));

      // Gather across pages rather than stopping at the first that yields
      // anything.
      //
      // The old loop broke as soon as one page produced a single new category,
      // so a run swept one category and finished in four ticks. Each page is a
      // fresh fifty products for about eleven tokens, and the whole point of
      // the job architecture is that a long run is free — there is no reason to
      // stop early when the ceiling is tokens rather than time.
      const wanted = num("categoryLimit", 5);
      const found = new Map<number, { id: number; name: string; risers: number }>();
      let page = num("page", 0);
      const maxPages = num("maxPages", 8);
      let tokensLeft: number | null = null;

      for (let attempt = 0; attempt < maxPages && found.size < wanted; attempt += 1) {
        const risers = await findUsRisers({
          minGrowth: num("minGrowth", 1.5),
          minPrice: num("minPrice", 10),
          maxPrice: num("maxPrice", 60),
          limit: 30,
          page: page + attempt,
        });
        if (risers.asins.length === 0) break;

        const uk = await fetchProductRaw(risers.asins.join(","), KEEPA_DOMAIN.UK, {
          history: false,
          stats: 0,
        });
        tokensLeft = uk.tokensLeft ?? tokensLeft;

        const products = ((uk.raw as Record<string, unknown>).products ??
          []) as Record<string, unknown>[];
        const tally = new Map<number, { id: number; name: string; risers: number }>();
        for (const twin of products) {
          if (isMedia(twin)) continue;
          const tree = (twin.categoryTree ?? []) as { catId: number; name: string }[];
          const leaf = Array.isArray(tree) ? tree[tree.length - 1] : null;
          if (!leaf?.catId) continue;
          const seen = tally.get(leaf.catId);
          if (seen) seen.risers += 1;
          else tally.set(leaf.catId, { id: leaf.catId, name: leaf.name, risers: 1 });
        }

        for (const c of tally.values()) {
          if (covered.categories.has(c.name)) continue;
          const held = found.get(c.id);
          if (held) held.risers += c.risers;
          else found.set(c.id, c);
          if (found.size >= wanted) break;
        }
      }

      const categories = [...found.values()]
        .sort((a, b) => b.risers - a.risers)
        .slice(0, wanted);

      if (categories.length === 0) {
        await updateRun(run.id, {
          status: "done",
          stage_detail: "no new categories",
          error: `Nothing new after ${maxPages} pages of risers. Widen the growth band or the price range.`,
          keepa_tokens_left: tokensLeft,
        });
        return Response.json({ run: run.id, status: "done", categories: 0 });
      }

      await updateRun(run.id, {
        status: "sweeping",
        categories,
        category_cursor: 0,
        stage_detail: `${categories.length} categories to sweep`,
        keepa_tokens_left: tokensLeft,
      });
      return Response.json({ run: run.id, status: "sweeping", categories: categories.map((c) => c.name) });
    }

    // ── Stage: one category per tick ────────────────────────────────────
    if (run.status === "sweeping") {
      const category = run.categories[run.category_cursor];

      if (!category) {
        // Everything swept. Build the paid queue from what survived.
        const covered = await alreadyCovered().catch(() => ({
          asins: new Set<string>(),
          categories: new Set<string>(),
        }));
        const { rows } = await import("@/lib/db").then(async (m) => ({
          rows: await m.listShortlist({ includeKilled: true }),
        }));

        const queue = rows
          .filter(
            (r) =>
              !r.killed_reason &&
              !r.triage_verdict &&
              !covered.asins.has(r.asin) &&
              run!.categories.some((c) => c.name === r.category),
          )
          .slice(0, num("triageLimit", 15))
          .map((r) => r.asin);

        await updateRun(run.id, {
          status: queue.length > 0 ? "triaging" : "done",
          triage_queue: queue,
          triage_cursor: 0,
          stage_detail: queue.length > 0 ? `${queue.length} to judge` : "nothing survived to judge",
        });
        return Response.json({ run: run.id, status: queue.length > 0 ? "triaging" : "done", queued: queue.length });
      }

      await updateRun(run.id, { stage_detail: `sweeping ${category.name}` });

      let found = 0;
      try {
        const search = await findProducts(
          {
            categoryId: category.id,
            minPrice: num("minPrice", 8),
            maxPrice: num("maxPrice", 60),
            maxRank: 200000,
            limit: 10,
          },
          KEEPA_DOMAIN.UK,
        );

        if (search.asins.length > 0) {
          const detail = await fetchProductRaw(search.asins.join(","), KEEPA_DOMAIN.UK, {
            history: false,
            stats: 90,
            listing: true,
          });
          const products = ((detail.raw as Record<string, unknown>).products ??
            []) as Record<string, unknown>[];

          const scored = products.map((x) => judgeFreely(buildCandidate(x, category.name)));
          const { unique } = dedupeVariations(scored);
          const { capped } = capPerCategory(unique, num("maxPerCategory", MAX_PER_CATEGORY));

          await saveScoutCandidates(
            capped.map((c) => ({
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
              parent_asin: c.parentAsin,
              has_aplus: c.hasAplus,
              video_count: c.videoCount,
              found_via: "us risers",
            })),
          );

          found = capped.length;
          await updateRun(run.id, {
            scanned: run.scanned + capped.length,
            killed: run.killed + capped.filter((c) => c.killed).length,
            keepa_tokens_left: detail.tokensLeft ?? run.keepa_tokens_left,
          });
        }
      } catch (error) {
        // One dead category must not end the run.
        await updateRun(run.id, { stage_detail: `${category.name} failed: ${describeError(error)}` });
      }

      await updateRun(run.id, { category_cursor: run.category_cursor + 1 });
      return Response.json({ run: run.id, status: "sweeping", category: category.name, found });
    }

    // ── Stage: a few paid opinions per tick ─────────────────────────────
    if (run.status === "triaging") {
      const slice = run.triage_queue.slice(
        run.triage_cursor,
        run.triage_cursor + TRIAGE_PER_TICK,
      );

      if (slice.length === 0) {
        await updateRun(run.id, { status: "done", stage_detail: "finished" });
        return Response.json({ run: run.id, status: "done", triaged: run.triaged });
      }

      let spent = Number(run.spent_pence);
      let judged = run.triaged;

      for (const asin of slice) {
        // Checked before every paid call, not once at the start. A cap that
        // is only consulted on entry is not a cap.
        if (spent >= Number(run.cap_pence)) {
          await updateRun(run.id, {
            status: "halted",
            spent_pence: spent,
            error: `Stopped at the ${run.cap_pence}p cap having spent ${spent.toFixed(2)}p. Raise cap_pence and tick again to continue.`,
          });
          return Response.json({ run: run.id, status: "halted", spent });
        }

        try {
          const candidate = await getCandidate(asin);
          if (!candidate) continue;

          const result = await guardedTriage((client) =>
            client.messages.create({
              model: TRIAGE_MODEL,
              max_tokens: 2000,
              output_config: { effort: "low", format: zodOutputFormat(TriageSchema) },
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
                    title: candidate.title,
                    brand: candidate.brand,
                    category: candidate.category,
                    price: candidate.price,
                    rating: candidate.rating,
                    reviewCount: candidate.review_count,
                    monthlySold: candidate.monthly_sold,
                    packageWeightG: candidate.weight_grams,
                    maxLandedCost: candidate.max_landed_cost,
                    listingWeaknesses: (candidate.listing_weaknesses || "")
                      .split(" · ")
                      .filter(Boolean),
                    usGrowing: candidate.us_growing,
                  }),
                },
              ],
            }),
          );

          spent += priceTriage(result.usage).costPence;

          const parsed = TriageSchema.safeParse(
            JSON.parse(result.content.find((b) => b.type === "text")?.text ?? "{}"),
          );
          if (parsed.success) {
            // Not wrapped in a catch that shrugs. A verdict that has been paid
            // for and cannot be stored is worth failing the run over, because
            // the alternative is what happened here: half the verdicts saved,
            // half lost, and the run reporting success.
            await saveTriageVerdict(asin, {
              triage_verdict: parsed.data.verdict,
              triage_because: parsed.data.reason,
              // Rounded to one decimal to match the column. The model returns
              // things like 6.5, and an integer column silently rejected them.
              triage_improvability: Math.round(parsed.data.improvability * 10) / 10,
              triage_main_risk: parsed.data.mainRisk,
            });
            judged += 1;
          }
        } catch (error) {
          // A single failed product is not a failed run.
          await updateRun(run.id, { stage_detail: `${asin}: ${describeError(error)}` });
        }
      }

      const cursor = run.triage_cursor + slice.length;
      const finished = cursor >= run.triage_queue.length;

      await updateRun(run.id, {
        triage_cursor: cursor,
        triaged: judged,
        spent_pence: spent,
        status: finished ? "done" : "triaging",
        stage_detail: finished ? "finished" : `${run.triage_queue.length - cursor} left to judge`,
      });

      if (!finished) return Response.json({
        run: run.id,
        status: finished ? "done" : "triaging",
        judgedThisTick: slice.length,
        spentPence: Math.round(spent * 100) / 100,
      });
    }

    return Response.json({ run: run.id, status: run.status, note: "Nothing to do for this status." });
  } catch (error) {
    if (run) {
      await updateRun(run.id, { status: "failed", error: describeError(error) }).catch(() => {});
    }
    return Response.json({ error: describeError(error) }, { status: 502 });
  }
}


/**
 * POST /api/pipeline/tick
 *
 * Works one run forward for as long as it safely can, then hands back.
 *
 * The first two designs had each slice call the next over HTTP — an unawaited
 * fetch, then `after`. Both died after a handful of slices: a run would sit at
 * "sweeping Aprons" with three of twelve categories done and nothing wrong in
 * any log. Calling yourself over HTTP on a serverless platform turns out to be
 * the unreliable part, and every failure was silent, which is the worst kind.
 *
 * So there is no chain. One invocation loops over slices, committing each
 * before starting the next, until the run finishes or the time budget is
 * nearly spent. The watchdog then starts a fresh invocation for whatever is
 * left, which is the same mechanism that recovers a crash — one path rather
 * than two, and the recovery path is exercised on every long run rather than
 * only in emergencies.
 *
 * What made the chain worth trying is preserved: each slice still commits
 * before the next begins, so nothing is ever re-paid.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { runId?: string };
  const started = Date.now();
  const slices: unknown[] = [];

  for (let i = 0; i < 60; i += 1) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      return Response.json({
        slices,
        handedBack: true,
        note: "Time budget reached. The run is committed where it got to; the next invocation carries on.",
      });
    }

    const response = await doOneSlice(request, body.runId);
    const result = (await response.json()) as Record<string, unknown>;
    slices.push(result);

    if (result.idle || result.error) break;
    if (["done", "failed", "halted"].includes(String(result.status))) break;
  }

  return Response.json({ slices, seconds: Math.round((Date.now() - started) / 1000) });
}
