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
 * Excluded wherever they appear in the tree, not just at the root.
 *
 * These sit inside departments that are otherwise fine. Health & Personal Care
 * holds both a supplement and a hairbrush; Grocery holds both a protein powder
 * and a storage jar. Blocking the department would throw away good candidates,
 * so these are matched against every node.
 *
 * Supplements are out for reasons the rubric does not currently price. They
 * are regulated as food, usually gated on Amazon so a new seller cannot list
 * them at all, carry expiry dates that make dead stock worthless rather than
 * merely slow, and carry real liability if anything goes wrong.
 *
 * Consumables generally have the expiry problem: a slow-moving non-perishable
 * is capital tied up, a slow-moving edible is capital destroyed.
 *
 * Apparel repeats here because leaves like "Jumpers" and "Cross Trainers" have
 * already slipped through a department check once.
 */
const NEVER_ANYWHERE = [
  // Supplements and anything ingestible
  "supplement",
  "vitamin",
  "mineral",
  "sports nutrition",
  "protein",
  "herbal",
  "probiotic",
  "meal replacement",
  "weight loss",
  "food",
  "grocery",
  "drink",
  "beverage",
  "coffee",
  "tea",
  "snack",
  "confectionery",
  "candy",
  "chocolate",
  "spice",
  "seasoning",
  "baby food",
  "pet food",
  "medicine",
  "pharmacy",

  // Apparel and footwear, at leaf level
  "jumper",
  "legging",
  "pyjama",
  "trainer",
  "t-shirt",
  "tshirt",
  "hoodie",
  "sweatshirt",
  "trouser",
  "jean",
  "skirt",
  "dress",
  "coat",
  "jacket",
  "sock",
  "underwear",
  "lingerie",
  "swimwear",
  "footwear",
  "boots",
  "sandal",

  // Worn accessories. Oscar's addition, and they need naming individually
  // because they do not sit under a clothing department — hats and gloves are
  // filed under Sports & Outdoors, Motorbike, Garden and Workwear depending on
  // the pair. They carry apparel's problems anyway: sizing drives returns, and
  // returns cost half the fulfilment fee.
  "hat",
  "cap",
  "beanie",
  "glove",
  "mitten",
  // "scarf" does not appear inside "Scarves & Wraps" — the plural is
  // irregular, so both stems are needed. Worth remembering for any word added
  // here: these are substring matches against Amazon's own category names,
  // which are almost always plural.
  "scarf",
  "scarv",
  "belt",
  "tie",
  "wallet",
  "purse",
  "handbag",
  "backpack",
  "sunglasses",
  "slipper",
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
  // Amazon's top-level departments, matched at the root of the category tree.
  //
  // Both marketplaces, because they do not use the same names. A run filtered
  // with the US list alone came back proposing Jumpers, Leggings, Pyjama Sets
  // and Cross Trainers — every one apparel, every one passing a filter that
  // only knew "clothing, shoes & jewelry". Amazon UK calls that department
  // "Clothing", and footwear lives in "Shoes & Bags".
  //
  // Matched on the root rather than the leaf because there are hundreds of
  // leaves and a handful of departments.

  // US names
  "clothing, shoes & jewelry",
  "cds & vinyl",
  "movies & tv",
  "video games",
  "apps & games",
  "kindle store",

  // UK names
  "clothing",
  "fashion",
  "shoes & bags",
  "shoes",
  "jewellery",
  "watches",
  "luggage",
  "dvd & blu-ray",
  "music",
  "pc & video games",
  "books",
  "audible",
  "software",
  "musical instruments",
  "digital music",
  "handmade",
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
  if (NEVER_CATEGORIES.some((bad) => root.includes(bad))) return true;

  // Then every node, for the things that live inside departments worth keeping.
  return tree.some((node) => {
    const name = String(node?.name ?? "").toLowerCase();
    return NEVER_ANYWHERE.some((bad) => name.includes(bad));
  });
}

