"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ScoutCandidateRow } from "@/lib/stages";
import { viability } from "@/lib/viability";

/**
 * The front door.
 *
 * It was a build-progress checklist with eleven buttons under it, which was
 * right while the thing was being built and wrong the moment it started being
 * used: the first screen said how the tool was made rather than what it had
 * found. Then it was counts and two buttons, which was tidier and still said
 * nothing.
 *
 * So it shows the work. The three products the tool currently believes in are
 * on the page, with the number that ranks them and the most you could pay for
 * one, because that is the answer to the only question worth asking on
 * opening it.
 */

const BANDS = {
  green: { bg: "#E9F4EC", line: "#BEDCC7", ink: "#2F6B4F" },
  orange: { bg: "#FCEFDF", line: "#EBD2AE", ink: "#8A5A16" },
  red: { bg: "#FBEAE7", line: "#EFCCC5", ink: "#8B3128" },
  none: { bg: "transparent", line: "#E4E0D8", ink: "#6A645A" },
} as const;

function bandFor(score: number | null) {
  if (score === null) return BANDS.none;
  if (score >= 61) return BANDS.green;
  if (score >= 50) return BANDS.orange;
  return BANDS.red;
}

function scoreOf(r: ScoutCandidateRow): number | null {
  if (!r.judge_verdict) return null;
  const imp = (r.judge_json as { improvability?: Record<string, { score?: number }> } | null)
    ?.improvability;
  const weighted =
    imp?.marketing && imp?.branding && imp?.product
      ? (((imp.marketing.score ?? 5) + (imp.branding.score ?? 5)) / 2) * 0.6 +
        (imp.product.score ?? 5) * 0.4
      : null;
  return viability({
    asin: r.asin,
    title: r.title,
    category: r.category,
    price: r.price,
    maxLandedCost: r.max_landed_cost,
    unhappyBuyers: r.unhappy_buyers,
    weightGrams: r.weight_grams,
    improvability: weighted ?? r.triage_improvability ?? null,
    hasReviews: Boolean(r.has_reviews),
  }).score;
}

const money = (n: number | null) =>
  n === null || n === undefined ? "—" : `£${Number(n).toFixed(2)}`;

