-- The deep judgement, kept alongside the cheap one.
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
