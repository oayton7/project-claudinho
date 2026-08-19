-- The listing a product's variations hang off.
--
-- Dedupe worked inside a single run and nowhere else, because the parent was
-- computed and thrown away. Two runs a day apart each picked a different size
-- of the same diamond painting kit and both reached the shortlist looking like
-- separate products.
--
-- Storing it makes the shortlist able to collapse what earlier runs left
-- behind, and makes a future run able to recognise a sibling of something it
-- has already judged.

alter table scout_candidates add column if not exists parent_asin text;
create index if not exists scout_candidates_parent_idx on scout_candidates (parent_asin);
