"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * Amazon UK root category ids as Keepa numbers them. These are from memory,
 * not from a verified fetch — if a search returns nothing for one category but
 * works for another, suspect the id before you suspect the filters.
 */
const CATEGORIES: { id: number; label: string }[] = [
  { id: 0, label: "Any category" },
  { id: 11052591, label: "Home & Kitchen" },
  { id: 60032031, label: "Garden & Outdoors" },
  { id: 468294, label: "Sports & Outdoors" },
  { id: 11052681, label: "Kitchen & Home appliances" },
  { id: 60040031, label: "Handmade" },
  { id: 11052651, label: "Toys & Games" },
  { id: 66280031, label: "Pet Supplies" },
  { id: 3760911, label: "Office Products" },
  { id: 11052721, label: "Baby" },
  { id: 2844434031, label: "Beauty" },
  { id: 11052901, label: "Health & Personal Care" },
];

type Candidate = {
  asin: string;
  title: string | null;
  brand: string | null;
  price: number | null;
  salesRank: number | null;
  reviewCount: number | null;
  rating: number | null;
  sellers: number | null;
  rankDrops90: number | null;
  outOfStock90: number | null;
  packageWeightG: number | null;
  unhappyBuyers: number | null;
};

const DEFAULTS = {
  categoryId: 11052591,
  minPrice: 12,
  maxPrice: 35,
  minRank: 3000,
  maxRank: 100000,
  minReviewCount: 200,
  maxRating: 4.3,
  minSellerCount: 1,
  maxSellerCount: 15,
  limit: 25,
};

const num = (v: string) => (v === "" ? undefined : Number(v));

