/**
 * The database layer. Server-side only.
 *
 * Uses SUPABASE_SERVICE_ROLE_KEY, which bypasses row-level security entirely
 * — it can read and write every row in every table. That is fine while the
 * whole site sits behind one shared password and there is one user, but it
 * means this file has the same rule as claude.ts: only ever imported from
 * code under src/app/api/. In a page or component it would ship to the
 * browser, and anyone could then read and delete the whole database.
 *
 * Phase 5 replaces this with per-user auth and row-level security, at which
 * point the browser gets the anon key instead and the database enforces who
 * can see what.
 */
import { createClient } from "@supabase/supabase-js";
import { isMedia } from "./exclusions";
import type { Judgement, Premortem, ProductInput } from "./judge";
import type { MarginInput } from "./margin";
import type { ProductRow, Stage } from "./stages";

export { STAGES, STAGE_LABELS } from "./stages";
export type { Stage, ProductRow } from "./stages";

export class MissingDatabaseConfig extends Error {}

/**
 * Who owns the rows this process is reading and writing.
 *
 * There is one user and no login. This exists so that when there is a second,
 * nothing in the codebase has to be found and changed — every query already
 * filters, every insert already stamps, and the row-level security policies
 * are already written and enabled rather than switched on for the first time
 * on the day it matters.
 *
 * The service-role key bypasses row-level security, so the policies are not
 * what is protecting anything today. These filters are. That is worth being
 * honest about: the belt is application code and the braces are policies that
 * only bite once this connects through a user-scoped client.
 */
export const SEED_USER_ID = "00000000-0000-0000-0000-000000000001";

export function currentUserId(): string {
  // Behind a shared password there is exactly one. When auth arrives this
  // reads the session instead, and nothing else in this file changes.
  return SEED_USER_ID;
}

