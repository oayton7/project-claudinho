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
