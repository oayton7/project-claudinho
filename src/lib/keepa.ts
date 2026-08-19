/**
 * Keepa — real Amazon sales rank and price history.
 *
 * This is the evidence Gate 1 currently guesses at: is the rank strong, is it
 * stable, is the 12-month trend flat or decaying, how many sellers are there.
 * None of it is available free, because Amazon blocks scraping.
 *
 * ## Tokens, and why there is a guard
 *
 * Keepa meters by tokens rather than requests. A plan generates a fixed number
 * per minute whether you use them or not, unused ones expire after an hour,
 * and each product costs at least one. A loop that requests a hundred products
 * does not fail — it drains the bucket and everything else stalls for the rest
 * of the hour. Hence the same kind of guard as claude.ts.
 *
 * ## The format constants below are UNVERIFIED
 *
 * Keepa returns history as a flat `csv` array of arrays, where the position in
 * the outer array determines what the series means, prices are integers in
 * cents, and timestamps are "Keepa minutes" rather than Unix time. Their docs
 * block automated access, so the indices below are from memory and MUST be
 * checked against a real response before any number derived from them is
 * trusted. Use `/api/keepa/probe` to do that.
 *
 * Getting these wrong does not throw — it silently returns a plausible wrong
 * number, which is the worst possible failure for a tool used to decide where
 * £1,400 goes.
 */

export const KEEPA_DOMAIN = { US: 1, UK: 2 } as const;
export type KeepaDomain = (typeof KEEPA_DOMAIN)[keyof typeof KEEPA_DOMAIN];

/**
 * Index into the `csv` array. UNVERIFIED — see the note above.
 */
export const CSV_INDEX_UNVERIFIED = {
  AMAZON: 0,
  NEW: 1,
  USED: 2,
  SALES_RANK: 3,
  NEW_FBA: 10,
  COUNT_NEW: 11,
  RATING: 16,
  COUNT_REVIEWS: 17,
} as const;

/** Keepa counts minutes from its own epoch, not the Unix one. Also unverified. */
const KEEPA_EPOCH_OFFSET_MINUTES = 21564000;

export function keepaMinutesToDate(minutes: number): Date {
  return new Date((minutes + KEEPA_EPOCH_OFFSET_MINUTES) * 60 * 1000);
}

export class MissingKeepaKey extends Error {}
export class KeepaTokensExhausted extends Error {}

/**
 * Deliberately conservative. A cheap plan generates 20 tokens a minute, so
 * 60 an hour leaves plenty of headroom for the rest of the bucket while still
 * allowing a decent research session.
 */
const REQUEST_LIMIT_PER_HOUR = 60;
const requests: number[] = [];

function checkRate() {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  while (requests.length > 0 && requests[0] < hourAgo) requests.shift();
  if (requests.length >= REQUEST_LIMIT_PER_HOUR) {
    throw new KeepaTokensExhausted(
      `Hit the local guard of ${REQUEST_LIMIT_PER_HOUR} Keepa requests per hour. This stops a bug draining your token bucket and stalling everything else. Wait, or raise it in src/lib/keepa.ts.`,
    );
  }
  requests.push(Date.now());
}

function getKey(): string {
  const key = process.env.KEEPA_API_KEY;
  if (!key) {
    throw new MissingKeepaKey(
      "KEEPA_API_KEY is not set. Get it from keepa.com/#!api once subscribed, then add it to Vercel's environment variables and .env.local.",
    );
  }
  return key;
}

/**
 * Raw product fetch. Returns whatever Keepa sends, unparsed.
 *
 * Kept deliberately dumb: no interpretation happens here, so the probe route
 * can show the real structure and the parsing can be written against fact
 * rather than assumption.
 */
