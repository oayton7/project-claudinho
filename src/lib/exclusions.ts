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

  // Worn accessories, but only the ones with a size.
  //
  // Sizing is the actual problem, not wearing. A sized item is returned when
  // it does not fit, and returns cost half the fulfilment fee — which is why
  // apparel is a Gate 0 kill in the first place. Hats, gloves and socks carry
  // that; sunglasses and bags do not.
  //
  // So one-size accessories stay in the funnel. They are one-size by design,
  // they can go viral in a way a jumper cannot, and none of the reasoning that
  // rules out clothing applies to them. Oscar's call, and the sizing test is
  // what makes it a rule rather than a preference.
  //
  // Named individually because they do not sit under a clothing department:
  // hats are filed under Sports & Outdoors, gloves under Automotive or Garden
  // depending on the pair.
  "hat",
  "cap",
  "beanie",
  "glove",
  "mitten",
  "sock",
  "belt",
  "slipper",

  // Mains electrical and charging. Two reasons stacked, and either alone
  // would be enough.
  //
  // Saturation: Anker, Belkin and Ugreen own the shelf, spend real money on
  // ads, and compete on price. Marketing improvability is the thesis and
  // there is none available against an incumbent already executing well.
  //
  // Compliance: anything connecting to mains needs UKCA marking, safety
  // testing and technical documentation, and carries product-liability
  // exposure if it catches fire. That is a barrier for a first-timer rather
  // than a cost, and the tool was surfacing these as TEST without pricing it.
  //
  // This also removes wireless chargers, which earlier runs liked. Same
  // reasoning applies — they still ship with a mains adapter — but say so if
  // that is a step too far.
  "charger",
  "charging",
  "power supply",
  "power bank",
  "power strip",
  "adapter",
  "adaptor",
  "extension lead",
  "plug",
  "socket",
  "fuse",
  "battery pack",
  "usb",
  "cable",

  // Chemicals and anything hazardous. Same class of problem as supplements:
  // Amazon gates the category, shipping is restricted as dangerous goods,
  // freight costs more or refuses it, and the liability if someone is hurt
  // sits with the seller. A pool flocculant reached TEST with none of that
  // priced in.
  "flocculant",
  "clarifier",
  "chlorine",
  "bleach",
  "pesticide",
  "insecticide",
  "herbicide",
  "fertiliser",
  "fertilizer",
  "solvent",
  "aerosol",
  // Not bare "paint". It matched "Diamond Painting Kits" and removed the best
  // candidate on the shortlist — an over-block is worse than a leak, because a
  // leak is visible and this just looks like a quiet market. The hazardous
  // forms are named instead.
  "spray paint",
  "paint stripper",
  "wood stain",
  "varnish",
  "white spirit",
  "adhesive",
  "sealant",
  "grout",
  "battery",
  "batteries",
  "lighter",
  "fuel",
  "pool chemical",

  // Pest control, which is where the chemicals actually live.
  //
  // A wasp nest killer aerosol reached the shortlist as a TEST. Every word
  // that should have caught it — pesticide, insecticide, aerosol — was already
  // on this list, and none of them appear in its category, "Bees, Wasps &
  // Hornets". The category names the pest, not the chemistry.
  "pest control",
  "rodent control",
  "weed control",
  "bees, wasps",
  "wasps & hornets",
  "insect & pest",
];

/**
 * Hazard words matched against the product's own title.
 *
 * The category tree is not enough on its own. A chemical filed under the pest
 * it kills, or under a benign-sounding department, is invisible to a check
 * that only reads category names.
 *
 * Deliberately a short list of unambiguous phrases rather than the full
 * NEVER_ANYWHERE list. Running that against titles would be a disaster: "usb"
 * and "cable" appear in the titles of things that are neither, and an
 * over-block is worse than a leak because a leak is visible while this just
 * looks like a quiet market.
 *
 * Note "rat poison" rather than bare "poison", which would match the
 * "non-poisonous" on a children's craft set.
 */
const HAZARDOUS_TITLE_PHRASES = [
  "nest killer",
  "wasp killer",
  "hornet killer",
  "ant killer",
  "insect killer",
  "bug killer",
  "weed killer",
  "moss killer",
  "fly spray",
  "insect spray",
  "bug spray",
  "wasp spray",
  "rat poison",
  "poison bait",
  "slug pellet",
  "pesticide",
  "insecticide",
  "herbicide",
  "rodenticide",
  "fungicide",
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
  // Jewellery and watches stay out for a different reason from clothing: a 20%
  // referral fee on jewellery, and watches are brand-dominated in a way that
  // makes execution irrelevant.
  "jewellery",
  "watches",
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

  // The product's own title, for hazardous goods filed under the pest they
  // kill rather than under anything chemical-sounding.
  //
  // Deliberately before the category-tree checks, because those bail out when
  // there is no tree — and a row read back from the database has one category
  // name rather than a tree. Putting this after that early return meant it
  // never ran on anything already stored, which is precisely the set that
  // needed it.
  const title = String(product.title ?? "").toLowerCase();
  if (title && HAZARDOUS_TITLE_PHRASES.some((bad) => title.includes(bad))) return true;

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

