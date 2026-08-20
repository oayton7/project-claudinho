-- Supplier quotes, and the point of them.
--
-- Every margin figure the tool has produced so far rests on an assumed landed
-- cost. That is why it reports a ceiling — the most a unit could cost and
-- still clear the margin floor — rather than a profit. The ceiling is the
-- right output while nobody has quoted, but it is not a decision.
--
-- A quote turns the ceiling into a real number, and a fair few PARK and TEST
-- verdicts change once there is one. This table is where a quote lives so
-- that can happen.
--
-- Deliberately keyed on the ASIN rather than on a promoted product row: quotes
-- arrive while a candidate is still being decided, which is exactly when they
-- are most useful.

create table if not exists supplier_quotes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references app_users (id) on delete cascade,
  asin            text not null,

  supplier        text not null,
  -- Where the conversation happened, so it can be found again. Alibaba, a
  -- direct email, a trade show.
  source          text not null default '',
  contact         text not null default '',

  -- The numbers. Unit price is per unit at this MOQ, in pounds, ex-VAT, on
  -- whatever incoterm is recorded below. Quotes usually arrive in dollars, so
  -- the rate used is stored rather than the conversion being silently lost.
  unit_price      numeric(10, 2) not null,
  moq             integer not null,
  currency        text not null default 'GBP',
  fx_rate         numeric(10, 4),
  -- FOB, EXW, DDP. This changes what the price already includes, so it is the
  -- difference between a good quote and a bad one that looks cheaper.
  incoterm        text not null default 'FOB',

  sample_cost     numeric(10, 2),
  sample_lead_days integer,
  production_lead_days integer,
  tooling_cost    numeric(10, 2),

  -- What the tool worked out from this quote, stored so the shortlist can be
  -- ordered without recomputing every row on every read.
  landed_per_unit numeric(10, 2),
  net_margin_pct  numeric(6, 2),
  order_cost      numeric(12, 2),
  verdict         text,
  -- Which parts of the above are still assumptions. Never blank when
  -- something was guessed, because a flattering estimate is worse than none.
  assumptions     text not null default '',

  notes           text not null default '',
  quoted_at       timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One supplier can requote at a different MOQ, and both matter: the whole
-- point of asking is to find the break where the order becomes affordable.
create unique index if not exists supplier_quotes_unique
  on supplier_quotes (user_id, asin, supplier, moq);

create index if not exists supplier_quotes_asin_idx
  on supplier_quotes (user_id, asin, created_at desc);

alter table supplier_quotes enable row level security;

drop policy if exists supplier_quotes_owner on supplier_quotes;
create policy supplier_quotes_owner on supplier_quotes
  for all
  using (user_id = current_setting('app.user_id', true)::uuid)
  with check (user_id = current_setting('app.user_id', true)::uuid);
