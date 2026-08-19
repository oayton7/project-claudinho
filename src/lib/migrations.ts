/**
 * Every migration, in order, embedded as strings.
 *
 * Embedded rather than read from disk because a serverless function has no
 * repo to read from. Generated from supabase/*.sql — edit those and re-run
 * `npm run migrations` rather than editing this file.
 *
 * Every statement in here must be idempotent: `create table if not exists`,
 * `add column if not exists`. Running the whole list twice is a no-op, which
 * is what makes it safe to press the button whenever you are unsure.
 */
export const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "001_initial.sql",
    sql: `-- Project Claudinho — initial schema
--
-- Run this once in the Supabase SQL editor. It is written to be re-runnable:
-- everything is "if not exists", so running it twice is harmless.
--
-- Three tables with real relationships, which is the point of this phase:
--   products     one row per candidate you are considering
--   judgements   many per product — you can re-judge after changing the inputs
--   premortems   at most one per judgement
--
-- Deleting a product deletes its judgements, and deleting a judgement deletes
-- its pre-mortem. That is what "on delete cascade" does: it stops orphaned
-- rows accumulating for things that no longer exist.

-- The pipeline from section 4 of the plan. An enum rather than free text so a
-- typo like 'Sampeling' fails loudly instead of silently creating a stage.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'pipeline_stage') then
    create type pipeline_stage as enum (
      'candidate',
      'qualified',
      'sampling',
      'dropship_test',
      'ordered',
      'live',
      'dead'
    );
  end if;
end $$;

create table if not exists products (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  name              text not null,
  category          text not null default '',
  stage             pipeline_stage not null default 'candidate',

  sell_price        numeric(10,2) not null default 0,
  weight_grams      integer not null default 0,

  -- The raw pasted research. Kept so a judgement can always be traced back to
  -- what produced it.
  listing_notes     text not null default '',
  review_complaints text not null default '',
  competitor_notes  text not null default '',
  us_signal         text not null default 'unchecked',

  -- Your own view, which is the half the Judge cannot supply.
  my_verdict        text,
  my_notes          text not null default '',

  -- The full MarginInput, stored as JSON. It has fifteen fields and they
  -- change as the plan changes; a column each would mean a migration every
  -- time. Nothing queries inside it, so JSON is the right trade here.
  margin_input      jsonb,

  -- Section 5: "log the reason so you stop re-finding dead products".
  killed_reason     text
);

create table if not exists judgements (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  created_at    timestamptz not null default now(),

  verdict       text not null,
  summary       text not null,
  -- The whole Judgement object. Validated by zod before it ever gets here.
  payload       jsonb not null,

  input_tokens  integer,
  output_tokens integer,
  cost_pence    numeric(8,2)
);

create table if not exists premortems (
  id            uuid primary key default gen_random_uuid(),
  judgement_id  uuid not null references judgements(id) on delete cascade,
  created_at    timestamptz not null default now(),

  payload       jsonb not null,
  cost_pence    numeric(8,2)
);

-- Indexes on the columns actually filtered and sorted by. Without these,
-- every query reads the whole table. It will not matter at fifty products and
-- will matter a lot at five thousand.
create index if not exists products_stage_idx      on products (stage);
create index if not exists products_created_at_idx on products (created_at desc);
create index if not exists judgements_product_idx  on judgements (product_id, created_at desc);
create index if not exists premortems_judgement_idx on premortems (judgement_id);

-- Keeps updated_at honest without the application having to remember.
create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists products_touch_updated_at on products;
create trigger products_touch_updated_at
  before update on products
  for each row execute function touch_updated_at();
`,
  },
  {
    name: "002_add_asin.sql",
    sql: `-- Adds the ASIN to products.
--
-- Without it there is no link between a judged product and the actual Amazon
-- listing, which means no Keepa lookup, no way to re-find the listing weeks
-- later, and no way to tell two similar candidates apart.
--
-- Nullable on purpose: the products saved before this existed do not have one,
-- and backfilling by hand is the price of having missed it.

alter table products add column if not exists asin text;

-- Not unique. The same ASIN can legitimately be judged twice, before and
-- after a rubric change, and comparing those two judgements is the point.
create index if not exists products_asin_idx on products (asin);
`,
  },
  {
    name: "003_scout_candidates.sql",
    sql: `-- Scout candidates: the raw funnel.
--
-- Deliberately separate from \`products\`. That table is things Oscar is
-- actively considering, and tipping a hundred sweep results into it would
-- bury the handful that matter. This is the wide end: everything the sweep
-- has ever seen, including the ones it killed.
--
-- Keyed on asin so re-running a sweep updates rather than duplicates. That
-- makes repeat sweeps idempotent and, more usefully, makes the score
-- comparable over time: first_seen against last_seen shows whether a product
-- is getting better or worse while you think about it.

create table if not exists scout_candidates (
  asin              text primary key,
  first_seen        timestamptz not null default now(),
  last_seen         timestamptz not null default now(),

  title             text not null default '',
  brand             text not null default '',
  category          text not null default '',

  price             numeric(10,2),
  rating            numeric(3,1),
  review_count      integer,
  unhappy_buyers    integer,
  monthly_sold      integer,
  sellers           integer,
  weight_grams      integer,
  max_landed_cost   numeric(10,2),

  score             integer,
  coverage          integer,
  -- Kept as text so the reasoning survives a change to the scoring weights.
  strengths         text not null default '',
  listing_weaknesses text not null default '',
  killed_reason     text,

  us_growing        boolean,
  us_monthly_sold   integer,

  -- Oscar's own calls, which must never be overwritten by a later sweep.
  dismissed         boolean not null default false,
  my_notes          text not null default '',

  -- Set when a candidate graduates into the products pipeline.
  promoted_product_id uuid references products(id) on delete set null
);

create index if not exists scout_candidates_score_idx
  on scout_candidates (score desc nulls last);
create index if not exists scout_candidates_last_seen_idx
  on scout_candidates (last_seen desc);

-- The free triage verdict, in the same three words the Judge uses.
alter table scout_candidates add column if not exists auto_verdict text;
alter table scout_candidates add column if not exists auto_because text not null default '';
`,
  },
  {
    name: "004_reviews.sql",
    sql: `-- Reviews, and what they say.
--
-- Keepa gives review counts and ratings, never the words. Amazon blocks
-- servers that try to read them. But nothing blocks Oscar's own browser
-- reading a page he is already looking at, so the words arrive by paste and
-- are stored here once, keyed by ASIN, rather than being re-gathered.
--
-- The analysis is stored alongside the raw text on purpose. Re-running it
-- costs money; the raw text means it can be re-run later against a better
-- prompt without going back to Amazon.

create table if not exists reviews (
  asin              text primary key,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Exactly what was pasted, untouched. The source of truth.
  raw_text          text not null default '',
  review_count      integer not null default 0,
  star_filter       text not null default '',

  -- What Claude found in them. Arrays stored as text so the reasoning
  -- survives a change to the analysis schema.
  complaints        text not null default '',
  wished_for        text not null default '',
  fixable           text not null default '',
  not_fixable       text not null default '',
  opportunity_score integer,
  summary           text not null default ''
);
`,
  },
  {
    name: "005_categories.sql",
    sql: `-- Amazon UK's real category tree, cached from Keepa.
--
-- Replaces category ids written from memory, one of which was proved to match
-- nothing at all. Every id in here came back from Keepa, so it exists by
-- construction.
--
-- Cached because the tree changes rarely and every lookup costs tokens.
-- Refreshed on demand, never per run.

create table if not exists keepa_categories (
  cat_id         bigint primary key,
  domain         smallint not null default 2,
  name           text not null,
  parent_id      bigint,
  product_count  bigint,
  path           text not null default '',
  fetched_at     timestamptz not null default now()
);

create index if not exists keepa_categories_parent_idx on keepa_categories (parent_id);
create index if not exists keepa_categories_name_idx on keepa_categories (lower(name));

-- Which categories to sweep. Survives a refresh, so a run is one click.
create table if not exists category_picks (
  cat_id      bigint primary key,
  name        text not null default '',
  picked_at   timestamptz not null default now()
);
`,
  },
  {
    name: "006_verdicts.sql",
    sql: `-- Verdicts, kept.
--
-- Everything the tool decides now lands on the candidate row: the free
-- arithmetic verdict, the cheap AI one, and eventually the expensive one. The
-- point is not the individual run — it is that at 500 rows you can ask which
-- signals actually predicted the products worth pursuing.
--
-- Review text deliberately does not live here. It is working material; the
-- conclusion drawn from it is the asset.

alter table scout_candidates add column if not exists triage_verdict text;
alter table scout_candidates add column if not exists triage_because text;
alter table scout_candidates add column if not exists triage_improvability integer;
alter table scout_candidates add column if not exists triage_main_risk text;
alter table scout_candidates add column if not exists triage_at timestamptz;

-- The US signal that started the search, kept so a later analysis can ask
-- whether starting from US growth actually beat starting from UK categories.
alter table scout_candidates add column if not exists us_avg365_rank bigint;
alter table scout_candidates add column if not exists us_current_rank bigint;
alter table scout_candidates add column if not exists us_growth_ratio numeric(6,2);
alter table scout_candidates add column if not exists found_via text;

-- What the listing was missing, as two flags rather than buried in prose, so
-- they can be counted across hundreds of rows.
alter table scout_candidates add column if not exists has_aplus boolean;
alter table scout_candidates add column if not exists video_count integer;

create index if not exists scout_candidates_triage_idx
  on scout_candidates (triage_verdict, score desc nulls last);
`,
  },
  {
    name: "007_deep_judgement.sql",
    sql: `-- The deep judgement, kept alongside the cheap one.
--
-- Triage answers "is this worth an expensive look" in a sentence. This is the
-- expensive look: the target buyer, what specifically to fix, why nobody has
-- already, and what would sink it. Stored so it is bought once.

alter table scout_candidates add column if not exists judge_verdict text;
alter table scout_candidates add column if not exists judge_summary text;
alter table scout_candidates add column if not exists judge_json jsonb;
alter table scout_candidates add column if not exists judge_pence numeric(8,2);
alter table scout_candidates add column if not exists judge_at timestamptz;
alter table scout_candidates add column if not exists judge_missing text;
`,
  },
];
