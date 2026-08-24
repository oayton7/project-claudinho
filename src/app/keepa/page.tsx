"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type Series = {
  index: number;
  present: boolean;
  pairs: number;
  firstValue: number | null;
  lastValue: number | null;
  firstDate: string | null;
  lastDate: string | null;
};

type NamedStats = {
  salesRankDrops30: number | null;
  salesRankDrops90: number | null;
  salesRankDrops180: number | null;
  salesRankDrops365: number | null;
  totalOfferCount: number | null;
  offerCountFBA: number | null;
  offerCountFBM: number | null;
  outOfStockPercentage90: number | null;
  buyBoxPrice: number | null;
  buyBoxIsAmazon: boolean | null;
};

type Probe = {
  askedFor: { asin: string; domain: string };
  tokensLeft: number | null;
  shape: {
    namedStats?: NamedStats;
    indexedStats?: { current?: number[] | null };
    salesRanksByCategory?:
      | {
          categoryId: string;
          points: number;
          latestRank: number | null;
          firstDate: string | null;
          lastDate: string | null;
        }[]
      | null;
    topLevelKeys?: string[];
    tokensConsumed?: number;
    products?: number;
    product?: {
      asin?: string;
      title?: string;
      hasStats?: boolean;
      statsKeys?: string[] | null;
      csvSeries?: Series[] | null;
    };
  };
};

/**
 * What each csv index is *believed* to be. Unverified until a real response
 * confirms it, which is the entire point of this page.
 */
const EXPECTED: Record<number, string> = {
  0: "Amazon price",
  1: "New price (3rd party)",
  2: "Used price",
  3: "SALES RANK",
  4: "List price",
  10: "New, FBA",
  11: "SELLER COUNT (new)",
  16: "Rating",
  17: "Review count",
  18: "Buy box",
};

/** A rough sanity read, so a wrong index is obvious rather than plausible. */
function plausibility(index: number, value: number | null): string {
  if (value === null) return "";
  if (value === -1) return "no data at this point";
  if (index === 3) {
    return value > 500 && value < 5_000_000
      ? "✓ looks like a sales rank"
      : "✗ does NOT look like a sales rank";
  }
  if (index === 11) {
    return value >= 0 && value < 500
      ? "✓ looks like a seller count"
      : "✗ too large for a seller count";
  }
  if ([0, 1, 2, 4, 10, 18].includes(index)) {
    return value > 50 && value < 200_000
      ? `✓ looks like a price — £${(value / 100).toFixed(2)}`
      : "✗ does not look like a price in pence";
  }
  if (index === 16) {
    return value >= 0 && value <= 50 ? "✓ rating, times 10" : "✗ not a rating";
  }
  return "";
}

