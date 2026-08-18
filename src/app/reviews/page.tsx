"use client";

import { useState } from "react";
import Link from "next/link";

type Analysis = {
  complaints: string[];
  wishedFor: string[];
  fixable: string[];
  notFixable: string[];
  opportunityScore: number;
  summary: string;
};

/**
 * The collector.
 *
 * Amazon blocks servers reading reviews, but not a browser reading a page it
 * is already on. This runs in Oscar's own tab, pulls the review text out of
 * the DOM and puts it on the clipboard. No scraping infrastructure, no proxy
 * subscription, no credentials anywhere.
 *
 * Written as one line because a bookmarklet has to be.
 */
const BOOKMARKLET = `javascript:(function(){var r=document.querySelectorAll('[data-hook="review"]');if(!r.length){alert('No reviews found. Make sure you are on the reviews page, not the product page.');return;}var o=[];r.forEach(function(x){var s=x.querySelector('[data-hook="review-star-rating"],[data-hook="cmps-review-star-rating"]');var t=x.querySelector('[data-hook="review-title"]');var b=x.querySelector('[data-hook="review-body"]');o.push((s?s.innerText.trim().split('\\n')[0]:'')+' | '+(t?t.innerText.trim().split('\\n').pop():'')+'\\n'+(b?b.innerText.trim():''));});var out=o.join('\\n\\n---\\n\\n');navigator.clipboard.writeText(out).then(function(){alert('Copied '+r.length+' reviews. Paste them into Project Claudinho.');},function(){var w=window.open('','_blank');w.document.write('<pre>'+out.replace(/</g,'&lt;')+'</pre>');});})();`;

export default function ReviewsPage() {
  const [asin, setAsin] = useState("");
  const [productName, setProductName] = useState("");
  const [starFilter, setStarFilter] = useState("3 star");
  const [rawText, setRawText] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function analyse() {
    setLoading(true);
    setError("");
    setAnalysis(null);
    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asin,
          productName,
          starFilter,
          rawText,
          reviewCount: rawText.split("---").length,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Could not analyse those reviews.");
        return;
      }
      setAnalysis(data.analysis);
      setCost(data.cost?.costPence ?? null);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  const list = (items: string[], tone: string) => (
    <ul className="mt-1 space-y-1">
      {items.map((item) => (
        <li key={item} className={`text-sm leading-6 ${tone}`}>
          {item}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-3xl flex-1 px-6 py-14 sm:px-10">
        <Link
          href="/"
          className="font-mono text-xs uppercase tracking-widest text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
        >
          ← Project Claudinho
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Reviews
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          A rating of 3.9 tells you people are unhappy. Only the words tell you
          what about, and whether it is something you could fix. This sorts
          complaints into the ones a better supplier brief would solve and the
          ones inherent to the product, because only the first kind is an
          opening.
        </p>

        <div className="mt-6 rounded border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="text-sm font-medium text-black dark:text-zinc-100">
            Getting the reviews out of Amazon
          </h2>
          <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Amazon blocks servers from reading reviews, so the app cannot fetch
            them. Your own browser reading a page you are already on is a
            different matter. Drag this to your bookmarks bar once:
          </p>
          <a
            href={BOOKMARKLET}
            onClick={(e) => e.preventDefault()}
            className="mt-3 inline-block cursor-grab rounded border border-zinc-400 bg-zinc-100 px-4 py-2 text-sm font-medium text-black dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
          >
            Grab reviews
          </a>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(BOOKMARKLET);
              setCopied(true);
            }}
            className="ml-3 text-xs text-zinc-500 underline"
          >
            {copied ? "Copied — make a bookmark and paste this as the URL" : "Or copy the code"}
          </button>
          <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
            <li>Open the product on Amazon and click through to all reviews</li>
            <li>
              Filter to <strong className="font-medium">3 star</strong>. One-star
              reviews are mostly delivery complaints and five-star ones say
              little. Three stars is someone who wanted to like it
            </li>
            <li>Click the bookmarklet. It copies the reviews</li>
            <li>Paste below</li>
          </ol>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
              ASIN
            </span>
            <input
              value={asin}
              onChange={(e) => setAsin(e.target.value.toUpperCase())}
              placeholder="B0FDS8Q4XJ"
              className="rounded border border-zinc-300 bg-white px-2 py-1.5 font-mono text-sm text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Product name
            </span>
            <input
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Which stars
            </span>
            <select
              value={starFilter}
              onChange={(e) => setStarFilter(e.target.value)}
              className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              <option>3 star</option>
              <option>2 star</option>
              <option>1 star</option>
              <option>4 star</option>
              <option>all</option>
            </select>
          </label>
        </div>

        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          rows={10}
          placeholder="Paste the reviews here…"
          className="mt-4 w-full rounded border border-zinc-300 bg-white p-3 font-mono text-xs text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={() => void analyse()}
            disabled={loading || rawText.trim().length < 200}
            className="rounded bg-black px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-black"
          >
            {loading ? "Reading…" : "Read the reviews (about 1p)"}
          </button>
          <span className="text-xs text-zinc-500">
            {rawText.trim().length.toLocaleString("en-GB")} characters pasted
          </span>
          {cost !== null && (
            <span className="ml-auto font-mono text-xs text-zinc-500">
              cost {cost}p
            </span>
          )}
        </div>

        {error && (
          <p className="mt-5 rounded border border-red-300 bg-red-50 p-4 text-sm leading-6 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
            {error}
          </p>
        )}

        {analysis && (
          <div className="mt-8 space-y-6">
            <div className="rounded border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-semibold text-black dark:text-zinc-100">
                  Opportunity
                </h2>
                <span className="text-2xl font-semibold tabular-nums text-black dark:text-zinc-100">
                  {analysis.opportunityScore}/10
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
                {analysis.summary}
              </p>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <h3 className="text-sm font-medium text-emerald-800 dark:text-emerald-400">
                  You could fix these
                </h3>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Supplier-brief problems. This is the opening.
                </p>
                {list(analysis.fixable, "text-emerald-800 dark:text-emerald-400")}
              </div>
              <div>
                <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  You could not
                </h3>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Inherent to the product. A long list here is a warning.
                </p>
                {list(analysis.notFixable, "text-zinc-600 dark:text-zinc-400")}
              </div>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <h3 className="text-sm font-medium text-black dark:text-zinc-100">
                  What they complain about
                </h3>
                {list(analysis.complaints, "text-zinc-700 dark:text-zinc-300")}
              </div>
              <div>
                <h3 className="text-sm font-medium text-black dark:text-zinc-100">
                  What they wish it had
                </h3>
                {list(analysis.wishedFor, "text-zinc-700 dark:text-zinc-300")}
              </div>
            </div>

            <p className="text-xs leading-5 text-zinc-500">
              Saved against {asin}, raw text included, so this can be re-read
              later against a better prompt without going back to Amazon.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
