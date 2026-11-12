"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * /niche — is there room on this shelf, and what would you put on it.
 *
 * Built as a page rather than an endpoint because the endpoint was useless:
 * everything here sits behind a password, so an API route with no screen is
 * something only a developer can reach. The point of this tool is that Oscar
 * can run it.
 *
 * Takes either a list of ASINs he already believes are the competition, or a
 * Keepa category id. The arithmetic runs first and free, and a category that
 * plainly has an owner is answered without spending anything.
 */

const BAND = {
  open: { bg: "#E9F4EC", line: "#BEDCC7", ink: "#2F6B4F", says: "There is room here" },
  contested: { bg: "#FCEFDF", line: "#EBD2AE", ink: "#8A5A16", says: "Room, but you would be fighting for it" },
  crowded: { bg: "#FBEAE7", line: "#EFCCC5", ink: "#8B3128", says: "This shelf has an owner" },
} as const;

type Picture = {
  listings: number;
  leaderShare: number;
  concentration: number;
  medianPrice: number | null;
  priceSpread: number | null;
  medianRating: number | null;
  unhappyListings: number;
  totalReviews: number;
  withAplus: number;
  withVideo: number;
  thinImagery: number;
  room: keyof typeof BAND;
  why: string[];
};

type Verdict = {
  room: "yes" | "narrow" | "no";
  verdict: string;
  gaps: string[];
  differentiation: { position: string; product: string; listing: string; proof: string };
  whoFightsBack: string;
  ifThisIsWrong: string;
};

