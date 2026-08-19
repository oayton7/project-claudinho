-- Amazon UK's real category tree, cached from Keepa.
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
