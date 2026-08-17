-- Adds the ASIN to products.
--
-- Without it there is no link between a judged product and the actual Amazon
-- listing, which means no Keepa lookup, no way to re-find the listing weeks
-- later, and no way to tell two similar candidates apart.
--
-- Nullable on purpose: the products saved before this existed do not have one,
-- and backfilling by hand is the price of having missed it.

alter table products add column if not exists asin text;

-- Not unique. The same ASIN can legitimately be judged twice, before and
-- after a rubric change, and comparing those two judgements is the point.
create index if not exists products_asin_idx on products (asin);
