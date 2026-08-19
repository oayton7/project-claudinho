/**
 * What is never a candidate, whatever the numbers say.
 *
 * Shared, because the first version lived in the risers route and the pipeline
 * did not use it — so a run came back proposing to sweep "Pullovers" and
 * "Movies". Two copies of a rubric is two rubrics.
 */
const NEVER_CANDIDATES = [
  // Media. Rank here is spiky — a re-release or a film anniversary moves a
  // catalogue title thousands of places in a week, which is real movement and
  // useless: you cannot private-label a DVD.
  "dvd",
  "video",
  "movie",
  "book",
  "abis_book",
  "music",
  "abis_music",
  "digital_music",
  "vinyl",
  "cd_",
  "video_games",
  "videogames",
  "software",
  "mobile_application",
  "ebooks",
  "digital_video_download",
  "toy_figure",
  // Apparel and footwear. Already a Gate 0 kill in the rubric: returns cost
  // 50% of the fulfilment fee, and sizing drives the return rate up in the
  // first place. A growing trouser is still a trouser.
  "apparel",
  "shoes",
  "pants",
  "shirt",
  "sweater",
  "pullover",
  "dress",
  "jacket",
  "coat",
  "hoodie",
  "sock",
  "underwear",
  "swimwear",
  "hat",
  "jewelry",
  "watch",
];

/**
 * Whole categories that are never candidates, matched on the category tree
 * rather than the product's own fields.
 *
 * Needed because productGroup is unreliable across types: a vinyl LP came back
 * clean on productGroup and binding while sitting in "Album-Oriented Rock".
 * Two imperfect checks catch more than one perfect-looking one.
 */
const NEVER_CATEGORIES = [
  // Amazon's own top-level departments, matched at the root of the tree.
  //
  // Chasing genre names does not work: the list had rock, pop, jazz, country
  // and hip hop and a blues album still came through. There are hundreds of
  // genres and one root, so the root is the thing to check.
  "cds & vinyl",
  "digital music",
  "movies & tv",
  "books",
  "kindle store",
  "audible",
  "video games",
  "apps & games",
  "software",
  "musical instruments",
  "clothing, shoes & jewelry",
  "clothing, shoes & accessories",
  "handmade products",
];

export function isMedia(product: Record<string, unknown>): boolean {
  const group = String(product.productGroup ?? "").toLowerCase();
  const binding = String(product.binding ?? "").toLowerCase();
  if (NEVER_CANDIDATES.some((bad) => group.includes(bad) || binding.includes(bad))) {
    return true;
  }

  // Second pass on the root of the category tree, which is Amazon's
  // department. A vinyl LP passed the field check while sitting in
  // "Album-Oriented Rock"; genre names are endless and the department is one.
  const tree = (product.categoryTree ?? []) as { name?: string }[];
  if (!Array.isArray(tree) || tree.length === 0) return false;
  const root = String(tree[0]?.name ?? "").toLowerCase();
  return NEVER_CATEGORIES.some((bad) => root.includes(bad));
}