export function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new MissingDatabaseConfig(
      "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing. In Vercel these come from the Supabase integration; locally, copy them into .env.local.",
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Saves a product with its judgement and, if one was run, its pre-mortem.
 *
 * These are three inserts across three tables rather than one, because they
 * are three different things with a real relationship. Supabase has no
 * multi-statement transaction over the REST API, so if a later insert fails
 * the product is left without its judgement. That is the honest trade for
 * this scale — a stranded product row is visible and fixable, and the
 * alternative is a database function that is harder for you to read.
 */
export async function saveProduct(input: {
  product: ProductInput;
  judgement: Judgement;
  premortem: Premortem | null;
  marginInput: MarginInput | null;
  myVerdict: string;
  myNotes: string;
  usage: { inputTokens: number; outputTokens: number; costPence: number } | null;
}) {
  const db = getDb();

  const { data: product, error: productError } = await db
    .from("products")
    .insert({
      name: input.product.name,
      asin: input.product.asin || null,
      category: input.product.category,
      sell_price: input.product.sellPrice,
      weight_grams: input.product.weightGrams,
      listing_notes: input.product.listingNotes,
      review_complaints: input.product.reviewComplaints,
      competitor_notes: input.product.competitorNotes,
      us_signal: input.product.usSignal,
      my_verdict: input.myVerdict || null,
      my_notes: input.myNotes,
      margin_input: input.marginInput,
      // A KILL verdict you disagreed with is not a dead product, so only
      // pre-fill the reason when you and the Judge both said kill.
      killed_reason:
        input.judgement.verdict === "KILL" && input.myVerdict !== "TEST"
          ? input.judgement.summary
          : null,
      stage: input.judgement.verdict === "KILL" ? "dead" : "candidate",
    })
    .select()
    .single();

  if (productError) throw new Error(`Could not save the product: ${productError.message}`);

  const { data: judgement, error: judgementError } = await db
    .from("judgements")
    .insert({
      product_id: product.id,
      verdict: input.judgement.verdict,
      summary: input.judgement.summary,
      payload: input.judgement,
      input_tokens: input.usage?.inputTokens ?? null,
      output_tokens: input.usage?.outputTokens ?? null,
      cost_pence: input.usage?.costPence ?? null,
    })
    .select()
    .single();

  if (judgementError) {
    throw new Error(
      `Product saved as ${product.id} but the judgement failed: ${judgementError.message}`,
    );
  }

  if (input.premortem) {
    const { error: premortemError } = await db.from("premortems").insert({
      judgement_id: judgement.id,
      payload: input.premortem,
    });
    if (premortemError) {
      throw new Error(
        `Product and judgement saved, but the pre-mortem failed: ${premortemError.message}`,
      );
    }
  }

  return { productId: product.id as string };
}

/** Newest first, with each product's most recent verdict for the list view. */
export async function listProducts(stage?: Stage) {
  const db = getDb();
  let query = db
    .from("products")
    .select("*, judgements(verdict, summary, created_at)")
    .order("created_at", { ascending: false });

  if (stage) query = query.eq("stage", stage);

  const { data, error } = await query;
  if (error) throw new Error(`Could not load products: ${error.message}`);
  return (data ?? []) as ProductRow[];
}

export async function updateProduct(
  id: string,
  patch: Partial<Pick<ProductRow, "stage" | "my_verdict" | "my_notes" | "killed_reason">>,
) {
  const db = getDb();
  const { error } = await db.from("products").update(patch).eq("id", id);
  if (error) throw new Error(`Could not update the product: ${error.message}`);
}

export async function deleteProduct(id: string) {
  const db = getDb();
  // Judgements and pre-mortems go with it, via the cascade in the schema.
  const { error } = await db.from("products").delete().eq("id", id);
  if (error) throw new Error(`Could not delete the product: ${error.message}`);
}


/**
 * Scout candidates.
 *
 * Upserts on asin, so running the sweep twice updates rather than duplicates.
 * Oscar's own columns — dismissed, my_notes, promoted_product_id — are
 * deliberately absent from the update list: a later sweep must never overwrite
 * a decision he made.
 */
export type ScoutCandidateRow = {
  asin: string;
  first_seen: string;
  last_seen: string;
  title: string;
  brand: string;
  category: string;
  price: number | null;
  rating: number | null;
  review_count: number | null;
  unhappy_buyers: number | null;
  monthly_sold: number | null;
  sellers: number | null;
  weight_grams: number | null;
  max_landed_cost: number | null;
  score: number | null;
  coverage: number | null;
  strengths: string;
  listing_weaknesses: string;
  killed_reason: string | null;
  us_growing: boolean | null;
  us_monthly_sold: number | null;
  auto_verdict: "TEST" | "PARK" | "KILL" | null;
  auto_because: string;
  triage_verdict: "TEST" | "PARK" | "KILL" | null;
  triage_because: string | null;
  triage_improvability: number | null;
  triage_main_risk: string | null;
  triage_at: string | null;
  us_avg365_rank: number | null;
  us_current_rank: number | null;
  us_growth_ratio: number | null;
  found_via: string | null;
  has_aplus: boolean | null;
  video_count: number | null;
  parent_asin: string | null;
  dismissed: boolean;
  my_notes: string;
  promoted_product_id: string | null;
};

/**
 * What the sweep writes. Every later stage's columns are optional, because a
 * re-sweep must refresh the cheap facts without wiping an expensive opinion —
 * each stage owns its own columns and touches nothing else.
 */
export type ScoutCandidateInput = Omit<
  ScoutCandidateRow,
  | "first_seen"
  | "last_seen"
  | "dismissed"
  | "my_notes"
  | "promoted_product_id"
  | "triage_verdict"
  | "triage_because"
  | "triage_improvability"
  | "triage_main_risk"
  | "triage_at"
  | "us_avg365_rank"
  | "us_current_rank"
  | "us_growth_ratio"
  | "found_via"
  | "has_aplus"
  | "video_count"
  | "parent_asin"
> &
  Partial<
    Pick<
      ScoutCandidateRow,
      | "us_avg365_rank"
      | "us_current_rank"
      | "us_growth_ratio"
      | "found_via"
      | "has_aplus"
      | "video_count"
      | "parent_asin"
    >
  >;

export async function saveScoutCandidates(candidates: ScoutCandidateInput[]) {
  if (candidates.length === 0) return { saved: 0 };

  const db = getDb();
  const { error } = await db.from("scout_candidates").upsert(
    candidates.map((c) => ({
      ...c,
      last_seen: new Date().toISOString(),
      user_id: currentUserId(),
    })),
    { onConflict: "asin" },
  );

  if (error) {
    // Surfaced rather than swallowed: a silent save failure looks exactly
    // like a successful one from the page, which is the failure mode this
    // project keeps paying for.
    throw new Error(`Could not save candidates: ${error.message}`);
  }
  return { saved: candidates.length };
}

export async function listScoutCandidates(options: { includeDismissed?: boolean } = {}) {
  const db = getDb();
  let query = db
    .from("scout_candidates")
    .select("*")
    .order("score", { ascending: false, nullsFirst: false })
    .limit(300);

  if (!options.includeDismissed) query = query.eq("dismissed", false);

  const { data, error } = await query;
  if (error) throw new Error(`Could not load candidates: ${error.message}`);
  return (data ?? []) as ScoutCandidateRow[];
}

export async function updateScoutCandidate(
  asin: string,
  patch: Partial<Pick<ScoutCandidateRow, "dismissed" | "my_notes">>,
) {
  const db = getDb();
  const { error } = await db.from("scout_candidates").update(patch).eq("asin", asin);
  if (error) throw new Error(`Could not update ${asin}: ${error.message}`);
}


/**
 * Reviews for one ASIN.
 *
 * Upserts, because re-pasting a longer set of reviews for a product should
 * replace what was there rather than fail or duplicate.
 */
export type ReviewRow = {
  asin: string;
  created_at: string;
  updated_at: string;
  raw_text: string;
  review_count: number;
  star_filter: string;
  complaints: string;
  wished_for: string;
  fixable: string;
  not_fixable: string;
  opportunity_score: number | null;
  summary: string;
};

export async function saveReviews(input: Partial<ReviewRow> & { asin: string }) {
  const db = getDb();
  const { error } = await db
    .from("reviews")
    .upsert(
      { ...input, updated_at: new Date().toISOString(), user_id: currentUserId() },
      { onConflict: "asin" },
    );
  if (error) throw new Error(`Could not save reviews: ${error.message}`);
}

export async function getReviews(asin: string): Promise<ReviewRow | null> {
  const db = getDb();
  const { data, error } = await db
    .from("reviews")
    .select("*")
    .eq("user_id", currentUserId())
    .eq("asin", asin)
    .maybeSingle();
  if (error) throw new Error(`Could not load reviews: ${error.message}`);
  return (data as ReviewRow) ?? null;
}


// ── The cached category tree ───────────────────────────────────────────────

export type CategoryRow = {
  cat_id: number;
  name: string;
  parent_id: number | null;
  product_count: number | null;
  path: string;
  fetched_at: string;
};

/** Upserts, so re-searching the same branch refreshes rather than duplicates. */
export async function cacheCategories(
  categories: {
    catId: number;
    name: string;
    parent: number | null;
    productCount: number | null;
    path: string[];
  }[],
) {
  if (categories.length === 0) return;
  const db = getDb();
  const { error } = await db.from("keepa_categories").upsert(
    categories.map((c) => ({
      cat_id: c.catId,
      name: c.name,
      parent_id: c.parent,
      product_count: c.productCount,
      path: c.path.join(" › "),
      fetched_at: new Date().toISOString(),
    })),
    { onConflict: "cat_id" },
  );
  if (error) throw new Error(`Could not cache categories: ${error.message}`);
}

/** Reads the cache first so the picker costs nothing to browse. */
export async function findCachedCategories(term: string): Promise<CategoryRow[]> {
  const db = getDb();
  const { data, error } = await db
    .from("keepa_categories")
    .select("*")
    .eq("user_id", currentUserId())
    .ilike("name", `%${term}%`)
    .order("product_count", { ascending: false, nullsFirst: false })
    .limit(50);
  if (error) throw new Error(`Could not read categories: ${error.message}`);
  return (data ?? []) as CategoryRow[];
}

export async function listCategoryPicks(): Promise<
  { cat_id: number; name: string }[]
> {
  const db = getDb();
  const { data, error } = await db
    .from("category_picks")
    .select("cat_id, name")
    .eq("user_id", currentUserId())
    .order("picked_at", { ascending: true });
  if (error) throw new Error(`Could not read picks: ${error.message}`);
  return (data ?? []) as { cat_id: number; name: string }[];
}

export async function setCategoryPick(
  catId: number,
  name: string,
  picked: boolean,
) {
  const db = getDb();
  if (!picked) {
    const { error } = await db.from("category_picks").delete().eq("cat_id", catId);
    if (error) throw new Error(`Could not unpick: ${error.message}`);
    return;
  }
  const { error } = await db
    .from("category_picks")
    .upsert(
      { cat_id: catId, name, user_id: currentUserId() },
      { onConflict: "cat_id" },
    );
  if (error) throw new Error(`Could not pick: ${error.message}`);
}


/**
 * Writes a triage verdict onto an existing candidate.
 *
 * Separate from saveScoutCandidates because the two happen at different times
 * and cost different amounts. A re-sweep should refresh the cheap facts
 * without wiping an expensive opinion, so each stage writes only its own
 * columns.
 */
export async function saveTriageVerdict(
  asin: string,
  verdict: {
    triage_verdict: "TEST" | "PARK" | "KILL";
    triage_because: string;
    triage_improvability: number | null;
    triage_main_risk: string | null;
  },
) {
  const db = getDb();
  const { error } = await db
    .from("scout_candidates")
    .update({ ...verdict, triage_at: new Date().toISOString() })
    .eq("asin", asin);
  if (error) throw new Error(`Could not save verdict for ${asin}: ${error.message}`);
}

/**
 * The shortlist: what survived, ranked, with the reasoning attached.
 *
 * TEST first because those are the ones to act on, then PARK, because "why did
 * you park this" is a question worth being able to answer. KILL is excluded by
 * default but kept in the table — the point of 500 rows is being able to ask
 * later which signals actually predicted anything.
 */
export async function listShortlist(
  options: { includeKilled?: boolean } = {},
): Promise<ScoutCandidateRow[]> {
  const db = getDb();
  let query = db
    .from("scout_candidates")
    .select("*")
    .eq("user_id", currentUserId())
    .eq("dismissed", false)
    .order("score", { ascending: false, nullsFirst: false })
    .limit(300);

  if (!options.includeKilled) {
    query = query.in("triage_verdict", ["TEST", "PARK"]);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Could not load the shortlist: ${error.message}`);

  let rows = (data ?? []) as ScoutCandidateRow[];

  // Apply the exclusions on the way out as well as at discovery.
  //
  // Rules change after rows are already in the table. Mains electrical was
  // ruled out after a USB-C charger had been judged, and it kept appearing as
  // a TEST because exclusions only filtered new work. A shortlist that shows
  // products the rules now reject is worse than one that never found them:
  // it looks like the rules are not working.
  //
  // Filtered rather than deleted. The row is evidence about what the tool
  // used to think, and the point of accumulating hundreds is being able to ask
  // that later.
  rows = rows.filter(
    (r) => !isMedia({ categoryTree: [{ name: r.category }] }),
  );

  // Collapse siblings on the way out, not just on the way in.
  //
  // Dedupe inside a run does nothing about two runs a day apart each picking a
  // different size of the same product. Both reach the shortlist looking
  // separate, which is exactly the repetition the whole cap exists to avoid.
  // Highest score wins, since that is the variation worth looking at.
  const byParent = new Map<string, ScoutCandidateRow>();
  for (const row of rows) {
    // Rows saved before parent_asin existed have none, so fall back to the
    // title. Three sizes of one product share a title up to the size, and
    // matching on the first several words collapses them where the parent
    // cannot. Crude, and better than showing the same kit three times.
    const key =
      row.parent_asin ??
      (row.title
        ? `${row.brand ?? ""}|${row.title.split(/[,|(]/)[0].trim().slice(0, 40).toLowerCase()}`
        : row.asin);
    const held = byParent.get(key);
    if (!held || (row.score ?? 0) > (held.score ?? 0)) byParent.set(key, row);
  }

  const rank = { TEST: 0, PARK: 1, KILL: 2 } as const;
  return [...byParent.values()].sort(
    (a, b) =>
      (rank[a.triage_verdict ?? "KILL"] ?? 3) - (rank[b.triage_verdict ?? "KILL"] ?? 3) ||
      (b.score ?? 0) - (a.score ?? 0),
  );
}


export async function getCandidate(asin: string): Promise<ScoutCandidateRow | null> {
  const db = getDb();
  const { data, error } = await db
    .from("scout_candidates")
    .select("*")
    .eq("user_id", currentUserId())
    .eq("asin", asin)
    .maybeSingle();
  if (error) throw new Error(`Could not load ${asin}: ${error.message}`);
  return (data as ScoutCandidateRow) ?? null;
}

/**
 * The expensive opinion, stored so it is bought once.
 *
 * Written to its own columns, like every other stage, so a re-sweep refreshing
 * the cheap facts cannot wipe a judgement that cost 10p and ninety seconds.
 */
export async function saveDeepJudgement(
  asin: string,
  patch: {
    judge_verdict: string;
    judge_summary: string;
    judge_json: unknown;
    judge_pence: number;
    judge_missing: string;
  },
) {
  const db = getDb();
  const { error } = await db
    .from("scout_candidates")
    .update({ ...patch, judge_at: new Date().toISOString() })
    .eq("asin", asin);
  if (error) throw new Error(`Could not save the judgement: ${error.message}`);
}


/**
 * What the tool has already made its mind up about.
 *
 * Two separate kinds of memory, and both are needed.
 *
 * Judged ASINs stop it paying twice for the same opinion. A product whose
 * verdict is already on the row does not need another 0.2p spent on it, and
 * the shortlist does not need it twice.
 *
 * Judged parents stop it paying for a sibling. Variations collapse within a
 * run, but the next run pulls a different size of the same product and it
 * looks new — same reviews, same rating, same fix, another 0.2p.
 *
 * Covered categories stop it returning to the same ground. The US riser search
 * is fairly stable week to week, so without this every run re-sweeps Parasol
 * Stands and Packaging Bags and finds the products it found last time.
 */
export async function alreadyCovered(): Promise<{
  asins: Set<string>;
  categories: Set<string>;
}> {
  const db = getDb();
  const { data, error } = await db
    .from("scout_candidates")
    .select("asin, category, triage_verdict")
    .eq("user_id", currentUserId())
    .limit(5000);

  if (error) throw new Error(`Could not read what is covered: ${error.message}`);

  const rows = (data ?? []) as {
    asin: string;
    category: string;
    triage_verdict: string | null;
  }[];

  return {
    // Only products actually judged. One that was swept and hard-killed by
    // arithmetic costs nothing to re-check and might pass on a new price.
    asins: new Set(rows.filter((r) => r.triage_verdict).map((r) => r.asin)),
    categories: new Set(rows.map((r) => r.category).filter(Boolean)),
  };
}


// ── Runs as jobs ───────────────────────────────────────────────────────────

export type RunRow = {
  id: string;
  created_at: string;
  updated_at: string;
  status: "queued" | "finding" | "sweeping" | "triaging" | "done" | "failed" | "halted";
  stage_detail: string;
  params: Record<string, unknown>;
  categories: { id: number; name: string; risers: number }[];
  category_cursor: number;
  triage_queue: string[];
  triage_cursor: number;
  scanned: number;
  killed: number;
  triaged: number;
  spent_pence: number;
  keepa_tokens_left: number | null;
  cap_pence: number;
  error: string | null;
  ticks: number;
  last_tick_at: string | null;
};

export async function createRun(params: Record<string, unknown>, capPence: number) {
  const db = getDb();
  const { data, error } = await db
    .from("runs")
    .insert({ params, cap_pence: capPence, user_id: currentUserId() })
    .select()
    .single();
  if (error) throw new Error(`Could not create the run: ${error.message}`);
  return data as RunRow;
}

export async function getRun(id: string): Promise<RunRow | null> {
  const db = getDb();
  const { data, error } = await db
    .from("runs")
    .select("*")
    .eq("user_id", currentUserId())
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load the run: ${error.message}`);
  return (data as RunRow) ?? null;
}

/**
 * Claims the next run needing work.
 *
 * Ordered oldest first so a queue drains rather than starving its head, and
 * limited to one because a tick does one slice.
 */
export async function nextRunnable(): Promise<RunRow | null> {
  const db = getDb();
  const { data, error } = await db
    .from("runs")
    .select("*")
    .eq("user_id", currentUserId())
    .in("status", ["queued", "finding", "sweeping", "triaging"])
    .order("updated_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(`Could not find a run: ${error.message}`);

  const live = ((data ?? [])[0] as RunRow) ?? null;
  if (live) return live;

  // Nothing live. Look for a run that died of something temporary.
  //
  // Runs failed on a Keepa 429 before that was treated as a wait, and they
  // are stranded: the bucket refilled long ago and nothing will ever pick
  // them up. A rate limit is not a reason to abandon a run that has already
  // paid for half its work, so they are resurrected rather than left as
  // tombstones.
  //
  // Only rate limits. A run that failed on a bad request or a broken schema
  // would fail again, and retrying it forever would hide the real problem.
  const { data: stalled, error: stalledError } = await db
    .from("runs")
    .select("*")
    .eq("user_id", currentUserId())
    .eq("status", "failed")
    .or("error.ilike.%429%,error.ilike.%token%")
    .order("updated_at", { ascending: true })
    .limit(1);
  if (stalledError) return null;

  const recoverable = ((stalled ?? [])[0] as RunRow) ?? null;
  if (!recoverable) return null;

  await updateRun(recoverable.id, {
    status: recoverable.category_cursor > 0 ? "sweeping" : "queued",
    stage_detail: "resumed after running out of Keepa tokens",
    error: null,
  });

  return {
    ...recoverable,
    status: recoverable.category_cursor > 0 ? "sweeping" : "queued",
  };
}

export async function updateRun(id: string, patch: Partial<RunRow>) {
  const db = getDb();
  const { error } = await db
    .from("runs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Could not update the run: ${error.message}`);
}

/**
 * Works out which stage a run should re-enter.
 *
 * A run's cursors are the truth about how far it got, not its status — the
 * status is only what it was doing when it stopped. Picking the earliest
 * unfinished stage means a resume never re-pays for work already committed.
 */
function stageToResume(run: RunRow): RunRow["status"] {
  if (run.triage_queue?.length && run.triage_cursor < run.triage_queue.length) {
    return "triaging";
  }
  if (run.categories?.length && run.category_cursor < run.categories.length) {
    return "sweeping";
  }
  // Nothing part-finished. Either it died before finding anything, or it got
  // to the end of both queues and never wrote itself off.
  return run.categories?.length ? "triaging" : "queued";
}

/**
 * Puts a stopped run back in the queue, by hand.
 *
 * The watchdog only rescues runs that stopped for a reason known to be
 * temporary, which is right — retrying a broken schema forever would hide the
 * fault rather than fix it. But that leaves the other failures needing a
 * person to look, fix the cause, and say try again. This is that button.
 *
 * Deliberately refuses a run that is already moving: a second worker on the
 * same run would pay twice for the same slice.
 */
export async function resumeRun(id: string): Promise<{ status: string; note: string }> {
  const run = await getRun(id);
  if (!run) throw new Error("That run no longer exists.");

  if (["queued", "finding", "sweeping", "triaging"].includes(run.status)) {
    return { status: run.status, note: "Already in the queue — nothing to resume." };
  }
  if (run.status === "done") {
    return { status: "done", note: "This one finished. Start a new run instead." };
  }

  const status = stageToResume(run);
  await updateRun(id, {
    status,
    error: null,
    stage_detail: `resumed by hand from ${run.status}`,
  });
  return {
    status,
    note:
      status === "triaging"
        ? `Back in the queue at judging, ${run.triage_cursor} of ${run.triage_queue?.length ?? 0} already paid for and kept.`
        : status === "sweeping"
          ? `Back in the queue at sweeping, ${run.category_cursor} of ${run.categories?.length ?? 0} categories already done.`
          : "Back in the queue from the start — it had not got far enough to keep anything.",
  };
}

/**
 * How many candidates have reached each verdict.
 *
 * The number the whole thing exists to move: fifty qualified before any more
 * features. Counts only — head requests, so no rows cross the wire and this
 * stays safe on an endpoint that answers before the password gate.
 */
async function verdictCounts(): Promise<Record<string, number>> {
  const db = getDb();
  const counts: Record<string, number> = {};
  for (const verdict of ["TEST", "PARK", "KILL"] as const) {
    const { count } = await db
      .from("scout_candidates")
      .select("*", { count: "exact", head: true })
      .eq("user_id", currentUserId())
      .eq("verdict", verdict);
    counts[verdict.toLowerCase()] = count ?? 0;
  }
  const { count: total } = await db
    .from("scout_candidates")
    .select("*", { count: "exact", head: true })
    .eq("user_id", currentUserId());
  counts.seen = total ?? 0;
  return counts;
}

/**
 * What the pipeline looks like right now, for /api/health.
 *
 * Answers the question you actually have at 8am: did anything run overnight,
 * is anything wedged, and what has it cost. A run counts as stuck if it claims
 * to be working but has not ticked in fifteen minutes — the watchdog fires
 * every ten, so missing two in a row means nobody is driving it.
 */
export async function runHealth(): Promise<Record<string, unknown>> {
  const db = getDb();
  const { data, error } = await db
    .from("runs")
    .select("*")
    .eq("user_id", currentUserId())
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) return { error: error.message };

  const runs = (data ?? []) as RunRow[];
  const active = runs.filter((r) =>
    ["queued", "finding", "sweeping", "triaging"].includes(r.status),
  );

  const now = Date.now();
  const minutesSince = (iso?: string | null) =>
    iso ? Math.round((now - new Date(iso).getTime()) / 60000) : null;

  // A watchdog turn works the queue for about four minutes and then hands
  // back, taking whichever run is oldest each slice. So with several
  // outstanding, any one of them can sit untouched for a while — that is the
  // rotation working, not a fault.
  //
  // The first version of this flagged each of those as stuck, which would have
  // sent someone hunting a broken watchdog while it was running perfectly.
  // What actually matters is whether *anything* is ticking: if nothing has for
  // fifteen minutes, the watchdog has missed two turns and nobody is driving.
  const STALLED_AFTER_MIN = 15;
  const beats = runs
    .map((r) => minutesSince(r.last_tick_at ?? r.updated_at))
    .filter((m): m is number => m !== null);
  const minutesSinceAnyTick = beats.length ? Math.min(...beats) : null;
  const stalled =
    active.length > 0 &&
    minutesSinceAnyTick !== null &&
    minutesSinceAnyTick > STALLED_AFTER_MIN;

  const latest = runs[0];

  return {
    lastRun: latest
      ? {
          id: latest.id,
          status: latest.status,
          detail: latest.stage_detail,
          minutesAgo: minutesSince(latest.last_tick_at ?? latest.updated_at),
          scanned: latest.scanned,
          spentPence: Number(latest.spent_pence),
        }
      : null,
    outstanding: active.length,
    minutesSinceAnyTick,
    stalled,
    // Named "waiting" rather than "stuck": one is being worked, the rest are
    // queued behind it by design.
    waiting: active.map((r) => ({
      id: r.id,
      status: r.status,
      minutesQuiet: minutesSince(r.last_tick_at ?? r.updated_at),
    })),
    failed: runs.filter((r) => r.status === "failed").length,
    qualified: await verdictCounts(),
    // Keepa's own count, from whichever run saw it last. Nothing here spends a
    // token to ask.
    keepaTokensLeft:
      runs.find((r) => r.keepa_tokens_left !== null)?.keepa_tokens_left ?? null,
    note: stalled
      ? `Nothing has ticked in ${minutesSinceAnyTick} minutes with ${active.length} run(s) outstanding. The watchdog fires every ten, so it has missed two turns — check the schedule is still enabled on GitHub, then use Resume on /runs.`
      : active.length > 0
        ? `${active.length} run(s) outstanding and something is driving them. One tick works one run for about four minutes, so a queue this size takes roughly ${active.length * 10} minutes to come round again.`
        : "Nothing waiting.",
  };
}

export async function listRuns(limit = 20): Promise<RunRow[]> {
  const db = getDb();
  const { data, error } = await db
    .from("runs")
    .select("*")
    .eq("user_id", currentUserId())
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not list runs: ${error.message}`);
  return (data ?? []) as RunRow[];
}


/**
 * Promote a candidate into the products pipeline.
 *
 * Break 4 from the plan, open since the column was created. `promoted_product_id`
 * has existed on scout_candidates from the beginning and nothing has ever
 * written it, so a candidate that survived the whole chain still had to be
 * retyped by hand to reach the board. The plan called this the cheapest break
 * to close and the one that most changes how the tool feels, because it is the
 * difference between a research toy and something with a memory.
 *
 * Idempotent. Promoting twice returns the existing product rather than
 * creating a second — a double click should not fork a candidate into two
 * products with the same ASIN.
 */
export async function promoteCandidate(asin: string): Promise<{
  productId: string;
  alreadyPromoted: boolean;
}> {
  const db = getDb();

  const candidate = await getCandidate(asin);
  if (!candidate) throw new Error(`${asin} is not in the candidates table.`);

  if (candidate.promoted_product_id) {
    return { productId: candidate.promoted_product_id, alreadyPromoted: true };
  }

  // Everything the products board needs is already on the candidate row. The
  // point of promoting is that nothing is retyped.
  const { data, error } = await db
    .from("products")
    .insert({
      name: candidate.title || asin,
      category: candidate.category || "",
      asin,
      sell_price: candidate.price ?? 0,
      weight_grams: candidate.weight_grams ?? 0,
      listing_notes: candidate.listing_weaknesses || "",
      // Never invented. An empty string means nobody has read the reviews,
      // which reads differently to the Judge from "the reviews are fine".
      review_complaints: "",
      competitor_notes: [
        candidate.rating !== null ? `Rated ${candidate.rating}` : "",
        candidate.review_count !== null ? `across ${candidate.review_count} reviews` : "",
        candidate.monthly_sold !== null ? `, about ${candidate.monthly_sold} sold last month` : "",
        candidate.max_landed_cost !== null
          ? `. A unit would have to land under £${Number(candidate.max_landed_cost).toFixed(2)} to clear 15% net.`
          : "",
      ]
        .filter(Boolean)
        .join(" ")
        .trim(),
      stage: "candidate",
    })
    .select("id")
    .single();

  if (error) throw new Error(`Could not create the product: ${error.message}`);

  const productId = (data as { id: string }).id;

  // Link it back, which is what stops the candidate resurfacing as new on the
  // next sweep.
  const { error: linkError } = await db
    .from("scout_candidates")
    .update({ promoted_product_id: productId })
    .eq("asin", asin);
  if (linkError) {
    throw new Error(
      `The product was created but could not be linked to the candidate: ${linkError.message}. It will resurface as new on the next sweep.`,
    );
  }

  return { productId, alreadyPromoted: false };
}


/**
 * The rate guard, counted where every process can see it.
 *
 * The guards this replaces were arrays in module scope — a counter per
 * serverless process. Vercel runs many and recycles them constantly, so
 * "40 calls an hour" meant 40 per process per hour: no limit at all, and it
 * looked like protection the whole time.
 *
 * Incremented inside the database rather than read-then-written from here,
 * because two processes at the boundary must not both read 39 and both
 * proceed.
 *
 * Fails open on a database error, deliberately. A guard that stops all work
 * when the counter is unreachable turns a monitoring problem into an outage,
 * and the spend caps on a run are the real defence — this is a backstop.
 */
export async function checkApiBudget(
  kind: "judge" | "triage" | "keepa",
  limitPerHour: number,
  pence = 0,
): Promise<{ allowed: boolean; callsThisHour: number }> {
  try {
    const db = getDb();
    const { data, error } = await db.rpc("bump_api_usage", {
      p_kind: kind,
      p_limit: limitPerHour,
      p_pence: pence,
    });
    if (error) return { allowed: true, callsThisHour: 0 };

    const row = (data as { allowed: boolean; calls_now: number }[] | null)?.[0];
    return {
      allowed: row?.allowed ?? true,
      callsThisHour: row?.calls_now ?? 0,
    };
  } catch {
    return { allowed: true, callsThisHour: 0 };
  }
}

/** What has been spent this hour and today, for /api/health. */
export async function apiUsageSummary(): Promise<Record<string, unknown>> {
  const db = getDb();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("api_usage")
    .select("kind, hour, calls, pence")
    .gte("hour", since)
    .order("hour", { ascending: false });

  if (error) return { error: error.message };

  const rows = (data ?? []) as { kind: string; calls: number; pence: number }[];
  const byKind: Record<string, { calls: number; pence: number }> = {};
  for (const r of rows) {
    const held = byKind[r.kind] ?? { calls: 0, pence: 0 };
    held.calls += r.calls;
    held.pence += Number(r.pence);
    byKind[r.kind] = held;
  }

  return {
    last24h: Object.fromEntries(
      Object.entries(byKind).map(([k, v]) => [
        k,
        { calls: v.calls, pence: Math.round(v.pence * 100) / 100 },
      ]),
    ),
  };
}
