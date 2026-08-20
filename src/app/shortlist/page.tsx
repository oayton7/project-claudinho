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
  const [deepening, setDeepening] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<string | null>(null);

  /**
   * Move a candidate onto the products board.
   *
   * Everything it needs is already on the row, which is the point — the break
   * this closes was a candidate surviving the whole chain and still having to
   * be retyped by hand.
   */
  async function promote(asin: string) {
    setPromoting(asin);
    setError("");
    try {
      const response = await fetch("/api/shortlist/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asin }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Could not promote");
        return;
      }
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setPromoting(null);
    }
  }

  /**
   * Export what is on screen.
   *
   * Supplier conversations happen in email and on Alibaba, not in here, and
   * the one column that matters there is max landed cost — the figure that
   * turns "how much is this?" into "can you make it for this?".
   */
  function exportCsv() {
    const cols = [
      "verdict", "score", "asin", "title", "brand", "category",
      "price", "maxLandedCost", "rating", "reviews", "unhappyBuyers",
      "monthlySold", "weightG", "improvability", "why", "mainRisk",
      "listingGaps", "amazonUrl",
    ];
    const cell = (v: unknown) => {
      const t = v === null || v === undefined ? "" : String(v);
      // Quote everything and double any quotes inside. Reasons contain commas
      // and the whole file is worthless if one of them shifts a column.
      return `"${t.replace(/"/g, '""')}"`;
    };
    // Computed here rather than reading `shown`, which is declared further
    // down the component.
    const visible = showKilled ? rows : rows.filter((r) => !r.killed_reason);
    const lines = visible.map((r) =>
      [
        r.triage_verdict, r.score, r.asin, r.title, r.brand, r.category,
        r.price, r.max_landed_cost, r.rating, r.review_count, r.unhappy_buyers,
        r.monthly_sold, r.weight_grams, r.triage_improvability,
        r.triage_because, r.triage_main_risk, r.listing_weaknesses,
        `https://www.amazon.co.uk/dp/${r.asin}`,
      ].map(cell).join(","),
    );
    const csv = [cols.join(","), ...lines].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `claudinho-shortlist-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const [open, setOpen] = useState<string | null>(null);

  /**
   * The deep look, on one product, when the sentence is not enough.
   *
   * Deliberately a button. It costs about 10p and takes over a minute, so
   * running it on everything would be paying for opinions nobody reads —
   * which is the whole reason triage exists in front of it.
   */
  async function goDeeper(asin: string) {
    setDeepening(asin);
    setError("");
    try {
      const response = await fetch("/api/judge/candidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asin }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "The deep judgement failed");
        return;
      }
      setOpen(asin);
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setDeepening(null);
    }
  }

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
          <br />
          <br />
          The one-line reason is the summary, not the ceiling.{" "}
          <strong className="font-medium">Go deeper</strong> spends about 10p
          and a minute on the full analysis: who buys it, what specifically you
          would do differently, why nobody has already, and what would sink it.
          A button rather than a stage, because running it on everything means
          paying for opinions nobody reads.
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
          <button
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="ml-auto rounded border border-zinc-400 px-3 py-1 text-xs font-medium text-zinc-800 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200"
          >
            Export CSV
          </button>
          <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
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

                {r.judge_summary && (
                  <div className="mt-3 rounded border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                        The deep look
                        {r.judge_verdict && r.judge_verdict !== r.triage_verdict && (
                          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                            disagrees with triage: {r.judge_verdict}
                          </span>
                        )}
                      </span>
                      <button
                        onClick={() => setOpen(open === r.asin ? null : r.asin)}
                        className="text-xs text-zinc-500 underline"
                      >
                        {open === r.asin ? "less" : "everything it said"}
                      </button>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-zinc-800 dark:text-zinc-200">
                      {r.judge_summary}
                    </p>

                    {open === r.asin && r.judge_json && (
                      <div className="mt-3 space-y-3 border-t border-zinc-200 pt-3 text-sm leading-6 dark:border-zinc-800">
                        {r.judge_json.specificFix && (
                          <p className="text-emerald-800 dark:text-emerald-400">
                            <strong className="font-medium">What you would do differently:</strong>{" "}
                            {r.judge_json.specificFix}
                          </p>
                        )}
                        {r.judge_json.whyHasntSomeoneFixedIt && (
                          <p className="text-zinc-800 dark:text-zinc-200">
                            <strong className="font-medium">
                              Why nobody has already:
                            </strong>{" "}
                            {r.judge_json.whyHasntSomeoneFixedIt}
                          </p>
                        )}
                        {r.judge_json.targetBuyer?.who && (
                          <p className="text-zinc-800 dark:text-zinc-200">
                            <strong className="font-medium">Who buys it:</strong>{" "}
                            {r.judge_json.targetBuyer.who}
                            {r.judge_json.targetBuyer.reasoning
                              ? ` — ${r.judge_json.targetBuyer.reasoning}`
                              : ""}
                          </p>
                        )}
                        {["improvability", "marketability"].map((section) => {
                          const block = r.judge_json?.[
                            section as "improvability" | "marketability"
                          ];
                          if (!block) return null;
                          return (
                            <div key={section}>
                              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                                {section}
                              </p>
                              <ul className="mt-1 space-y-1">
                                {Object.entries(block).map(([k, v]) => (
                                  <li key={k} className="text-zinc-700 dark:text-zinc-300">
                                    <strong className="font-medium">
                                      {k} {v?.score !== undefined ? `${v.score}/5` : ""}
                                    </strong>
                                    {v?.reasoning ? ` — ${v.reasoning}` : ""}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          );
                        })}
                        {(r.judge_json.concerns ?? []).length > 0 && (
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                              What would sink it
                            </p>
                            <ul className="mt-1 list-disc space-y-1 pl-5">
                              {(r.judge_json.concerns ?? []).map((c) => (
                                <li key={c} className="text-amber-800 dark:text-amber-400">
                                  {c}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {r.judge_missing && (
                          <p className="text-xs leading-5 text-zinc-500">
                            <strong className="font-medium">
                              It did not have:
                            </strong>{" "}
                            {r.judge_missing}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                  {r.promoted_product_id ? (
                    <span className="rounded bg-emerald-100 px-2.5 py-1 font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                      On the products board
                    </span>
                  ) : (
                    <button
                      onClick={() => void promote(r.asin)}
                      disabled={promoting !== null}
                      className="rounded bg-black px-2.5 py-1 font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-black"
                    >
                      {promoting === r.asin ? "Promoting…" : "Promote to product"}
                    </button>
                  )}
                  {!r.judge_summary && (
                    <button
                      onClick={() => void goDeeper(r.asin)}
                      disabled={deepening !== null}
                      className="rounded border border-zinc-400 px-2.5 py-1 font-medium text-zinc-800 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200"
                    >
                      {deepening === r.asin ? "Thinking, about a minute…" : "Go deeper (~10p)"}
                    </button>
                  )}
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
