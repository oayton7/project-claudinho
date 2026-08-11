-- Project Claudinho — initial schema
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
