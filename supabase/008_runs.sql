-- Runs as jobs.
--
-- A full pass cannot be one HTTP request. Vercel kills a function at 300
-- seconds, paging the riser search pushed a run past a minute before any
-- judging, and a hundred products with deep judgements is tens of minutes. So
-- a run stops being a request and becomes a row that advances itself in
-- bounded slices.
--
-- The property that matters: every slice commits before the next begins. A
-- crash during triage never re-pays for the sweep, closing the laptop is safe,
-- and deploying mid-run is safe.

create table if not exists runs (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- queued, finding, sweeping, triaging, done, failed, halted
  status          text not null default 'queued',
  stage_detail    text not null default '',

  -- What was asked for, so a run can be reproduced or explained later.
  params          jsonb not null default '{}'::jsonb,

  -- Categories found in the finding stage, worked through one per tick.
  categories      jsonb not null default '[]'::jsonb,
  category_cursor integer not null default 0,

  -- ASINs awaiting a paid opinion, worked through a few per tick.
  triage_queue    jsonb not null default '[]'::jsonb,
  triage_cursor   integer not null default 0,

  scanned         integer not null default 0,
  killed          integer not null default 0,
  triaged         integer not null default 0,
  spent_pence     numeric(10,2) not null default 0,
  keepa_tokens_left integer,

  -- Hard caps, checked before every paid call. Hitting one halts the run and
  -- says so; it does not fail silently and it does not keep spending.
  cap_pence       numeric(10,2) not null default 100,

  error           text,
  ticks           integer not null default 0,
  last_tick_at    timestamptz
);

create index if not exists runs_status_idx on runs (status, updated_at desc);
