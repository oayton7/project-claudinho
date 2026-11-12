/**
 * SoldScope, for the things Keepa cannot tell you.
 *
 * Keepa is the spine of this tool and stays that way. What it does not give,
 * and what this is here for:
 *
 * - **Shape of a year.** Sales and rank history, which is how you tell a
 *   growing product from a seasonal one. The tool has been catching that only
 *   when the Judge happened to reason about what a product was, and ordering a
 *   summer product in October means eight months of capital in a warehouse.
 * - **Units, not ranks.** Estimated sales rather than a rank the tool then has
 *   to guess at. Published rank-to-units tables disagree with each other by
 *   several times over and none of them are UK-specific.
 * - **What a click costs.** Search volume and CPC, so the advertising figure
 *   in the margin engine stops being a flat assumption.
 *
 * Budget is the thing to design around. A plan buys 500 to 5,000 requests a
 * month, so this must never be called on everything: only on candidates that
 * have already survived the free arithmetic, and the answer is stored so the
 * same product is never paid for twice.
 */

const BASE = "https://www.soldscope.com/api";

export class MissingSoldscopeToken extends Error {
  constructor(
    message = "SOLDSCOPE_API_TOKEN is not set. Create one at app.soldscope.com/api-access — it is shown only once — then add it to the Vercel project's environment variables and redeploy.",
  ) {
    super(message);
    this.name = "MissingSoldscopeToken";
  }
}

export class SoldscopeQuotaSpent extends Error {
  constructor(
    message = "SoldScope's monthly request quota is spent. It resets with the billing month; nothing is lost and the pipeline carries on without it.",
  ) {
    super(message);
    this.name = "SoldscopeQuotaSpent";
  }
}

function token(): string {
  const t = process.env.SOLDSCOPE_API_TOKEN?.trim();
  if (!t) throw new MissingSoldscopeToken();
  return t;
}

/** True when a token is configured, so callers can skip rather than throw. */
export function soldscopeAvailable(): boolean {
  return Boolean(process.env.SOLDSCOPE_API_TOKEN?.trim());
}

/**
 * One call, with the failures named.
 *
 * Same discipline as the Keepa client: a non-JSON body means an outage or a
 * proxy rather than a bad request, and saying so stops the next person
 * debugging the parser.
 */
