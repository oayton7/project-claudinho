/**
 * Is there room for another product here, and where.
 *
 * Everything else in this tool judges one product against a rubric. That
 * answers "is this listing beatable" and leaves the more important question
 * untouched: whether the shelf has space on it at all. A beatable listing in
 * a category one brand already owns is not an opening, it is a fight you have
 * funded with three thousand pounds.
 *
 * Free arithmetic, deliberately, and it runs before anything is paid for. The
 * numbers it produces are the ones a person would work out by hand from the
 * search results page, which means they can be checked and argued with rather
 * than trusted.
 */

export type Competitor = {
  asin: string;
  title: string | null;
  brand: string | null;
  price: number | null;
  rating: number | null;
  reviewCount: number | null;
  hasAplus: boolean;
  videoCount: number;
  imageCount: number | null;
};

export type NichePicture = {
  listings: number;
  /** Share of all reviews held by the largest brand. 1 = one brand owns it. */
  leaderShare: number;
  /** Herfindahl index over brands. Above 0.25 is a concentrated market. */
  concentration: number;
  medianPrice: number | null;
  priceSpread: number | null;
  medianRating: number | null;
  /** How many listings sit at or below 4.3, the dissatisfaction line. */
  unhappyListings: number;
  totalReviews: number;
  /** Share of listings doing the basics: A+ content, a video, five images. */
  withAplus: number;
  withVideo: number;
  thinImagery: number;
  room: "crowded" | "contested" | "open";
  why: string[];
};

const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 100) / 100;
};

/**
 * Reads a competitive set the way a person would read the first page of
 * results, but without flattering anything.
 */
export function readNiche(set: Competitor[]): NichePicture | null {
  const listings = set.length;
  if (listings < 4) return null;

  const reviews = set.map((c) => c.reviewCount ?? 0);
  const totalReviews = reviews.reduce((a, b) => a + b, 0);

  // Brand concentration. Reviews rather than listing count, because ten
  // listings from one brand is one competitor wearing ten hats, and because
  // reviews are the closest free proxy for who is actually selling.
  const byBrand = new Map<string, number>();
  for (const c of set) {
    const brand = (c.brand ?? c.asin).toLowerCase().trim();
    byBrand.set(brand, (byBrand.get(brand) ?? 0) + (c.reviewCount ?? 0));
  }
  const shares = [...byBrand.values()].map((v) => (totalReviews > 0 ? v / totalReviews : 0));
  const leaderShare = shares.length ? Math.max(...shares) : 0;
  const concentration = shares.reduce((a, s) => a + s * s, 0);

  const prices = set.map((c) => c.price).filter((p): p is number => typeof p === "number" && p > 0);
  const ratings = set.map((c) => c.rating).filter((r): r is number => typeof r === "number" && r > 0);

  const medianPrice = median(prices);
  const priceSpread =
    prices.length > 1 ? Math.round((Math.max(...prices) - Math.min(...prices)) * 100) / 100 : null;
  const medianRating = median(ratings);
  const unhappyListings = ratings.filter((r) => r <= 4.3).length;

  const withAplus = set.filter((c) => c.hasAplus).length;
  const withVideo = set.filter((c) => c.videoCount > 0).length;
  const thinImagery = set.filter((c) => (c.imageCount ?? 0) < 5).length;

  const why: string[] = [];

  // One brand holding most of the reviews means the category has an answer
  // already, and you would be arguing with it rather than filling a gap.
  if (leaderShare >= 0.5) {
    why.push(
      `One brand holds ${Math.round(leaderShare * 100)}% of all the reviews here. That is a category with an owner, and a new listing argues with it rather than filling a gap.`,
    );
  } else if (leaderShare <= 0.25) {
    why.push(
      `No brand holds more than ${Math.round(leaderShare * 100)}% of the reviews, so nobody owns this shelf.`,
    );
  }

  // Satisfaction is the clearest signal of whether buyers are being served.
  if (medianRating !== null && medianRating <= 4.2) {
    why.push(
      `The median rating is ${medianRating}, and ${unhappyListings} of ${listings} listings sit at or below 4.3. Buyers are spending money and are not happy.`,
    );
  } else if (medianRating !== null && medianRating >= 4.6) {
    why.push(
      `The median rating is ${medianRating}. Buyers here are already well served, which leaves little for a better version to fix.`,
    );
  }

  // Execution across the field, which is where the marketing thesis lives.
  const aplusShare = withAplus / listings;
  const videoShare = withVideo / listings;
  if (aplusShare <= 0.35 && videoShare <= 0.35) {
    why.push(
      `Only ${withAplus} of ${listings} have A+ content and ${withVideo} have a video. The field is not trying very hard, which is the cheapest kind of opening.`,
    );
  } else if (aplusShare >= 0.7 && videoShare >= 0.6) {
    why.push(
      `${withAplus} of ${listings} have A+ content and ${withVideo} have video. This field is executing well, so there is no lazy-photography win here.`,
    );
  }

  if (priceSpread !== null && medianPrice !== null && priceSpread >= medianPrice) {
    why.push(
      `Prices run from one end to the other with a £${priceSpread.toFixed(2)} spread around a £${medianPrice.toFixed(2)} median, which usually means the category has not settled on what good looks like.`,
    );
  }

  // The verdict, from the three things that actually decide it: is it owned,
  // are buyers unhappy, and is the field trying.
  const owned = leaderShare >= 0.5 || concentration >= 0.3;
  const served = medianRating !== null && medianRating >= 4.5;
  const polished = aplusShare >= 0.7 && videoShare >= 0.6;

  const room: NichePicture["room"] =
    owned && (served || polished)
      ? "crowded"
      : !owned && !served && !polished
        ? "open"
        : "contested";

  return {
    listings,
    leaderShare: Math.round(leaderShare * 100) / 100,
    concentration: Math.round(concentration * 100) / 100,
    medianPrice,
    priceSpread,
    medianRating,
    unhappyListings,
    totalReviews,
    withAplus,
    withVideo,
    thinImagery,
    room,
    why,
  };
}
