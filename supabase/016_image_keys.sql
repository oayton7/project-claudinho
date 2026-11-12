-- The listing's own photographs.
--
-- The tool counted images from the day it could, and never looked at one. Its
-- whole thesis is that products are marketed badly, and the loudest marketing
-- signal is photography, so the Judge was scoring visual criteria with its
-- eyes shut — it said so itself on the best candidate found so far: "no one
-- has actually looked at the images, which is the first thing to do".
--
-- Keepa gives filenames rather than urls. Stored as a comma-separated list, in
-- the order Amazon shows them, so the first is the main image.
alter table scout_candidates
  add column if not exists image_keys text;
