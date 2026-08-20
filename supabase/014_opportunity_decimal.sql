-- opportunity_score is a decimal, and the column was an integer.
--
-- The same fault as triage_improvability, which ate about half a session's
-- paid verdicts while every run reported success. The analysis runs, costs
-- money, comes back with 7.5, and Postgres rejects the whole row with
-- "invalid input syntax for type integer".
--
-- The reviews endpoint at least says so rather than swallowing it, so this
-- surfaced in one product rather than thirty. Widened rather than rounded,
-- because a model asked for a 0-10 score will keep returning halves and
-- rounding them away loses the distinction between a 7 and a 7.5 for no
-- reason other than the column type.
alter table reviews
  alter column opportunity_score type numeric(3, 1)
  using opportunity_score::numeric(3, 1);
