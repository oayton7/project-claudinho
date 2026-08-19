/**
 * Turning a Keepa product into a candidate.
 *
 * Extracted from the sweep route so the pipeline uses the same code rather
 * than a second copy that drifts. The brief's instruction was to move logic,
 * not rewrite it — two implementations of "what counts as a weak listing"
 * would be two rubrics.
 */
import { maxLandedCost } from "./margin";
import { hardKill, scoreCandidate, autoVerdict, type ScoreResult, type Scorable, type Weights } from "./score";

export type Candidate = {
  asin: string;
  category: string;
  title: string | null;
  brand: string | null;
  price: number | null;
  salesRank: number | null;
  reviewCount: number | null;
  rating: number | null;
  sellers: number | null;
  rankDrops90: number | null;
  packageWeightG: number | null;
  unhappyBuyers: number | null;
  maxLandedCost: number | null;
  monthlySold: number | null;
  description: string | null;
  features: string[];
  imageCount: number;
  referralFeePct: number | null;
  hasAplus: boolean;
  videoCount: number;
  listingWeaknesses: string[];
  us: UsSignal | null;
  flags: string[];
  score: ScoreResult | null;
  killed: string | null;
  verdict: "TEST" | "PARK" | "KILL" | null;
  because: string;
};

export type UsSignal = {
  price: number | null;
  monthlySold: number | null;
  salesRank: number | null;
  /** 30-day average rank better than the 90-day average means it is climbing. */
  growing: boolean | null;
};

/**
 * How lazy is the incumbent's listing?
 *
 * You cannot see a competitor's ad spend, but you can see their shop window,
 * and a neglected one is countable. Each of these is a specific job you could
 * do better for the price of an afternoon, which is the cheapest kind of
 * advantage there is.
 */
export function listingWeaknesses(
  title: string | null,
  brand: string | null,
  features: string[],
  description: string | null,
  imageCount: number | null,
  listing: { hasAplus: boolean; videoCount: number },
): string[] {
  const weak: string[] = [];

  // Sellers who never intended to build a brand tend to register a random
  // string. No vowels, or letters plus digits, is the usual shape.
  if (brand) {
    const bare = brand.replace(/[^A-Za-z0-9]/g, "");
    if (bare.length >= 4 && !/[aeiou]/i.test(bare)) {
      weak.push(`brand "${brand}" looks like a random string, not a brand`);
    } else if (/^[A-Za-z]+\d+$/.test(bare) || /\d{2,}/.test(bare)) {
      weak.push(`brand "${brand}" reads as a placeholder`);
    }
  } else {
    weak.push("no brand set");
  }

  if (title) {
    if (title.length > 150) weak.push(`title is ${title.length} chars, keyword stuffed`);
    if (title.length < 30) weak.push(`title is only ${title.length} chars, barely tries`);
    // A title that repeats the same word is written for a search engine
    // rather than a person, and it reads that way on the page.
    const words: string[] = title.toLowerCase().match(/[a-z]{4,}/g) ?? [];
    const repeated = words.filter((w, i) => words.indexOf(w) !== i);
    if (new Set(repeated).size >= 3) weak.push("title repeats the same keywords");
  } else {
    weak.push("no title");
  }

  if (features.length === 0) weak.push("no bullet points");
  else if (features.length < 4) weak.push(`only ${features.length} bullet points`);

  if (!description || description.length < 100) weak.push("thin or missing description");
  if (imageCount !== null && imageCount > 0 && imageCount < 5)
    weak.push(`only ${imageCount} images`);
  // null means Keepa did not tell us, which is not the same as zero. Claiming
  // a weakness that might not exist is worse than staying quiet about it.
  if (imageCount === 0) weak.push("no images at all");

  // The two biggest marketing gaps, and the two easiest to beat. A+ content is
  // a Brand Registry feature a lazy seller never sets up; a video is an
  // afternoon's work that most listings still do not have.
  if (!listing.hasAplus) weak.push("no A+ content");
  if (listing.videoCount === 0) weak.push("no video");

  return weak;
}

