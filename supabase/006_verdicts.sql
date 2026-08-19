-- Verdicts, kept.
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