export default function Home() {
  const [rows, setRows] = useState<ScoutCandidateRow[]>([]);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [s, h] = await Promise.all([
        fetch("/api/shortlist").then((r) => r.json()).catch(() => ({})),
        fetch("/api/health").then((r) => r.json()).catch(() => ({})),
      ]);
      if (!live) return;
      setRows((s.rows ?? []) as ScoutCandidateRow[]);
      setHealth((h.pipeline ?? null) as Record<string, unknown> | null);
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, []);

  const top = rows
    .filter((r) => r.judge_verdict === "TEST")
    .map((r) => ({ row: r, score: scoreOf(r) }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 3);

  const q = (health?.qualified ?? {}) as {
    seen?: number;
    judged?: Record<string, number>;
  };
  const judged = q.judged
    ? (q.judged.test ?? 0) + (q.judged.park ?? 0) + (q.judged.kill ?? 0)
    : null;

  return (
    <div className="flex flex-1 flex-col bg-white dark:bg-black">
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-16 sm:px-10">
        <div className="mt-2 flex flex-wrap items-end justify-between gap-x-12 gap-y-8">
          <div className="max-w-2xl">
            <h1 className="display text-5xl leading-[1.02] text-black sm:text-7xl dark:text-zinc-50">
              What is worth
              <br />
              your money
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-8 text-zinc-600 dark:text-zinc-400">
              Products with proven demand that are being sold badly, the most
              you could pay for one, and an argument against it before you spend
              anything.
            </p>
          </div>

          <dl className="flex gap-10">
            {[
              ["Still standing", q.judged?.test ?? null],
              ["Reviewed", judged],
              ["Scanned", q.seen ?? null],
            ].map(([label, value], i) => (
              <div key={String(label)}>
                <dd
                  className={`display leading-none text-black dark:text-zinc-50 ${
                    i === 0 ? "text-6xl" : "text-3xl text-zinc-500 dark:text-zinc-400"
                  }`}
                >
                  {value ?? "—"}
                </dd>
                <dt className="mt-2 text-[11px] uppercase tracking-[0.1em] text-zinc-500">
                  {label}
                </dt>
              </div>
            ))}
          </dl>
        </div>

        {Boolean(health?.outOfCredit) && (
          <div
            className="mt-10 flex flex-wrap items-center gap-4 rounded-2xl px-6 py-5"
            style={{ background: BANDS.red.bg, border: `1px solid ${BANDS.red.line}` }}
          >
            <p className="flex-1 text-sm leading-6" style={{ color: "#5A2A25" }}>
              <strong className="font-semibold" style={{ color: BANDS.red.ink }}>
                Nothing can run.
              </strong>{" "}
              The Anthropic account is out of credit, so no product can be
              reviewed. Nothing already paid for is lost.
            </p>
            <Link
              href="/runs"
              className="rounded-full px-5 py-2.5 text-sm font-semibold text-white"
              style={{ background: BANDS.red.ink }}
            >
              See the queue
            </Link>
          </div>
        )}

        <section className="mt-16">
          <div className="flex items-baseline justify-between gap-6">
            <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">
              Worth your attention
            </h2>
            <Link href="/shortlist" className="text-sm text-zinc-600 underline dark:text-zinc-400">
              All of them →
            </Link>
          </div>

          {loading ? (
            <p className="mt-6 text-sm text-zinc-500">Loading…</p>
          ) : top.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Nothing has survived a paid review yet.
              </p>
              <Link href="/runs" className="mt-2 inline-block text-sm underline">
                Start a run →
              </Link>
            </div>
          ) : (
            <ul className="mt-5 grid gap-4 sm:grid-cols-3">
              {top.map(({ row, score }) => {
                const band = bandFor(score);
                return (
                  <li
                    key={row.asin}
                    className="flex flex-col rounded-2xl p-6"
                    style={{
                      background: band.bg === "transparent" ? undefined : band.bg,
                      border: `1px solid ${band.line}`,
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span
                        className="rounded-full bg-white/80 px-3 py-1 text-[11px] font-semibold"
                        style={{ color: band.ink }}
                      >
                        {row.judge_verdict}
                      </span>
                      <span className="display text-4xl leading-none" style={{ color: band.ink }}>
                        {score ?? "—"}
                      </span>
                    </div>

                    <Link
                      href="/shortlist"
                      className="display mt-4 text-xl leading-snug text-black dark:text-zinc-100"
                    >
                      {row.title?.split(/[,|(]/)[0].slice(0, 62) ?? row.asin}
                    </Link>

                    <p className="mt-2 flex-1 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
                      {(row.judge_summary ?? row.triage_because ?? "").slice(0, 120)}
                      {(row.judge_summary ?? row.triage_because ?? "").length > 120 ? "…" : ""}
                    </p>

                    <div className="mt-5 border-t pt-4" style={{ borderColor: band.line }}>
                      <div className="text-[11px] uppercase tracking-[0.08em] text-zinc-500">
                        You can pay up to
                      </div>
                      <div className="mt-1 text-2xl font-semibold text-black dark:text-zinc-100">
                        {money(row.max_landed_cost)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="mt-12 flex flex-wrap items-center gap-3">
          <Link
            href="/shortlist"
            className="rounded-full bg-black px-8 py-4 text-base font-semibold text-white dark:bg-zinc-100 dark:text-black"
          >
            Open the shortlist
          </Link>
          <Link
            href="/runs"
            className="rounded-full border border-zinc-300 px-8 py-4 text-base font-medium text-zinc-800 dark:border-zinc-700 dark:text-zinc-200"
          >
            What it is doing
          </Link>
        </div>

      </main>
    </div>
  );
}