export default function ScoutPage() {
  const [form, setForm] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(DEFAULTS).map(([k, v]) => [k, String(v)])),
  );
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [note, setNote] = useState("");
  const [tokensLeft, setTokensLeft] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState<keyof Candidate>("unhappyBuyers");

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function search() {
    setLoading(true);
    setError("");
    setNote("");
    setCandidates(null);
    try {
      const body = Object.fromEntries(
        Object.entries(form)
          .map(([k, v]) => [k, num(v)])
          .filter(([, v]) => v !== undefined),
      );
      if (body.categoryId === 0) delete body.categoryId;

      const response = await fetch("/api/keepa/scout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Search failed");
        return;
      }
      setCandidates(data.candidates ?? []);
      setNote(data.note ?? "");
      setTokensLeft(data.tokensLeft ?? null);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  const sorted = candidates
    ? [...candidates].sort((a, b) => {
        const x = a[sortBy];
        const y = b[sortBy];
        if (typeof x !== "number") return 1;
        if (typeof y !== "number") return -1;
        return y - x;
      })
    : null;

  const field = (key: string, label: string, hint?: string, step = "1") => (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
      <input
        type="number"
        step={step}
        value={form[key] ?? ""}
        onChange={(e) => set(key, e.target.value)}
        className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />
      {hint && <span className="text-[11px] leading-4 text-zinc-500">{hint}</span>}
    </label>
  );

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
          Scout
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Everything else here judges a product you already found. This one looks
          for products you have not. The defaults look for proven demand and
          failed execution: above the £12 floor, enough reviews to show people
          already spend money here, and a rating low enough to show they are
          not happy about it. You do not need to beat the leader, only to be
          the better option for a slice of the people already buying.
        </p>

        <div className="mt-6 rounded border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Category
            </span>
            <select
              value={form.categoryId}
              onChange={(e) => set("categoryId", e.target.value)}
              className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {field("minPrice", "Min price £", "Your £12 kill switch")}
            {field("maxPrice", "Max price £", "Above this, buyers research")}
            {field("minRank", "Min sales rank", "Lower number = better selling")}
            {field("maxRank", "Max sales rank", "Beyond this, nothing sells")}
            {field("minReviewCount", "Min reviews", "Proof people already buy here")}
            {field("maxRating", "Max rating", "Where the opening is", "0.1")}
            {field("minSellerCount", "Min sellers")}
            {field("maxSellerCount", "Max sellers", "Many sellers = price war")}
            {field("limit", "Results", "Max 25. Searches cost tokens")}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              onClick={() => void search()}
              disabled={loading}
              className="rounded bg-black px-5 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-black"
            >
              {loading ? "Searching…" : "Search"}
            </button>
            <button
              onClick={() =>
                setForm(
                  Object.fromEntries(
                    Object.entries(DEFAULTS).map(([k, v]) => [k, String(v)]),
                  ),
                )
              }
              className="text-xs text-zinc-500 underline"
            >
              Reset to the rubric
            </button>
            {tokensLeft !== null && (
              <span className="ml-auto font-mono text-xs text-zinc-500">
                {tokensLeft} Keepa tokens left
              </span>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-5 rounded border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
            <p className="font-medium">Search failed</p>
            <p className="mt-1 leading-6">{error}</p>
          </div>
        )}

        {note && (
          <p className="mt-5 rounded border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            {note}
          </p>
        )}

        {sorted && sorted.length > 0 && (
          <>
            <div className="mt-8 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-lg font-semibold text-black dark:text-zinc-100">
                {sorted.length} candidates
              </h2>
              <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                Sort by
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as keyof Candidate)}
                  className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                >
                  <option value="unhappyBuyers">Unhappy buyers</option>
                  <option value="rankDrops90">Sales in 90 days</option>
                  <option value="price">Price</option>
                  <option value="reviewCount">Reviews (most first)</option>
                  <option value="sellers">Sellers</option>
                  <option value="outOfStock90">Out of stock %</option>
                </select>
              </label>
            </div>

            <p className="mt-2 text-xs leading-5 text-zinc-500">
              <strong className="font-medium">Unhappy buyers</strong> is review
              count multiplied by the shortfall against a 4.5 rating. It is a
              rough count of people who have already proved they will spend
              money on this and were let down. Rank drops are the nearest thing
              Keepa gives to a sales count, roughly one drop per unit sold.
            </p>

            <div className="mt-4 overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
              <table className="w-full min-w-[860px] border-collapse text-sm">
                <thead className="bg-zinc-100 text-left text-xs uppercase tracking-wide text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Product</th>
                    <th className="px-3 py-2 text-right font-medium">Price</th>
                    <th className="px-3 py-2 text-right font-medium">Rank</th>
                    <th className="px-3 py-2 text-right font-medium">Sales/90d</th>
                    <th className="px-3 py-2 text-right font-medium">Unhappy</th>
                    <th className="px-3 py-2 text-right font-medium">Reviews</th>
                    <th className="px-3 py-2 text-right font-medium">Rating</th>
                    <th className="px-3 py-2 text-right font-medium">Sellers</th>
                    <th className="px-3 py-2 text-right font-medium">Weight</th>
                    <th className="px-3 py-2 font-medium">Next</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {sorted.map((c) => (
                    <tr key={c.asin} className="align-top">
                      <td className="max-w-xs px-3 py-2">
                        <a
                          href={`https://www.amazon.co.uk/dp/${c.asin}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="line-clamp-2 text-black underline dark:text-zinc-100"
                        >
                          {c.title ?? c.asin}
                        </a>
                        <span className="mt-0.5 block font-mono text-[11px] text-zinc-500">
                          {c.asin}
                          {c.brand ? ` · ${c.brand}` : ""}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {c.price === null ? "—" : `£${c.price.toFixed(2)}`}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                        {c.salesRank?.toLocaleString("en-GB") ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {c.rankDrops90?.toLocaleString("en-GB") ?? "—"}
                      </td>
                      <td
                        className="px-3 py-2 text-right font-medium tabular-nums text-emerald-700 dark:text-emerald-400"
                        title="Reviews × the shortfall against 4.5 stars. Roughly how many buyers this product has already let down."
                      >
                        {c.unhappyBuyers?.toLocaleString("en-GB") ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                        {c.reviewCount?.toLocaleString("en-GB") ?? "—"}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          c.rating !== null && c.rating < 4.2
                            ? "font-medium text-emerald-700 dark:text-emerald-400"
                            : "text-zinc-600 dark:text-zinc-400"
                        }`}
                        title={
                          c.rating !== null && c.rating < 4.2
                            ? "Below 4.2 — people are buying it and not liking it. That is the opening."
                            : undefined
                        }
                      >
                        {c.rating?.toFixed(1) ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                        {c.sellers ?? "—"}
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

            <p className="mt-4 text-xs leading-5 text-zinc-500">
              The scout does not judge. It narrows. Run the promising ones
              through the margin engine first, because that kills fastest and
              costs nothing, then judge the survivors.
              <br />
              <br />
              One caution on the big listings. In a category with a
              10,000-review incumbent, the thing that kills you is not their
              reviews, it is what a click costs. You bid for the same keywords
              against sellers with real budgets, so model the advertising line
              higher than feels right before committing stock.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
