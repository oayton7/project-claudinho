"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ScoutCandidateRow } from "@/lib/stages";

const VERDICT_STYLE: Record<string, string> = {
  TEST: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  PARK: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  KILL: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};

export default function ShortlistPage() {
  const [rows, setRows] = useState<ScoutCandidateRow[]>([]);
  const [counts, setCounts] = useState({ test: 0, park: 0, killed: 0 });
  const [showKilled, setShowKilled] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/shortlist${showKilled ? "?killed=1" : ""}`);
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Could not load the shortlist");
        return;
      }
      setRows(data.rows);
      setCounts({ test: data.test, park: data.park, killed: data.killed });
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, [showKilled]);

  useEffect(() => {
    void load();
  }, [load]);

  const money = (n: number | null) => (n === null ? "—" : `£${Number(n).toFixed(2)}`);

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-5xl flex-1 px-6 py-14 sm:px-10">
        <Link
          href="/"
          className="font-mono text-xs uppercase tracking-widest text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
        >
          ← Project Claudinho
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Shortlist
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Everything the tool has decided, and why. TEST first, because those
          are the ones to act on. PARK next, because &quot;why did you park
          this&quot; is worth being able to answer — a parked product is often
          the one you come back to when a supplier quote changes.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {[
            ["TEST", counts.test],
            ["PARK", counts.park],
            ...(showKilled ? ([["KILL", counts.killed]] as [string, number][]) : []),
          ].map(([label, n]) => (
            <span
              key={String(label)}
              className={`rounded px-3 py-1 text-sm font-medium ${VERDICT_STYLE[String(label)]}`}
            >
              {String(n)} {String(label)}
            </span>
          ))}
          <label className="ml-auto flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={showKilled}
              onChange={(e) => setShowKilled(e.target.checked)}
            />
            Show the killed ones too
          </label>
        </div>

        {error && (
          <p className="mt-5 rounded border border-red-300 bg-red-50 p-4 text-sm leading-6 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
            {error}
          </p>
        )}

        {loading ? (
          <p className="mt-8 text-sm text-zinc-500">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="mt-8 rounded border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Nothing judged yet.
            </p>
            <p className="mt-2 text-xs leading-5 text-zinc-500">
              Run a sweep, then press{" "}
              <strong className="font-medium">Judge the survivors</strong>. The
              verdicts land here and stay, so this fills up across sessions
              rather than resetting.
            </p>
            <Link
              href="/sweep"
              className="mt-4 inline-block rounded bg-black px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-black"
            >
              Go to the sweep →
            </Link>
          </div>
        ) : (
          <ul className="mt-6 space-y-4">
            {rows.map((r) => (
              <li
                key={r.asin}
                className="rounded border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${
                        VERDICT_STYLE[r.triage_verdict ?? ""] ?? "bg-zinc-100 text-zinc-700"
                      }`}
                    >
                      {r.triage_verdict ?? "not judged"}
                    </span>
                    <a
                      href={`https://www.amazon.co.uk/dp/${r.asin}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 font-medium text-black underline dark:text-zinc-100"
                    >
                      {r.title || r.asin}
                    </a>
                    <span className="mt-0.5 block font-mono text-[11px] text-zinc-500">
                      {r.asin} · {r.category}
                      {r.brand ? ` · ${r.brand}` : ""}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="block text-2xl font-semibold tabular-nums text-black dark:text-zinc-100">
                      {r.score ?? "—"}
                    </span>
                    <span className="block text-[10px] text-zinc-500">score</span>
                  </div>
                </div>

                {r.triage_because && (
                  <p className="mt-3 text-sm leading-6 text-zinc-800 dark:text-zinc-200">
                    {r.triage_because}
                  </p>
                )}
                {r.triage_main_risk && (
                  <p className="mt-1 text-sm leading-6 text-amber-800 dark:text-amber-400">
                    <strong className="font-medium">Main risk:</strong>{" "}
                    {r.triage_main_risk}
                  </p>
                )}
                {r.killed_reason && (
                  <p className="mt-1 text-sm leading-6 text-red-800 dark:text-red-400">
                    <strong className="font-medium">Hard kill:</strong> {r.killed_reason}
                  </p>
                )}

                <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
                  {[
                    ["Price", money(r.price)],
                    ["Max landed", money(r.max_landed_cost)],
                    ["Rating", r.rating ?? "—"],
                    ["Reviews", r.review_count?.toLocaleString("en-GB") ?? "—"],
                    ["Unhappy buyers", r.unhappy_buyers?.toLocaleString("en-GB") ?? "—"],
                    ["Sold/month", r.monthly_sold?.toLocaleString("en-GB") ?? "—"],
                    ["Weight", r.weight_grams ? `${r.weight_grams}g` : "—"],
                    [
                      "Improvability",
                      r.triage_improvability === null ? "—" : `${r.triage_improvability}/10`,
                    ],
                  ].map(([k, v]) => (
                    <div key={String(k)}>
                      <dt className="text-zinc-500">{k}</dt>
                      <dd className="tabular-nums text-zinc-800 dark:text-zinc-200">
                        {String(v)}
                      </dd>
                    </div>
                  ))}
                </dl>

                {r.listing_weaknesses && (
                  <p className="mt-3 text-xs leading-5 text-emerald-700 dark:text-emerald-400">
                    <strong className="font-medium">Their listing is missing:</strong>{" "}
                    {r.listing_weaknesses.split(" · ").join(", ")}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap gap-3 text-xs">
                  <Link href={`/margin?asin=${r.asin}`} className="underline">
                    Margin
                  </Link>
                  <Link href={`/reviews?asin=${r.asin}`} className="underline">
                    Read its reviews
                  </Link>
                  <Link href={`/keepa?asin=${r.asin}`} className="underline">
                    Keepa
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