async function call<T>(path: string, params: Record<string, string | number | undefined>): Promise<{
  data: T;
  requestsLeft: number | null;
}> {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token()}`, Accept: "application/json" },
  });

  const remaining = response.headers.get("X-API-RateLimit-Remaining");
  const requestsLeft = remaining === null ? null : Number(remaining);

  // 402 is the documented over-quota response, and it is a wait rather than a
  // fault: it clears with the billing month.
  if (response.status === 402) throw new SoldscopeQuotaSpent();
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `SoldScope refused the token (${response.status}). Either it is wrong, it has been revoked, or this endpoint needs a connected Amazon account on your SoldScope plan.`,
    );
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `SoldScope returned ${response.status} for ${path}. ${text.slice(0, 160).replace(/\s+/g, " ")}`,
    );
  }

  try {
    return { data: JSON.parse(text) as T, requestsLeft };
  } catch {
    throw new Error(
      `SoldScope returned something that is not JSON from ${path} (${text.slice(0, 80).replace(/\s+/g, " ")}). That usually means an outage or a proxy in the way rather than a problem with the request.`,
    );
  }
}

/**
 * The raw body from one endpoint, for working out what it actually sends.
 *
 * Exists because reading an undocumented shape by guessing field names is how
 * this project has repeatedly convinced itself something worked. One real
 * call beats any amount of defensive coding.
 */
export async function raw(
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<unknown> {
  const { data } = await call<unknown>(path, params);
  return data;
}

/** Proves the token works, and costs nothing against the quota. */
export async function checkToken(): Promise<{ ok: true; account: unknown }> {
  const { data } = await call<unknown>("/auth/check", {});
  return { ok: true, account: data };
}

export type Seasonality = {
  /** 0 = flat all year, 1 = entirely concentrated in a few months. */
  concentration: number;
  /** Month numbers, best first. */
  peakMonths: number[];
  seasonal: boolean;
  why: string;
};

/**
 * Reads a year of rank history as the shape of a year.
 *
 * Lower rank means better selling, so the series is inverted before anything
 * is measured. Concentration is the share of the year's selling that happens
 * in its best three months: a flat product scores near 0.25, a product that
 * only sells in summer scores far higher.
 */
export function seasonalityFrom(
  points: { date: string; rank: number }[],
): Seasonality | null {
  if (points.length < 24) return null;

  const byMonth = new Map<number, number[]>();
  for (const p of points) {
    const m = new Date(p.date).getUTCMonth() + 1;
    if (!Number.isFinite(p.rank) || p.rank <= 0) continue;
    // Invert: a rank of 1,000 sells far more than one of 100,000.
    const strength = 1 / p.rank;
    byMonth.set(m, [...(byMonth.get(m) ?? []), strength]);
  }
  if (byMonth.size < 6) return null;

  const means = [...byMonth.entries()].map(([m, xs]) => ({
    month: m,
    mean: xs.reduce((a, b) => a + b, 0) / xs.length,
  }));
  const total = means.reduce((a, b) => a + b.mean, 0);
  if (total <= 0) return null;

  const ranked = [...means].sort((a, b) => b.mean - a.mean);
  const topThree = ranked.slice(0, 3).reduce((a, b) => a + b.mean, 0);
  const concentration = Math.round((topThree / total) * 100) / 100;

  // A flat product puts a quarter of its year in any three months. Half or
  // more in three months is a season, not a trend.
  const seasonal = concentration >= 0.5;
  const names = ["", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const peakMonths = ranked.slice(0, 3).map((r) => r.month);

  return {
    concentration,
    peakMonths,
    seasonal,
    why: seasonal
      ? `${Math.round(concentration * 100)}% of the year's selling happens in ${peakMonths.map((m) => names[m]).join(", ")}. Order against that calendar, because stock landing after the peak sits until the next one.`
      : `Selling is spread through the year, with no month carrying it. ${Math.round(concentration * 100)}% falls in the best three months, against 25% for a perfectly flat product.`,
  };
}

/**
 * A year of sales rank for one product. One request against the quota.
 *
 * `days` is required, which the probe found rather than the documentation:
 * without it the endpoint answers 422 "The days field is required". 365
 * because seasonality is a question about a year, and anything shorter cannot
 * distinguish a summer product from one that happens to be selling now.
 */
export async function bsrHistory(
  asin: string,
  marketplace = "UK",
  days = 365,
): Promise<{ points: { date: string; rank: number }[]; requestsLeft: number | null }> {
  const { data, requestsLeft } = await call<Record<string, unknown>>("/common/bsr-history", {
    asin,
    marketplace,
    days,
  });
  // The real shape, found by probing rather than guessing:
  //   { data: { bsr: [{ value, time, category }], categories: [...] } }
  // The first reader looked for history/points and rank/date and found none
  // of them. Alternatives are kept only as a cushion against the API
  // changing, never as a substitute for having checked.
  const payload = (data.data ?? data) as Record<string, unknown>;
  const series =
    (payload.bsr as unknown[]) ??
    (payload.history as unknown[]) ??
    (payload.points as unknown[]);
  if (!Array.isArray(series)) {
    throw new Error(
      `SoldScope's bsr-history returned a shape this tool does not recognise for ${asin}. Top-level keys: ${Object.keys(data).join(", ") || "none"}; inner keys: ${Object.keys(payload).join(", ") || "none"}. The reader needs updating rather than the product being treated as having no history.`,
    );
  }
  const points = series
    .map((p) => {
      const o = p as Record<string, unknown>;
      // `time` and `value` are what it actually sends; the rest are a cushion.
      const date = String(o.time ?? o.date ?? o.timestamp ?? "");
      const rank = Number(o.value ?? o.rank ?? o.bsr);
      return date && Number.isFinite(rank) && rank > 0 ? { date, rank } : null;
    })
    .filter((p): p is { date: string; rank: number } => p !== null);

  return { points, requestsLeft };
}
