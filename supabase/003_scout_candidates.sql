-- Scout candidates: the raw funnel.
--
-- Deliberately separate from `products`. That table is things Oscar is
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
