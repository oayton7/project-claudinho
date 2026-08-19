-- Improvability is a decimal, not an integer.
--
-- The triage schema allows any number 0-10 and the model returns things like
-- 6.5. The column was integer, so Postgres rejected the write with "invalid
-- input syntax for type integer" — and the tick catches save failures so the
-- run carried on. Verdicts with a whole-number score saved; verdicts with a
-- half vanished, and nothing said so.
--
-- Silent partial data loss, which is the exact failure this project keeps
-- meeting: something that looks like it worked.

alter table scout_candidates
  alter column triage_improvability type numeric(3,1)
  using triage_improvability::numeric(3,1);
