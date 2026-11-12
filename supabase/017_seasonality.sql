-- The shape of a product's year.
--
-- Stored because it is bought, not free: it costs one SoldScope request out of
-- a monthly quota, so the same product must never be paid for twice. Fetched
-- only at the deep look, which is the narrowest gate in the pipeline — a
-- candidate reaching it has already survived the free arithmetic and the cheap
-- opinion, and is about to cost ten pence anyway.
alter table scout_candidates
  add column if not exists season_concentration numeric(4, 2),
  add column if not exists season_peak_months text,
  add column if not exists season_is_seasonal boolean,
  add column if not exists season_why text,
  add column if not exists season_checked_at timestamptz;
