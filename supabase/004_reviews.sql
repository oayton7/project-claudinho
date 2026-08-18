-- Reviews, and what they say.
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