export default function NichePage() {
  const [niche, setNiche] = useState("");
  const [asins, setAsins] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [arithmeticOnly, setArithmeticOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [picture, setPicture] = useState<Picture | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [note, setNote] = useState("");

  async function run(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setPicture(null);
    setVerdict(null);
    setNote("");
    try {
      const response = await fetch("/api/niche", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          niche: niche.trim() || undefined,
          // Splitting on anything non-alphanumeric means pasted Amazon links
          // work as well as bare ASINs, same as the sweep page.
          asins: asins
            .toUpperCase()
            .split(/[^A-Z0-9]+/)
            .filter((a) => /^[A-Z0-9]{10}$/.test(a)),
          categoryId: categoryId.trim() ? Number(categoryId.trim()) : undefined,
          arithmeticOnly,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "That did not work.");
        if (data.picture) setPicture(data.picture);
        return;
      }
      setPicture(data.picture);
      setVerdict(data.verdict);
      setNote(data.note ?? "");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  const band = picture ? BAND[picture.room] : null;

  return (
    <div className="flex flex-1 flex-col bg-white dark:bg-black">
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-12 sm:px-10">
        <h1 className="display text-5xl leading-none text-black dark:text-zinc-50">
          Is there room here
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
          Everything else in this tool asks whether one listing can be beaten.
          This asks whether the shelf has space on it, because a beatable
          listing in a category one brand owns is not an opening, it is a fight
          you have funded. The arithmetic runs first and costs nothing. A
          category that plainly has an owner is answered without spending.
        </p>

        <form onSubmit={run} className="mt-8 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              What is it, in your words
            </span>
            <input
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              placeholder="dog drying towels"
              className="rounded-xl border border-zinc-300 px-4 py-3 text-base dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              The competition
            </span>
            <textarea
              value={asins}
              onChange={(e) => setAsins(e.target.value)}
              rows={4}
              placeholder="Paste four or more ASINs, or Amazon links, one per line"
              className="rounded-xl border border-zinc-300 px-4 py-3 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
            <span className="text-xs text-zinc-500">
              Four at minimum, twenty at most. Paste the first page of results
              for the search a buyer would actually type.
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                Or a Keepa category id
              </span>
              <input
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                placeholder="optional"
                className="w-48 rounded-xl border border-zinc-300 px-4 py-3 text-base dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>

            <label className="mt-6 flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
              <input
                type="checkbox"
                checked={arithmeticOnly}
                onChange={(e) => setArithmeticOnly(e.target.checked)}
              />
              Arithmetic only, spend nothing
            </label>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="rounded-full bg-black px-8 py-3.5 text-base font-semibold text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-black"
            >
              {loading ? "Reading the field…" : "Read the field"}
            </button>
          </div>
        </form>

        {error && (
          <p className="mt-6 rounded-xl border border-red-300 bg-red-50 p-4 text-sm leading-6 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
            {error}
          </p>
        )}

        {picture && band && (
          <section
            className="mt-8 rounded-2xl p-7"
            style={{ background: band.bg, border: `1px solid ${band.line}` }}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="display text-3xl" style={{ color: band.ink }}>
                {band.says}
              </h2>
              <span className="text-xs uppercase tracking-wider text-zinc-600">
                {picture.listings} listings · {picture.totalReviews.toLocaleString("en-GB")} reviews
              </span>
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
              {[
                ["Biggest brand holds", `${Math.round(picture.leaderShare * 100)}%`],
                ["Median rating", picture.medianRating ?? "—"],
                ["Under 4.3", `${picture.unhappyListings} of ${picture.listings}`],
                ["Median price", picture.medianPrice ? `£${picture.medianPrice.toFixed(2)}` : "—"],
                ["With A+ content", `${picture.withAplus} of ${picture.listings}`],
                ["With video", `${picture.withVideo} of ${picture.listings}`],
                ["Under 5 images", `${picture.thinImagery} of ${picture.listings}`],
                ["Price spread", picture.priceSpread ? `£${picture.priceSpread.toFixed(2)}` : "—"],
              ].map(([k, v]) => (
                <div key={String(k)}>
                  <dt className="text-[11px] uppercase tracking-wide text-zinc-600">{k}</dt>
                  <dd className="mt-0.5 text-lg font-semibold text-zinc-900">{String(v)}</dd>
                </div>
              ))}
            </dl>

            {picture.why.length > 0 && (
              <ul className="mt-5 space-y-2 border-t pt-4" style={{ borderColor: band.line }}>
                {picture.why.map((w) => (
                  <li key={w} className="text-sm leading-6 text-zinc-800">
                    {w}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {note && <p className="mt-4 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{note}</p>}

        {verdict && (
          <section className="mt-6 flex flex-col gap-5">
            <div className="rounded-2xl border border-zinc-200 p-7 dark:border-zinc-800">
              <p className="display text-2xl leading-snug text-black dark:text-zinc-100">
                {verdict.verdict}
              </p>
            </div>

            {verdict.gaps.length > 0 && (
              <div className="rounded-2xl border border-zinc-200 p-7 dark:border-zinc-800">
                <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">
                  What the whole field is failing to do
                </h3>
                <ul className="mt-3 space-y-2">
                  {verdict.gaps.map((g) => (
                    <li key={g} className="text-base leading-7 text-zinc-800 dark:text-zinc-200">
                      {g}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              {[
                ["The position", verdict.differentiation.position],
                ["The product change that makes it true", verdict.differentiation.product],
                ["What the listing does differently", verdict.differentiation.listing],
                ["The proof a sceptic needs", verdict.differentiation.proof],
              ].map(([k, v]) => (
                <div key={String(k)} className="rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">
                    {k}
                  </h3>
                  <p className="mt-2 text-base leading-7 text-zinc-800 dark:text-zinc-200">{v}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div
                className="rounded-2xl p-6"
                style={{ background: BAND.contested.bg, border: `1px solid ${BAND.contested.line}` }}
              >
                <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-600">
                  Who fights back
                </h3>
                <p className="mt-2 text-base leading-7 text-zinc-800">{verdict.whoFightsBack}</p>
              </div>
              <div
                className="rounded-2xl p-6"
                style={{ background: BAND.crowded.bg, border: `1px solid ${BAND.crowded.line}` }}
              >
                <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-600">
                  What would make this wrong
                </h3>
                <p className="mt-2 text-base leading-7 text-zinc-800">{verdict.ifThisIsWrong}</p>
              </div>
            </div>
          </section>
        )}

        <p className="mt-10 text-sm text-zinc-500">
          <Link href="/shortlist" className="underline">
            Back to the shortlist
          </Link>
        </p>
      </main>
    </div>
  );
}
