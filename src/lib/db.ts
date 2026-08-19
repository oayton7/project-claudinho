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
import type { Judgement, Premortem, ProductInput } from "./judge";
import type { MarginInput } from "./margin";
import type { ProductRow, Stage } from "./stages";

export { STAGES, STAGE_LABELS } from "./stages";
export type { Stage, ProductRow } from "./stages";

export class MissingDatabaseConfig extends Error {}

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
> &
  Partial<
    Pick<
      ScoutCandidateRow,
      "us_avg365_rank" | "us_current_rank" | "us_growth_ratio" | "found_via" | "has_aplus" | "video_count"
    >
  >;

export async function saveScoutCandidates(candidates: ScoutCandidateInput[]) {
  if (candidates.length === 0) return { saved: 0 };

  const db = getDb();
  const { error } = await db.from("scout_candidates").upsert(
    candidates.map((c) => ({ ...c, last_seen: new Date().toISOString() })),
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
    .upsert({ ...input, updated_at: new Date().toISOString() }, { onConflict: "asin" });
  if (error) throw new Error(`Could not save reviews: ${error.message}`);
}

export async function getReviews(asin: string): Promise<ReviewRow | null> {
  const db = getDb();
  const { data, error } = await db
    .from("reviews")
    .select("*")
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
    .upsert({ cat_id: catId, name }, { onConflict: "cat_id" });
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
    .eq("dismissed", false)
    .order("score", { ascending: false, nullsFirst: false })
    .limit(300);

  if (!options.includeKilled) {
    query = query.in("triage_verdict", ["TEST", "PARK"]);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Could not load the shortlist: ${error.message}`);

  const rows = (data ?? []) as ScoutCandidateRow[];
  const rank = { TEST: 0, PARK: 1, KILL: 2 } as const;
  return rows.sort(
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
