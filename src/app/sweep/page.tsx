"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { DEFAULT_WEIGHTS, type Weights } from "@/lib/score";

const WEIGHT_LABELS: Record<string, string> = {
  unhappyBuyers: "Unhappy buyers",
  listingWeakness: "Listing weakness",
  marginHeadroom: "Margin headroom",
  velocity: "Sales velocity",
  priceBand: "Price in band",
  weight: "Light to ship",
  ratingRoom: "Room to improve",
  sellers: "Few competitors",
  usGrowing: "Growing in the US",
};

const STORAGE_KEY = "claudinho-sweep-weights";

type Candidate = {
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
  listingWeaknesses: string[];
  us: {
    price: number | null;
    monthlySold: number | null;
    salesRank: number | null;
    growing: boolean | null;
  } | null;
  flags: string[];
  killed: string | null;
  aiVerdict?: "TEST" | "PARK" | "KILL" | null;
  aiReason?: string;
  aiImprovability?: number;
  aiRisk?: string;
  score: {
    total: number;
    coverage: number;
    strengths: string[];
    weaknesses: string[];
    criteria: {
      key: string;
      label: string;
      score: number | null;
      weight: number;
      explain: string;
    }[];
  } | null;
};

export default function SweepPage() {
  const [log, setLog] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [summary, setSummary] = useState<{
    scanned: number;
    clean: number;
    usGrowing: number;
  } | null>(null);
  const [tokensLeft, setTokensLeft] = useState<number | null>(null);
  const [halted, setHalted] = useState("");
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [onlyClean, setOnlyClean] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [seeds, setSeeds] = useState("");
  const [triaging, setTriaging] = useState(false);
  const [triageCost, setTriageCost] = useState<number | null>(null);
  const [triageProgress, setTriageProgress] = useState(0);

  /**
   * The second tier. The sweep's own verdict is arithmetic and free but blind:
   * it knows the numbers fit the shape, not whether the product is any good.
   * This spends about 0.2p each asking that question properly, and only on the
   * ones the arithmetic did not already kill — paying to confirm a no is the
   * one thing worth avoiding here.
   */
  async function triageAll() {
    if (!candidates) return;
    const worthAsking = candidates.filter((c) => !c.killed);
    if (worthAsking.length === 0) return;

    setTriaging(true);
    setTriageProgress(0);
    setError("");

    try {
      const response = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidates: worthAsking }),
      });
      if (!response.body) {
        setError("No response from the server.");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }

          if (event.type === "result") {
            const t = event.triage as
              | { verdict: "TEST" | "PARK" | "KILL"; reason: string; improvability: number; mainRisk: string }
              | undefined;
            setTriageProgress((n) => n + 1);
            setCandidates((prev) =>
              prev
                ? prev.map((c) =>
                    c.asin === event.asin
                      ? {
                          ...c,
                          aiVerdict: t?.verdict ?? null,
                          aiReason: t?.reason ?? (event.error as string) ?? "",
                          aiImprovability: t?.improvability,
                          aiRisk: t?.mainRisk,
                        }
                      : c,
                  )
                : prev,
            );
          } else if (event.type === "done") {
            setTriageCost(event.totalPence as number);
          } else if (event.type === "error") {
            setError(String(event.error));
          }
        }
      }
    } catch {
      setError("Lost the connection during triage.");
    } finally {
      setTriaging(false);
    }
  }
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [showWeights, setShowWeights] = useState(false);
  const logEnd = useRef<HTMLDivElement>(null);

  /**
   * Read on demand rather than on mount. localStorage does not exist while the
   * page is rendered on the server, so loading it in an effect means the first
   * paint shows defaults and then swaps — and React now flags that as a
   * cascading render. Reading at the two moments the values are actually
   * needed avoids both problems.
   */
  function savedWeights(): Weights {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? { ...DEFAULT_WEIGHTS, ...JSON.parse(saved) } : DEFAULT_WEIGHTS;
    } catch {
      // A corrupted value is not worth failing over; the defaults are fine.
      return DEFAULT_WEIGHTS;
    }
  }

  function setWeight(key: string, value: number) {
    setWeights((w) => {
      const next = { ...w, [key]: value };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function run() {
    setRunning(true);
    setLog([]);
    setCandidates(null);
    setSummary(null);
    setHalted("");
    setError("");

    try {
      const response = await fetch("/api/keepa/sweep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weights: savedWeights(),
          // Splitting on anything that is not alphanumeric means a pasted
          // Amazon URL works as well as a bare ASIN.
          seedAsins: seeds
            .toUpperCase()
            .split(/[^A-Z0-9]+/)
            .filter((s) => /^[A-Z0-9]{10}$/.test(s)),
        }),
      });

      if (!response.body) {
        setError("No response from the server.");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }

          if (event.type === "start") {
            setLog((l) => [...l, `Sweeping ${event.categories} categories…`]);
          } else if (event.type === "seeded") {
            const found = (event.categories as { name: string }[]) ?? [];
            setLog((l) => [
              ...l,
              `Reading categories from your seeds: ${found.map((c) => c.name).join(", ")}`,
            ]);
          } else if (event.type === "progress") {
            setLog((l) => [...l, `${event.category}…`]);
          } else if (event.type === "category") {
            const note = event.error
              ? `failed: ${event.error}`
              : `${event.found} candidates`;
            setLog((l) => [...l.slice(0, -1), `${event.category} — ${note}`]);
            if (typeof event.tokensLeft === "number") setTokensLeft(event.tokensLeft);
          } else if (event.type === "halted") {
            setHalted(String(event.reason));
          } else if (event.type === "error") {
            setError(String(event.error));
          } else if (event.type === "done") {
            setCandidates(event.candidates as Candidate[]);
            setSummary({
              scanned: event.scanned as number,
              clean: event.clean as number,
              usGrowing: (event.usGrowing as number) ?? 0,
            });
            if (typeof event.tokensLeft === "number") setTokensLeft(event.tokensLeft);
          }
          logEnd.current?.scrollIntoView({ behavior: "smooth" });
        }
      }
    } catch {
      setError("Lost the connection to the server mid-sweep.");
    } finally {
      setRunning(false);
    }
  }

  const shown = candidates
    ? onlyClean
      ? candidates.filter((c) => !c.killed)
      : candidates
    : null;

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-6xl flex-1 px-6 py-14 sm:px-10">
        <Link
          href="/"
          className="font-mono text-xs uppercase tracking-widest text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
        >
          ← Project Claudinho
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Sweep
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          The Scout run without supervision. It walks ten categories on the same
          rules, pools everything it finds, drops duplicates and ranks what is
          left. No inputs, because guessing which category to try was the actual
          work, not typing the numbers. The strongest survivors then get looked
          up on Amazon US, since something growing there and quiet here is the
          clearest opening you can get.
        </p>

        <div className="mt-6 rounded border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-black dark:text-zinc-100">
              Seed it with products you already like
            </span>
            <span className="mb-1 text-xs leading-5 text-zinc-500">
              Paste one or more ASINs, or whole Amazon links. The sweep reads
              the category Amazon has actually filed each one under and searches
              there. This is the reliable path: the built-in category list was
              written from memory and one of the ids has already been proved
              wrong, so without a seed the sweep may find nothing.
            </span>
            <input
              value={seeds}
              onChange={(e) => setSeeds(e.target.value)}
              placeholder="B0FDS8Q4XJ, or https://www.amazon.co.uk/dp/B0FDS8Q4XJ"
              className="rounded border border-zinc-300 bg-white px-2 py-1.5 font-mono text-sm text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <button
            onClick={() => void run()}
            disabled={running}
            className="rounded bg-black px-6 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-black"
          >
            {running
              ? "Sweeping…"
              : seeds.trim()
                ? "Sweep these categories"
                : "Run the sweep"}
          </button>
          <button
            onClick={() => {
              if (!showWeights) setWeights(savedWeights());
              setShowWeights((v) => !v);
            }}
            className="text-xs text-zinc-600 underline dark:text-zinc-400"
          >
            {showWeights ? "Hide priorities" : "Adjust priorities"}
          </button>
          <Link href="/scout" className="text-xs text-zinc-500 underline">
            Filter by hand instead
          </Link>
          {tokensLeft !== null && (
            <span className="ml-auto font-mono text-xs text-zinc-500">
              {tokensLeft} Keepa tokens left
            </span>
          )}
        </div>

        {showWeights && (
          <div className="mt-5 rounded border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-sm font-medium text-black dark:text-zinc-100">
              What matters, and how much
            </p>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-500">
              Nothing here excludes a product. A candidate that falls short on
              one of these can still come top if it is strong on the rest, which
              is the whole reason these are weights rather than filters. Set one
              to zero to ignore it completely.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Object.keys(DEFAULT_WEIGHTS).map((key) => (
                <label key={key} className="flex flex-col gap-1">
                  <span className="flex items-baseline justify-between text-xs text-zinc-700 dark:text-zinc-300">
                    {WEIGHT_LABELS[key] ?? key}
                    <span className="font-mono text-zinc-500">{weights[key] ?? 0}</span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={30}
                    value={weights[key] ?? 0}
                    onChange={(e) => setWeight(key, Number(e.target.value))}
                    className="accent-black dark:accent-zinc-100"
                  />
                </label>
              ))}
            </div>
            <button
              onClick={() => {
                setWeights(DEFAULT_WEIGHTS);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_WEIGHTS));
              }}
              className="mt-4 text-xs text-zinc-500 underline"
            >
              Back to the defaults
            </button>
          </div>
        )}

        {log.length > 0 && (
          <div className="mt-6 max-h-56 overflow-y-auto rounded border border-zinc-200 bg-white p-4 font-mono text-xs leading-6 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
            {log.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
            <div ref={logEnd} />
          </div>
        )}

        {error && (
          <div className="mt-5 rounded border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
            <p className="font-medium">Sweep failed</p>
            <p className="mt-1 leading-6">{error}</p>
          </div>
        )}

        {halted && (
          <p className="mt-5 rounded border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            {halted}
          </p>
        )}

        {shown && summary && (
          <>
            <div className="mt-8 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-lg font-semibold text-black dark:text-zinc-100">
                {summary.scanned} scanned, {summary.clean} still standing
                {summary.usGrowing > 0 && (
                  <span className="ml-2 text-sm font-normal text-emerald-700 dark:text-emerald-400">
                    {summary.usGrowing} growing in the US
                  </span>
                )}
              </h2>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => void triageAll()}
                  disabled={triaging}
                  className="rounded border border-zinc-400 px-3 py-1.5 text-xs font-medium text-zinc-800 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200"
                >
                  {triaging
                    ? `Judging ${triageProgress}…`
                    : `Judge the survivors (about ${(shown.filter((c) => !c.killed).length * 0.2).toFixed(1)}p)`}
                </button>
                {triageCost !== null && (
                  <span className="font-mono text-xs text-zinc-500">
                    cost {triageCost}p
                  </span>
                )}
              </div>
              <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={onlyClean}
                  onChange={(e) => setOnlyClean(e.target.checked)}
                />
                Hide the killed ones
              </label>
            </div>

            <p className="mt-2 max-w-3xl text-xs leading-5 text-zinc-500">
              Ranked by score, with anything hard-killed sunk to the bottom
              rather than deleted. The score never stands alone: open
              &quot;Read their listing&quot; for the full breakdown of what
              earned it. Only three things kill outright, and they are the ones
              no strength elsewhere rescues. <strong className="font-medium">Max landed</strong>{" "}
              is the most you could pay to get a unit into a warehouse and still
              clear 15% net, so it is the number to take to a supplier, and it is
              free to work out because it is arithmetic rather than a quote. The
              green lines under a product are weaknesses in the incumbent&apos;s
              own listing: jobs you could do better for the price of an
              afternoon.
            </p>

            {shown.length === 0 ? (
              <p className="mt-6 rounded border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
                Everything found was hard-killed. Untick the box to see them
                and why.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
                <table className="w-full min-w-[980px] border-collapse text-sm">
                  <thead className="bg-zinc-100 text-left text-xs uppercase tracking-wide text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                    <tr>
                      <th className="px-3 py-2 text-right font-medium">Score</th>
                      <th className="px-3 py-2 font-medium">Verdict</th>
                      <th className="px-3 py-2 font-medium">Product</th>
                      <th className="px-3 py-2 text-right font-medium">Price</th>
                      <th className="px-3 py-2 text-right font-medium">Max landed</th>
                      <th className="px-3 py-2 text-right font-medium">Unhappy</th>
                      <th className="px-3 py-2 text-right font-medium">Sold/mo</th>
                      <th className="px-3 py-2 text-right font-medium">Reviews</th>
                      <th className="px-3 py-2 text-right font-medium">Rating</th>
                      <th className="px-3 py-2 font-medium">US</th>
                      <th className="px-3 py-2 text-right font-medium">Weight</th>
                      <th className="px-3 py-2 font-medium">Next</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {shown.map((c) => (
                      <tr key={c.asin} className={`align-top ${c.killed ? "opacity-45" : ""}`}>
                        <td className="px-3 py-2 text-right">
                          <span className="block text-lg font-semibold tabular-nums text-black dark:text-zinc-100">
                            {c.score?.total ?? "—"}
                          </span>
                          {c.score && c.score.coverage < 70 && (
                            <span
                              className="block text-[10px] text-amber-700 dark:text-amber-500"
                              title="Keepa was missing some of the data, so this score rests on less than it should."
                            >
                              {c.score.coverage}% data
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {c.aiVerdict ? (
                            <>
                              <span
                                className={`block text-sm font-semibold ${
                                  c.aiVerdict === "TEST"
                                    ? "text-emerald-700 dark:text-emerald-400"
                                    : c.aiVerdict === "PARK"
                                      ? "text-amber-700 dark:text-amber-500"
                                      : "text-red-700 dark:text-red-400"
                                }`}
                              >
                                {c.aiVerdict}
                              </span>
                              {c.aiImprovability !== undefined && (
                                <span className="block text-[10px] text-zinc-500">
                                  improvability {c.aiImprovability}/10
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-xs text-zinc-400">
                              {c.killed ? "killed" : "—"}
                            </span>
                          )}
                        </td>
                        <td className="max-w-sm px-3 py-2">
                          <a
                            href={`https://www.amazon.co.uk/dp/${c.asin}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="line-clamp-2 text-black underline dark:text-zinc-100"
                          >
                            {c.title ?? c.asin}
                          </a>
                          <span className="mt-0.5 block font-mono text-[11px] text-zinc-500">
                            {c.asin} · {c.category}
                            {c.brand ? ` · ${c.brand}` : ""}
                          </span>
                          {c.killed && (
                            <p className="mt-1 text-[11px] font-medium leading-4 text-red-700 dark:text-red-400">
                              Killed: {c.killed}
                            </p>
                          )}
                          {c.aiReason && (
                            <p className="mt-1 text-[11px] leading-4 text-zinc-700 dark:text-zinc-300">
                              {c.aiReason}
                              {c.aiRisk ? ` Main risk: ${c.aiRisk}` : ""}
                            </p>
                          )}
                          {c.score && c.score.strengths.length > 0 && (
                            <p className="mt-1 text-[11px] leading-4 text-zinc-600 dark:text-zinc-400">
                              {c.score.strengths.join(" · ")}
                            </p>
                          )}
                          {c.flags.length > 0 && (
                            <ul className="mt-1 space-y-0.5">
                              {c.flags.map((f) => (
                                <li
                                  key={f}
                                  className="text-[11px] leading-4 text-amber-700 dark:text-amber-500"
                                >
                                  {f}
                                </li>
                              ))}
                            </ul>
                          )}
                          {c.listingWeaknesses.length > 0 && (
                            <ul className="mt-1 space-y-0.5">
                              {c.listingWeaknesses.map((w) => (
                                <li
                                  key={w}
                                  className="text-[11px] leading-4 text-emerald-700 dark:text-emerald-400"
                                >
                                  ↳ {w}
                                </li>
                              ))}
                            </ul>
                          )}
                          <button
                            onClick={() => setOpen(open === c.asin ? null : c.asin)}
                            className="mt-1 text-[11px] text-zinc-500 underline"
                          >
                            {open === c.asin ? "Hide listing" : "Read their listing"}
                          </button>
                          {open === c.asin && (
                            <div className="mt-2 rounded border border-zinc-200 bg-zinc-50 p-2 text-[11px] leading-5 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                              <p className="font-medium">
                                {c.imageCount} images · {c.features.length} bullets
                              </p>
                              {c.features.length > 0 && (
                                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                                  {c.features.slice(0, 6).map((f, i) => (
                                    <li key={i}>{f}</li>
                                  ))}
                                </ul>
                              )}
                              {c.score && (
                                <table className="mt-2 w-full border-collapse">
                                  <tbody>
                                    {c.score.criteria
                                      .filter((x) => x.weight > 0)
                                      .map((x) => (
                                        <tr key={x.key}>
                                          <td className="py-0.5 pr-2 align-top text-zinc-500">
                                            {x.label}
                                          </td>
                                          <td className="py-0.5 pr-2 text-right align-top font-mono tabular-nums">
                                            {x.score === null
                                              ? "n/a"
                                              : Math.round(x.score * 100)}
                                          </td>
                                          <td className="py-0.5 align-top text-zinc-600 dark:text-zinc-400">
                                            {x.explain}
                                          </td>
                                        </tr>
                                      ))}
                                  </tbody>
                                </table>
                              )}
                              <p className="mt-2">
                                {c.description ?? "No description on the listing."}
                              </p>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {c.price === null ? "—" : `£${c.price.toFixed(2)}`}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                          {c.maxLandedCost === null
                            ? "—"
                            : `£${c.maxLandedCost.toFixed(2)}`}
                        </td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
                          {c.unhappyBuyers?.toLocaleString("en-GB") ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                          {c.monthlySold?.toLocaleString("en-GB") ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                          {c.reviewCount?.toLocaleString("en-GB") ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                          {c.rating?.toFixed(1) ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {c.us === null ? (
                            <span className="text-zinc-400">not checked</span>
                          ) : (
                            <div className="space-y-0.5">
                              {c.us.growing === true && (
                                <span className="block font-medium text-emerald-700 dark:text-emerald-400">
                                  growing
                                </span>
                              )}
                              {c.us.growing === false && (
                                <span className="block text-zinc-500">
                                  flat or falling
                                </span>
                              )}
                              {c.us.monthlySold !== null && (
                                <span className="block text-zinc-600 dark:text-zinc-400">
                                  {c.us.monthlySold.toLocaleString("en-GB")}/mo
                                </span>
                              )}
                              {c.us.price !== null && (
                                <span className="block text-zinc-500">
                                  ${c.us.price.toFixed(2)}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                          {c.packageWeightG ? `${c.packageWeightG}g` : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col gap-0.5 text-xs">
                            <Link href={`/margin?asin=${c.asin}`} className="underline">
                              Margin
                            </Link>
                            <Link href={`/keepa?asin=${c.asin}`} className="underline">
                              Keepa
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="mt-4 max-w-3xl text-xs leading-5 text-zinc-500">
              Three tiers, cheapest first. The score is arithmetic: free, and
              blind to whether the product is any good. Pressing
              <strong className="font-medium"> Judge the survivors</strong>{" "}
              spends about 0.2p each asking that question properly, skipping
              anything already hard-killed, because paying to confirm a no is
              the one thing worth avoiding. Anything that comes back TEST is
              worth the full 11p judgement on the Judge page.
              <br />
              <br />
              One thing it cannot fetch: the words inside the reviews. Keepa
              gives counts and ratings, never the text, and Amazon blocks servers
              that try to read it. So for the handful you shortlist, open the
              listing, read the three-star reviews yourself and paste them into
              the Judge. Three stars is where the useful complaints live, from
              people who wanted to like it.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