function KeepaPageInner() {
  // Linked to from the products list as /keepa?asin=...
  //
  // Read straight into the initial state rather than set from an effect. The
  // effect version wrote state on the first render for every visitor, whether
  // or not there was an ASIN in the URL, which is a render the page never
  // needed and which stopped the component being optimised at all.
  const searchParams = useSearchParams();
  const [asin, setAsin] = useState(() =>
    (searchParams.get("asin") ?? "").toUpperCase(),
  );
  const [domain, setDomain] = useState<"uk" | "us">("uk");
  const [probe, setProbe] = useState<Probe | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function run(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setProbe(null);
    try {
      const response = await fetch(
        `/api/keepa/probe?asin=${encodeURIComponent(asin.trim())}&domain=${domain}`,
      );
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Keepa request failed");
        return;
      }
      setProbe(data);
    } catch {
      setError("Could not reach the server");
    } finally {
      setLoading(false);
    }
  }

  const series = (probe?.shape.product?.csvSeries ?? []).filter(
    (s) => s.present,
  );

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-4xl flex-1 px-6 py-14 sm:px-10">
        <Link
          href="/"
          className="font-mono text-xs uppercase tracking-widest text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
        >
          ← Project Claudinho
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Keepa data check
        </h1>
        <p className="mt-3 max-w-2xl text-zinc-600 dark:text-zinc-400">
          Confirms what Keepa actually returns before anything is built on it.
          Keepa sends history as a numbered list of series, and the number
          decides the meaning. If we assume wrong, the tool reports a used-price
          history as a sales rank and never complains. One token per check.
        </p>

        <form onSubmit={run} className="mt-8 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block text-zinc-700 dark:text-zinc-300">ASIN</span>
            <input
              value={asin}
              onChange={(e) => setAsin(e.target.value)}
              placeholder="B08N5WRWNW"
              className="mt-1 w-44 rounded border border-zinc-300 bg-white px-2.5 py-1.5 font-mono text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
            <span className="mt-1 block text-xs text-zinc-500">
              The ten characters after /dp/ in the Amazon URL
            </span>
          </label>
          <div className="flex gap-1.5">
            {(["uk", "us"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDomain(d)}
                className={`rounded border px-3 py-1.5 text-xs font-medium uppercase ${
                  domain === d
                    ? "border-black bg-black text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-black"
                    : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
          <button
            type="submit"
            disabled={loading || asin.trim().length !== 10}
            className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-black"
          >
            {loading ? "Asking Keepa…" : "Check"}
          </button>
        </form>

        {error && (
          <p className="mt-5 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
            {error}
          </p>
        )}

        {probe && (
          <div className="mt-8 space-y-6">
            <div className="rounded border border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
              <p className="text-sm font-medium text-black dark:text-zinc-100">
                {probe.shape.product?.title ?? "(no title returned)"}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {probe.askedFor.asin} · {probe.askedFor.domain.toUpperCase()} ·
                tokens left {probe.tokensLeft ?? "unknown"} · consumed{" "}
                {probe.shape.tokensConsumed ?? "unknown"}
              </p>
            </div>

            {probe.shape.namedStats && (
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
                  What Gate 1 actually needs
                </h2>
                <p className="mt-1 text-xs text-zinc-500">
                  These are named fields, so unlike the numbered series below
                  they cannot be misread by guessing a position wrong.
                </p>
                <dl className="mt-3 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                  {[
                    [
                      "Rank drops, 30 days",
                      probe.shape.namedStats.salesRankDrops30,
                      "Roughly one drop per sale. The closest free proxy for units sold",
                    ],
                    [
                      "Rank drops, 90 days",
                      probe.shape.namedStats.salesRankDrops90,
                      "The one to judge velocity on. Divide by 3 for a monthly figure",
                    ],
                    [
                      "Rank drops, 365 days",
                      probe.shape.namedStats.salesRankDrops365,
                      "Compare against 90 to see whether demand is growing or decaying",
                    ],
                    [
                      "Sellers, total",
                      probe.shape.namedStats.totalOfferCount,
                      "Enough to prove a market, few enough to enter",
                    ],
                    [
                      "Sellers on FBA",
                      probe.shape.namedStats.offerCountFBA,
                      "Your real competition",
                    ],
                    [
                      "Out of stock, 90 days",
                      probe.shape.namedStats.outOfStockPercentage90,
                      "How often competitors run dry. A high number is an opening",
                    ],
                  ].map(([label, value, note]) => (
                    <div key={String(label)}>
                      <dt className="flex items-baseline justify-between gap-3">
                        <span className="text-sm text-zinc-700 dark:text-zinc-300">
                          {label}
                        </span>
                        <span className="font-mono text-sm font-semibold tabular-nums text-black dark:text-zinc-100">
                          {value === null || value === undefined
                            ? "—"
                            : String(value)}
                        </span>
                      </dt>
                      <dd className="mt-0.5 text-xs leading-4 text-zinc-500">
                        {note}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {probe.shape.salesRanksByCategory &&
              probe.shape.salesRanksByCategory.length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
                    Sales rank history
                  </h2>
                  <ul className="mt-2 space-y-1 text-xs">
                    {probe.shape.salesRanksByCategory.map((c) => (
                      <li
                        key={c.categoryId}
                        className="text-zinc-600 dark:text-zinc-400"
                      >
                        Category {c.categoryId}: latest rank{" "}
                        <strong className="font-mono text-black dark:text-zinc-100">
                          {c.latestRank ?? "—"}
                        </strong>
                        , {c.points} data points, {c.firstDate} → {c.lastDate}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            {series.length === 0 ? (
              <p className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                No history came back. Either the ASIN does not exist on that
                marketplace, or Keepa has no data for it. Try a different one.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-zinc-300 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-700">
                    <tr>
                      <th className="py-2 pr-3">#</th>
                      <th className="py-2 pr-3">Expected</th>
                      <th className="py-2 pr-3 text-right">Points</th>
                      <th className="py-2 pr-3 text-right">Latest</th>
                      <th className="py-2 pr-3">Range</th>
                      <th className="py-2">Sanity check</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {series.map((s) => {
                      const check = plausibility(s.index, s.lastValue);
                      const bad = check.startsWith("✗");
                      return (
                        <tr
                          key={s.index}
                          className={bad ? "bg-red-50 dark:bg-red-950/40" : ""}
                        >
                          <td className="py-2 pr-3 font-mono text-xs">
                            {s.index}
                          </td>
                          <td className="py-2 pr-3 text-xs">
                            {EXPECTED[s.index] ?? (
                              <span className="text-zinc-400">unknown</span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums text-xs">
                            {s.pairs}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums text-xs">
                            {s.lastValue ?? "—"}
                          </td>
                          <td className="py-2 pr-3 text-xs text-zinc-500">
                            {s.firstDate} → {s.lastDate}
                          </td>
                          <td
                            className={`py-2 text-xs ${bad ? "font-medium text-red-800 dark:text-red-300" : "text-zinc-600 dark:text-zinc-400"}`}
                          >
                            {check}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="rounded border border-zinc-300 bg-white p-4 text-xs leading-5 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
              <p className="font-medium text-black dark:text-zinc-100">
                What to look for
              </p>
              <p className="mt-1">
                Index 3 should read as a sales rank and index 11 as a seller
                count. If either says ✗, the assumed positions are wrong and
                nothing should be built on them until they are corrected. Check
                the dates too: if they read 1970 or 2087, the timestamp
                conversion is out.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/**
 * useSearchParams needs a Suspense boundary, because it forces the subtree to
 * render on the client and Next wants somewhere to put the gap.
 */
export default function KeepaPage() {
  return (
    <Suspense fallback={null}>
      <KeepaPageInner />
    </Suspense>
  );
}