export async function fetchProductRaw(
  asin: string,
  domain: KeepaDomain,
  options: { history?: boolean; stats?: number; listing?: boolean } = {},
): Promise<{ raw: unknown; tokensLeft: number | null }> {
  const key = getKey();
  checkRate();

  const params = new URLSearchParams({
    key,
    domain: String(domain),
    asin,
    history: options.history === false ? "0" : "1",
  });
  if (options.stats) params.set("stats", String(options.stats));

  // A+ content and video are the two highest-signal marketing gaps in the
  // rubric and neither is returned by default. A listing with no video is a
  // job you could do in an afternoon, and the tool cannot see it without this.
  if (options.listing !== false) {
    params.set("aplus", "1");
    params.set("videos", "1");
  }

  const response = await fetch(`https://api.keepa.com/product?${params}`, {
    // Keepa is a third party; do not let a slow response hold a serverless
    // function open until the platform kills it with no error.
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(
      `Keepa returned ${response.status}. ${response.status === 429 ? "Out of tokens — wait for the bucket to refill." : await response.text().catch(() => "")}`.trim(),
    );
  }

  const raw = (await response.json()) as Record<string, unknown>;
  const tokensLeft =
    typeof raw.tokensLeft === "number" ? raw.tokensLeft : null;

  return { raw, tokensLeft };
}

/**
 * Describes the shape of a response without dumping megabytes of history.
 * This is what turns "I think index 3 is sales rank" into "index 3 contains
 * values in this range, which are or are not plausible ranks".
 */
export function describeShape(raw: unknown): unknown {
  const root = raw as Record<string, unknown>;
  const products = root.products as Record<string, unknown>[] | undefined;
  const product = products?.[0];

  if (!product) {
    return { topLevelKeys: Object.keys(root ?? {}), products: 0 };
  }

  const csv = product.csv as (number[] | null)[] | undefined;

  const stats = (product.stats ?? {}) as Record<string, unknown>;

  /**
   * The named scalars are the prize. Unlike the csv array they cannot be
   * misread by guessing a position wrong: salesRankDrops90 means what it says.
   * Each rank drop is roughly one sale, so it is the closest free proxy for
   * units sold that exists.
   */
  const namedStats = {
    salesRankDrops30: stats.salesRankDrops30 ?? null,
    salesRankDrops90: stats.salesRankDrops90 ?? null,
    salesRankDrops180: stats.salesRankDrops180 ?? null,
    salesRankDrops365: stats.salesRankDrops365 ?? null,
    totalOfferCount: stats.totalOfferCount ?? null,
    offerCountFBA: stats.offerCountFBA ?? null,
    offerCountFBM: stats.offerCountFBM ?? null,
    outOfStockPercentage90: stats.outOfStockPercentage90 ?? null,
    outOfStockPercentage365: stats.outOfStockPercentage365 ?? null,
    buyBoxPrice: stats.buyBoxPrice ?? null,
    buyBoxIsAmazon: stats.buyBoxIsAmazon ?? null,
  };

  /**
   * These are index-addressed like csv, so they are the ones that still need
   * verifying. Showing current alongside the averages makes a wrong index
   * obvious: a "sales rank" of 1499 sitting next to a price of 1499 is a
   * giveaway.
   */
  const indexedStats = {
    current: stats.current ?? null,
    avg30: stats.avg30 ?? null,
    avg90: stats.avg90 ?? null,
    avg365: stats.avg365 ?? null,
  };

  const salesRanks = product.salesRanks as Record<string, number[]> | undefined;

  return {
    topLevelKeys: Object.keys(root),
    namedStats,
    indexedStats,
    salesRanksByCategory: salesRanks
      ? Object.entries(salesRanks).map(([categoryId, history]) => ({
          categoryId,
          points: Array.isArray(history) ? history.length / 2 : 0,
          latestRank:
            Array.isArray(history) && history.length > 1
              ? history[history.length - 1]
              : null,
          firstDate:
            Array.isArray(history) && history.length > 0
              ? keepaMinutesToDate(history[0]).toISOString().slice(0, 10)
              : null,
          lastDate:
            Array.isArray(history) && history.length > 1
              ? keepaMinutesToDate(history[history.length - 2])
                  .toISOString()
                  .slice(0, 10)
              : null,
        }))
      : null,
    tokensLeft: root.tokensLeft,
    tokensConsumed: root.tokensConsumed,
    product: {
      asin: product.asin,
      title: product.title,
      keysPresent: Object.keys(product).sort(),
      hasStats: Boolean(product.stats),
      statsKeys: product.stats ? Object.keys(product.stats as object).sort() : null,
      // The important part: what is actually in each csv slot.
      csvSeries: Array.isArray(csv)
        ? csv.map((series, index) => ({
            index,
            present: Array.isArray(series) && series.length > 0,
            pairs: Array.isArray(series) ? series.length / 2 : 0,
            // Keepa interleaves [time, value, time, value, ...]
            firstValue: Array.isArray(series) && series.length > 1 ? series[1] : null,
            lastValue:
              Array.isArray(series) && series.length > 1
                ? series[series.length - 1]
                : null,
            firstDate:
              Array.isArray(series) && series.length > 0
                ? keepaMinutesToDate(series[0]).toISOString().slice(0, 10)
                : null,
            lastDate:
              Array.isArray(series) && series.length > 1
                ? keepaMinutesToDate(series[series.length - 2])
                    .toISOString()
                    .slice(0, 10)
                : null,
          }))
        : null,
    },
  };
}

/**
 * Product Finder — the actual Scout.
 *
 * Everything above looks up a product you already found. This searches for
 * ones you have not, which is the whole point of Phase 6: "surfaces 20
 * candidates you wouldn't have found by hand".
 *
 * The filters map directly onto the rubric. Rank range keeps you out of the
 * saturated top ten and away from the dead tail; the review ceiling finds
 * categories where the leaders are beatable; the price floor enforces the £12
 * kill switch.
 *
 * ## Cost
 *
 * A Product Finder query costs materially more than a single product lookup —
 * Keepa charges by result volume. The guard in checkRate() applies, but treat
 * a search as expensive and prefer narrow filters over broad ones.
 *
 * ## Unverified
 *
 * The request shape below is from memory and Keepa's docs block automated
 * access. If a search returns nothing, or something implausible, that is the
 * first thing to suspect — not the filters. The route reports Keepa's own
 * error text rather than swallowing it.
 */
/**
 * Keepa's floor for Product Finder page size. Asking for fewer is a 400, not
 * a smaller result set.
 */
const KEEPA_MIN_PER_PAGE = 50;

export type FinderFilters = {
  /** Keepa category id. Browse them on the Amazon category page URL. */
  categoryId?: number;
  minRank?: number;
  maxRank?: number;
  /** Pounds, converted to integer pence for Keepa. */
  minPrice?: number;
  maxPrice?: number;
  /**
   * Review count proves demand, it does not measure defensibility. A high
   * count means people have been buying this for years, which is the thing
   * you cannot manufacture with £3,000. So the floor matters more than the
   * ceiling, and the ceiling is optional.
   */
  minReviewCount?: number;
  maxReviewCount?: number;
  /**
   * Rating is where the opening actually shows up. Keepa scales this 0-50,
   * so 4.3 stars is 43. A high review count paired with a mediocre rating is
   * the thesis in two numbers: proven demand, failed execution.
   */
  maxRating?: number;
  minRating?: number;
  minSellerCount?: number;
  maxSellerCount?: number;
  /**
   * How many ASINs to keep from the page Keepa returns. Not sent to Keepa: it
   * caps how many products get a detail fetch, which is where the token cost
   * actually sits.
   */
  limit?: number;
};

export async function findProducts(
  filters: FinderFilters,
  domain: KeepaDomain,
): Promise<{ asins: string[]; raw: unknown; tokensLeft: number | null }> {
  const key = getKey();
  checkRate();

  // Keepa's selection object. Money is integer pence, same as everywhere else
  // in its API.
  // Keepa rejects a small page size outright: "combination of perPage and page
  // exeeds limit or is too small". How many results the API will hand back in
  // one page and how many we want to pay to fetch details for are separate
  // questions, so ask for a page Keepa accepts and narrow it here afterwards.
  const selection: Record<string, unknown> = {
    productType: [0, 1], // physical products only
    sort: [["current_SALES", "asc"]],
    perPage: KEEPA_MIN_PER_PAGE,
    page: 0,
  };

  if (filters.categoryId) selection.rootCategory = filters.categoryId;
  if (filters.minRank !== undefined) selection.current_SALES_gte = filters.minRank;
  if (filters.maxRank !== undefined) selection.current_SALES_lte = filters.maxRank;
  if (filters.minPrice !== undefined)
    selection.current_NEW_gte = Math.round(filters.minPrice * 100);
  if (filters.maxPrice !== undefined)
    selection.current_NEW_lte = Math.round(filters.maxPrice * 100);
  if (filters.minReviewCount !== undefined)
    selection.current_COUNT_REVIEWS_gte = filters.minReviewCount;
  if (filters.maxReviewCount !== undefined)
    selection.current_COUNT_REVIEWS_lte = filters.maxReviewCount;
  // Keepa holds ratings as tenths of a star in an integer field.
  if (filters.maxRating !== undefined)
    selection.current_RATING_lte = Math.round(filters.maxRating * 10);
  if (filters.minRating !== undefined)
    selection.current_RATING_gte = Math.round(filters.minRating * 10);
  if (filters.minSellerCount !== undefined)
    selection.current_COUNT_NEW_gte = filters.minSellerCount;
  if (filters.maxSellerCount !== undefined)
    selection.current_COUNT_NEW_lte = filters.maxSellerCount;

  const response = await fetch(
    `https://api.keepa.com/query?key=${key}&domain=${domain}&selection=${encodeURIComponent(JSON.stringify(selection))}`,
    { signal: AbortSignal.timeout(30_000) },
  );

  if (!response.ok) {
    throw new Error(
      `Keepa Product Finder returned ${response.status}. ${
        response.status === 429
          ? "Out of tokens — a search costs far more than a single lookup."
          : await response.text().catch(() => "")
      }`.trim(),
    );
  }

  const raw = (await response.json()) as Record<string, unknown>;

  const asins = Array.isArray(raw.asinList) ? (raw.asinList as string[]) : [];

  return {
    // The search is charged as one query however many rows come back. The
    // per-product cost lands on the detail fetch, so trimming here is what
    // actually controls the spend.
    asins: filters.limit ? asins.slice(0, filters.limit) : asins,
    raw,
    tokensLeft: typeof raw.tokensLeft === "number" ? raw.tokensLeft : null,
  };
}

/**
 * Read the real category ids off products you already know.
 *
 * The sweep's hardcoded category ids were written from memory and match
 * nothing, which cost three rounds of debugging. This removes the guess: give
 * it an ASIN of a product in the right neighbourhood and it returns the
 * category Amazon has actually filed that product under.
 *
 * The ids it returns exist by definition, because a real product is sitting in
 * one. That is the property no amount of careful remembering can offer.
 *
 * It also turns the sweep into something better aimed. "Find me more things
 * like this" is a sharper instruction than "search Home & Kitchen", and it is
 * the instruction Oscar can actually give, because he knows products he likes
 * even when he does not know Keepa's numbering.
 */
export async function categoriesForAsins(
  asins: string[],
  domain: KeepaDomain,
): Promise<{
  categories: { id: number; name: string; fromAsin: string }[];
  missing: string[];
  tokensLeft: number | null;
}> {
  const key = getKey();
  checkRate();

  const clean = asins
    .map((a) => a.toUpperCase().trim())
    .filter((a) => /^[A-Z0-9]{10}$/.test(a));

  if (clean.length === 0) {
    return { categories: [], missing: asins, tokensLeft: null };
  }

  const response = await fetch(
    `https://api.keepa.com/product?key=${key}&domain=${domain}&asin=${clean.join(",")}&stats=0&history=0`,
    { signal: AbortSignal.timeout(45_000) },
  );

  if (!response.ok) {
    throw new Error(
      `Keepa returned ${response.status} looking up categories. ${await response
        .text()
        .catch(() => "")}`.trim(),
    );
  }

  const raw = (await response.json()) as Record<string, unknown>;
  const products = (raw.products ?? []) as Record<string, unknown>[];

  const found = new Map<number, { id: number; name: string; fromAsin: string }>();
  const seenAsins = new Set<string>();

  for (const product of products) {
    const asin = typeof product.asin === "string" ? product.asin : "";
    if (asin) seenAsins.add(asin);

    const root = product.rootCategory;
    if (typeof root !== "number" || root <= 0) continue;
    if (found.has(root)) continue;

    const tree = (product.categoryTree ?? []) as { catId: number; name: string }[];
    const name = Array.isArray(tree)
      ? (tree.find((t) => t.catId === root)?.name ?? tree[0]?.name ?? `category ${root}`)
      : `category ${root}`;

    found.set(root, { id: root, name, fromAsin: asin });
  }

  return {
    categories: [...found.values()],
    missing: clean.filter((a) => !seenAsins.has(a)),
    tokensLeft: typeof raw.tokensLeft === "number" ? raw.tokensLeft : null,
  };
}

// ── The category tree (build brief, session 2) ─────────────────────────────
//
// This replaces seed ASINs. The sweep's hardcoded ids were written from memory
// and one was proved to match nothing, so the tree now comes from Keepa and is
// cached. Ticking a box is a better instruction than pasting a product, and
// the ids are real by construction.

export type KeepaCategory = {
  catId: number;
  name: string;
  parent: number | null;
  /** How many products Keepa has filed under it. Useful for spotting a dud. */
  productCount: number | null;
  /** Keepa's own ancestry, root first, so the picker can show a path. */
  path: string[];
};

function parseCategoryObject(raw: unknown): KeepaCategory[] {
  const categories = (raw as Record<string, unknown>)?.categories;
  if (!categories || typeof categories !== "object") return [];

  return Object.entries(categories as Record<string, Record<string, unknown>>).map(
    ([id, value]) => ({
      catId: Number(id),
      name: typeof value.name === "string" ? value.name : `category ${id}`,
      parent:
        typeof value.parent === "number" && value.parent > 0 ? value.parent : null,
      productCount:
        typeof value.productCount === "number" ? value.productCount : null,
      path: Array.isArray(value.contextFreeName)
        ? (value.contextFreeName as string[])
        : typeof value.contextFreeName === "string"
          ? [value.contextFreeName as string]
          : [],
    }),
  );
}

/** Search the tree by name. This is what the picker's search box calls. */
export async function searchCategories(
  term: string,
  domain: KeepaDomain,
): Promise<{ categories: KeepaCategory[]; tokensLeft: number | null }> {
  const key = getKey();
  checkRate();

  const response = await fetch(
    `https://api.keepa.com/search?key=${key}&domain=${domain}&type=category&term=${encodeURIComponent(term)}`,
    { signal: AbortSignal.timeout(30_000) },
  );

  if (!response.ok) {
    throw new Error(
      `Keepa category search returned ${response.status}. ${await response
        .text()
        .catch(() => "")}`.trim(),
    );
  }

  const raw = (await response.json()) as Record<string, unknown>;
  return {
    categories: parseCategoryObject(raw),
    tokensLeft: typeof raw.tokensLeft === "number" ? raw.tokensLeft : null,
  };
}

/**
 * One category and, with `includeParents`, its ancestors. Passing 0 asks Keepa
 * for the root categories, which is how the picker gets its first level.
 */
export async function lookUpCategory(
  categoryId: number,
  domain: KeepaDomain,
  options: { includeParents?: boolean } = {},
): Promise<{ categories: KeepaCategory[]; tokensLeft: number | null }> {
  const key = getKey();
  checkRate();

  const response = await fetch(
    `https://api.keepa.com/category?key=${key}&domain=${domain}&category=${categoryId}&parents=${options.includeParents ? 1 : 0}`,
    { signal: AbortSignal.timeout(30_000) },
  );

  if (!response.ok) {
    throw new Error(
      `Keepa category lookup returned ${response.status}. ${await response
        .text()
        .catch(() => "")}`.trim(),
    );
  }

  const raw = (await response.json()) as Record<string, unknown>;
  return {
    categories: parseCategoryObject(raw),
    tokensLeft: typeof raw.tokensLeft === "number" ? raw.tokensLeft : null,
  };
}

/**
 * Amazon's own best sellers for a category.
 *
 * A useful second source alongside Product Finder: the finder answers "what
 * matches these filters", the best-seller list answers "what is actually
 * moving here", and the two disagree often enough to be worth having both.
 */
export async function bestSellers(
  categoryId: number,
  domain: KeepaDomain,
): Promise<{ asins: string[]; tokensLeft: number | null }> {
  const key = getKey();
  checkRate();

  const response = await fetch(
    `https://api.keepa.com/bestsellers?key=${key}&domain=${domain}&category=${categoryId}`,
    { signal: AbortSignal.timeout(30_000) },
  );

  if (!response.ok) {
    throw new Error(
      `Keepa best sellers returned ${response.status}. ${await response
        .text()
        .catch(() => "")}`.trim(),
    );
  }

  const raw = (await response.json()) as Record<string, unknown>;
  const list = raw.bestSellersList as Record<string, unknown> | undefined;

  return {
    asins: Array.isArray(list?.asinList) ? (list!.asinList as string[]) : [],
    tokensLeft: typeof raw.tokensLeft === "number" ? raw.tokensLeft : null,
  };
}

// ── US risers (flipping the funnel) ────────────────────────────────────────
//
// Searching UK categories and hoping is the weaker end of the telescope. This
// starts where trends start: products whose Amazon US sales rank has climbed
// hard over a year, then works back to whether the UK has noticed.
//
// The mechanism is a ratio, not a delta field. A trend probe on 18 Aug 2026
// established that Keepa has no 365-day delta — deltaPercent365_SALES,
// delta365_SALES and trendPercent365_SALES are all silently ignored, returning
// an unfiltered result that looks like a working search. What does exist is
// avg365_SALES and current_SALES, and the ratio between them is the growth:
// an average rank of 60,000 over the year against 20,000 today is a product
// that has tripled its position.
//
// Silently ignored is the important half of that finding. An unknown key does
// not error, so any filter never tested against a control may be doing
// nothing at all.

export type RiserFilters = {
  /** 1.5 means "climbed at least 50% over the year", which is Oscar's ask. */
  minGrowth?: number;
  /** Rank today. Lower is better, so this is the ceiling on how good it is now. */
  maxCurrentRank?: number;
  minPrice?: number;
  maxPrice?: number;
  limit?: number;
};

export async function findUsRisers(filters: RiserFilters = {}): Promise<{
  asins: string[];
  growth: number;
  currentCeiling: number;
  yearFloor: number;
  totalMatches: number | null;
  tokensLeft: number | null;
}> {
  const key = getKey();
  checkRate();

  const growth = filters.minGrowth ?? 1.5;
  const currentCeiling = filters.maxCurrentRank ?? 20000;
  // The year's average must be this much worse than today for the ratio to
  // hold. Worse means numerically larger, because rank is inverted.
  const yearFloor = Math.round(currentCeiling * growth);

  const selection: Record<string, unknown> = {
    productType: [0, 1],
    perPage: KEEPA_MIN_PER_PAGE,
    page: 0,
    sort: [["current_SALES", "asc"]],
    current_SALES_lte: currentCeiling,
    avg365_SALES_gte: yearFloor,
  };
  if (filters.minPrice !== undefined)
    selection.current_NEW_gte = Math.round(filters.minPrice * 100);
  if (filters.maxPrice !== undefined)
    selection.current_NEW_lte = Math.round(filters.maxPrice * 100);

  const response = await fetch(
    `https://api.keepa.com/query?key=${key}&domain=${KEEPA_DOMAIN.US}&selection=${encodeURIComponent(
      JSON.stringify(selection),
    )}`,
    { signal: AbortSignal.timeout(30_000) },
  );

  if (!response.ok) {
    throw new Error(
      `Keepa US riser search returned ${response.status}. ${await response
        .text()
        .catch(() => "")}`.trim(),
    );
  }

  const raw = (await response.json()) as Record<string, unknown>;
  const asins = Array.isArray(raw.asinList) ? (raw.asinList as string[]) : [];

  return {
    asins: filters.limit ? asins.slice(0, filters.limit) : asins,
    growth,
    currentCeiling,
    yearFloor,
    totalMatches: typeof raw.totalResults === "number" ? raw.totalResults : null,
    tokensLeft: typeof raw.tokensLeft === "number" ? raw.tokensLeft : null,
  };
}