export function buildCandidate(
  product: Record<string, unknown>,
  category: string,
): Candidate {
  const stats = (product.stats ?? {}) as Record<string, unknown>;
  const current = stats.current as number[] | undefined;
  const pence = (v: unknown) => (typeof v === "number" && v >= 0 ? v / 100 : null);
  const int = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);

  const price = pence(stats.buyBoxPrice) ?? pence(current?.[1]);
  const reviewCount = int(current?.[17]);
  const rating = int(current?.[16]) === null ? null : (current![16] as number) / 10;
  const weight = int(product.packageWeight);
  const rankDrops90 = int(stats.salesRankDrops90);

  const unhappyBuyers =
    reviewCount !== null && rating !== null
      ? Math.round(reviewCount * Math.max(0, 4.5 - rating))
      : null;

  // Amazon's own "bought in the past month" figure, which Keepa passes
  // through. Far better than inferring sales from rank drops, though it is
  // only populated on some listings.
  const monthlySold = int(product.monthlySold);

  const features = Array.isArray(product.features)
    ? (product.features as string[]).filter((f) => typeof f === "string")
    : [];
  // Descriptions run to thousands of characters and there may be a hundred
  // products in a sweep. Enough to judge the tone, not the whole thing.
  const rawDescription =
    typeof product.description === "string"
      ? product.description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
      : null;
  const description =
    rawDescription && rawDescription.length > 400
      ? rawDescription.slice(0, 400) + "…"
      : rawDescription;
  // `images`, not `imagesCSV`. Reading the wrong key made every product look
  // like it had no photographs, so the tool invented a listing weakness that
  // did not exist and then rewarded the product for it.
  const images = product.images;
  const imageCount = Array.isArray(images)
    ? images.length
    : typeof product.imagesCSV === "string" && product.imagesCSV.length > 0
      ? product.imagesCSV.split(",").length
      : null;

  // Keepa returns these only when aplus=1 and videos=1 are requested. Absent
  // fields mean "not asked for", which is not the same as "not present", so
  // both are read defensively rather than assumed missing.
  // Keepa's real referral fee for this product, which beats any table built by
  // hand. The table in fees.ts stays as the fallback for when it is absent.
  const keepaReferralPct =
    typeof product.referralFeePercent === "number"
      ? product.referralFeePercent
      : typeof product.referralFeePercentage === "number"
        ? product.referralFeePercentage
        : null;

  const aplus = product.aPlus ?? product.aplus;
  const hasAplus = Array.isArray(aplus)
    ? aplus.length > 0
    : typeof aplus === "object" && aplus !== null;
  const videos = product.videos;
  const videoCount = Array.isArray(videos) ? videos.length : 0;

  // Free, because it is arithmetic. Solving for the supplier price you would
  // need is the only margin question answerable before you have a quote.
  const ceiling =
    price === null
      ? null
      : maxLandedCost(price, {
          referralFeePct: keepaReferralPct ?? undefined,
        }).landed;

  // Concerns rather than a composite score. A single blended number would
  // hide which thing is actually wrong, and the rest of this app reports
  // pass/fail checks for exactly that reason.
  const flags: string[] = [];
  if (price !== null && price < 12) flags.push("under the £12 floor");
  if (weight !== null && weight > 1000) flags.push("over 1kg, freight will hurt");
  if (rankDrops90 !== null && rankDrops90 < 30)
    flags.push("barely sells, under 30 in 90 days");
  if (ceiling !== null && ceiling < 3)
    flags.push(`needs landing under £${ceiling.toFixed(2)}, very tight`);
  if (rating !== null && rating >= 4.4)
    flags.push("well liked already, less room to improve");

  return {
    asin: String(product.asin ?? ""),
    category,
    title: (product.title as string) ?? null,
    brand: (product.brand as string) ?? null,
    price,
    salesRank: int(current?.[3]),
    reviewCount,
    rating,
    sellers: int(stats.totalOfferCount),
    rankDrops90,
    packageWeightG: weight,
    unhappyBuyers,
    maxLandedCost: ceiling,
    monthlySold,
    description,
    features,
    imageCount: imageCount ?? 0,
    referralFeePct: keepaReferralPct,
    hasAplus,
    videoCount,
    listingWeaknesses: listingWeaknesses(
      (product.title as string) ?? null,
      (product.brand as string) ?? null,
      features,
      rawDescription,
      imageCount,
      { hasAplus, videoCount },
    ),
    us: null,
    flags,
    // Filled in after the US check, so the US signal can count towards it.
    score: null,
    killed: null,
    verdict: null,
    because: "",
  };
}


export function toScorable(c: Candidate): Scorable {
  return {
    price: c.price,
    rating: c.rating,
    reviewCount: c.reviewCount,
    unhappyBuyers: c.unhappyBuyers,
    monthlySold: c.monthlySold,
    rankDrops90: c.rankDrops90,
    sellers: c.sellers,
    packageWeightG: c.packageWeightG,
    maxLandedCost: c.maxLandedCost,
    listingWeaknessCount: c.listingWeaknesses.length,
    usGrowing: c.us?.growing ?? null,
  };
}

/** Score, kill-check and verdict in one place, so every caller agrees. */
export function judgeFreely(c: Candidate, weights?: Weights): Candidate {
  const scorable = toScorable(c);
  const killed = hardKill(scorable);
  const score = scoreCandidate(scorable, weights);
  const decided = autoVerdict(score, killed, {
    rating: c.rating,
    reviewCount: c.reviewCount,
  });
  return { ...c, killed, score, verdict: decided.verdict, because: decided.because };
}
