"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ScoutCandidateRow } from "@/lib/stages";
import { viability } from "@/lib/viability";

/**
 * The front door, rebuilt as a process rather than a gallery.
 *
 * It has been three things now. A build checklist, which described how the
 * tool was made. Then counts and two buttons, which said nothing. Then three
 * product cards under a headline, which showed the answer but never said what
 * to do with it, and used the words TEST, PARK and KILL at somebody who did
 * not write them.
 *
 * The complaint that produced this version was precise: it looks simple and
 * is still confusing. That is what happens when a screen shows outcomes but
 * hides the sequence that produced them, so you cannot tell what has already
 * happened, what is waiting, or which of six links is the one to press.
 *
 * So the page is the sequence. Six steps in the order the work happens, each
 * either done, waiting on you, or not yet reachable; one action at the top
 * that is the single most useful thing to do right now; and the step you are
 * actually on opened up with its contents inside it. Colour means state and
 * nothing else. Every label is a sentence somebody would say out loud.
 */

/* ---------------------------------------------------------------- colour --
 * Three bands for how good a product is, as specified: green worth a look,
 * amber borderline, red probably not. Used nowhere else, so colour on this
 * page always answers the same question.
 */
const BAND = {
  green: { bg: "#ECF6F0", line: "#C3DFCE", ink: "#1F6B47" },
  amber: { bg: "#FDF2E3", line: "#EFD8B4", ink: "#8A5A16" },
  red: { bg: "#FCEDEA", line: "#F0CFC8", ink: "#8B3128" },
} as const;

const INK = "#15130F";
const MUTED = "#6D675D";
const LINE = "#E6E2DA";

function bandFor(score: number | null) {
  if (score === null) return BAND.amber;
  if (score >= 61) return BAND.green;
  if (score >= 50) return BAND.amber;
  return BAND.red;
}

function bandWord(score: number | null) {
  if (score === null) return "Not scored";
  if (score >= 61) return "Worth a look";
  if (score >= 50) return "Borderline";
  return "Probably not";
}

/* ------------------------------------------------------------------ data -- */

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

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `£${Number(n).toFixed(2)}`;

/** A summary worth showing. Some rows carry the literal word "placeholder". */
function usableSummary(r: ScoutCandidateRow): string | null {
  const raw = (r.judge_summary ?? r.triage_because ?? "").trim();
  if (!raw || raw.length < 25) return null;
  if (/^placeholder$/i.test(raw)) return null;
  return raw;
}

type Health = {
  qualified?: {
    seen?: number | string;
    triaged?: Record<string, number> | { error: string };
    judged?: Record<string, number> | { error: string };
  };
  outOfCredit?: boolean;
  stalled?: boolean;
  outstanding?: number;
  lastRun?: { status?: string; minutesAgo?: number | null } | null;
};

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

/* ------------------------------------------------------------------- bits -- */

function Bullet({ state, n }: { state: string; n: number }) {
  if (state === "done")
    return (
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
        style={{ background: BAND.green.ink }}
        aria-hidden
      >
        ✓
      </span>
    );
  if (state === "blocked")
    return (
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
        style={{ background: BAND.red.ink }}
        aria-hidden
      >
        !
      </span>
    );
  if (state === "now")
    return (
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
        style={{ background: INK }}
      >
        {n}
      </span>
    );
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[13px] font-semibold"
      style={{ borderColor: LINE, color: "#A49D91" }}
    >
      {n}
    </span>
  );
}

function ProductRow({ row, score }: { row: ScoutCandidateRow; score: number | null }) {
  const band = bandFor(score);
  const summary = usableSummary(row);
  return (
    <li className="group">
      <Link
        href={`/shortlist#${row.asin}`}
        className="flex items-center gap-4 rounded-xl px-3 py-3 transition-colors hover:bg-[#FAF9F7]"
      >
        <span
          className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg text-[15px] font-bold tabular-nums"
          style={{ background: band.bg, color: band.ink, border: `1px solid ${band.line}` }}
        >
          {score ?? "—"}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold" style={{ color: INK }}>
            {row.title?.split(/[,|(]/)[0].slice(0, 70) ?? row.asin}
          </span>
          <span className="mt-0.5 block truncate text-[13px]" style={{ color: MUTED }}>
            {summary ?? row.category ?? row.asin}
          </span>
        </span>

        <span className="hidden shrink-0 text-right sm:block">
          <span className="block text-[11px] uppercase tracking-wide" style={{ color: MUTED }}>
            Sells at
          </span>
          <span className="block text-[15px] font-semibold tabular-nums" style={{ color: INK }}>
            {money(row.price)}
          </span>
        </span>

        <span className="shrink-0 text-right">
          <span className="block text-[11px] uppercase tracking-wide" style={{ color: MUTED }}>
            You can pay
          </span>
          <span className="block text-[15px] font-bold tabular-nums" style={{ color: band.ink }}>
            {money(row.max_landed_cost)}
          </span>
        </span>

        <span
          className="shrink-0 text-lg transition-transform group-hover:translate-x-0.5"
          style={{ color: "#B5AEA2" }}
          aria-hidden
        >
          ›
        </span>
      </Link>
    </li>
  );
}

/* ------------------------------------------------------------------ page -- */

export default function Home() {
  const [rows, setRows] = useState<ScoutCandidateRow[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [s, h] = await Promise.all([
        fetch("/api/shortlist").then((r) => r.json()).catch(() => ({})),
        fetch("/api/health").then((r) => r.json()).catch(() => ({})),
      ]);
      if (!live) return;
      setRows((s.rows ?? []) as ScoutCandidateRow[]);
      setHealth((h.pipeline ?? null) as Health | null);
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, []);

  const q = health?.qualified ?? {};
  const judged = (q.judged ?? {}) as Record<string, number>;
  const triaged = (q.triaged ?? {}) as Record<string, number>;

  const seen = typeof q.seen === "number" ? q.seen : null;
  const keptForCloserLook = num(triaged.test);
  const stillStanding = num(judged.test);
  const reviewedTotal =
    judged.test !== undefined
      ? (judged.test ?? 0) + (judged.park ?? 0) + (judged.kill ?? 0)
      : null;

  const standing = rows
    .filter((r) => r.judge_verdict === "TEST")
    .map((r) => ({ row: r, score: scoreOf(r) }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const withReviews = rows.filter((r) => r.has_reviews).length;
  const awaitingReview = rows.filter((r) => r.triage_verdict === "TEST" && !r.judge_verdict).length;

  const blocked = Boolean(health?.outOfCredit);

  // The step you are on is the earliest one with work that is worth more than
  // the work below it. Decisions you can make now beat machine work queued
  // behind an empty account.
  const currentKey = stillStanding && stillStanding > 0
    ? "decide"
    : awaitingReview > 0
      ? "judge"
      : seen && seen > 0
        ? "sift"
        : "find";

  const STEPS = [
    {
      key: "find",
      name: "Find what people already buy",
      blurb: "Sweep Amazon for products with real, proven demand.",
      stat: seen,
      statWord: "products found",
      href: "/runs",
      cta: "Start a scan",
      done: Boolean(seen && seen > 0),
    },
    {
      key: "sift",
      name: "Drop the hopeless ones",
      blurb: "Free sums first, then a cheap read, so nothing pointless gets paid for.",
      stat: keptForCloserLook,
      statWord: "kept for a closer look",
      href: "/shortlist",
      cta: "See what survived",
      done: Boolean(keptForCloserLook && keptForCloserLook > 0),
    },
    {
      key: "listen",
      name: "Read what buyers complain about",
      blurb: "Paste real reviews in, so the verdict rests on evidence rather than a guess.",
      stat: withReviews || null,
      statWord: "have had their reviews read",
      href: "/reviews",
      cta: "Add reviews",
      done: withReviews > 0,
    },
    {
      key: "judge",
      name: "The full, careful review",
      blurb: "The expensive look. Four in five die here, and that is the point of it.",
      stat: reviewedTotal,
      statWord: "fully reviewed",
      href: "/runs",
      cta: "Review more",
      done: Boolean(reviewedTotal && reviewedTotal > 0),
    },
    {
      key: "room",
      name: "Check there is room on the shelf",
      blurb: "Whether the category already has an owner, and how you would stand out.",
      stat: null,
      statWord: "",
      href: "/niche",
      cta: "Check a category",
      done: false,
    },
    {
      key: "decide",
      name: "Decide, and work out your price",
      blurb: "The most you can pay per unit landed, then back it or bin it.",
      stat: stillStanding,
      statWord: "waiting on your decision",
      href: "/products",
      cta: "Open the board",
      done: false,
    },
  ];

  const currentIndex = STEPS.findIndex((s) => s.key === currentKey);
  const currentStep = STEPS[currentIndex];
  const expanded = open ?? currentKey;

  return (
    <div className="flex flex-1 flex-col" style={{ background: "#FFFFFF" }}>
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10 sm:px-8 sm:py-14">
        {/* ---------------------------------------------- the one next thing */}
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: MUTED }}>
          {loading ? "Checking" : blocked ? "Stopped" : `Step ${currentIndex + 1} of ${STEPS.length}`}
        </p>

        {blocked ? (
          <div
            className="mt-3 rounded-2xl p-6 sm:p-7"
            style={{ background: BAND.red.bg, border: `1px solid ${BAND.red.line}` }}
          >
            <h1 className="text-2xl font-bold sm:text-[28px]" style={{ color: BAND.red.ink }}>
              Nothing can run right now
            </h1>
            <p className="mt-2 text-[15px] leading-7" style={{ color: "#6A3A33" }}>
              The Anthropic account is out of credit, so no product can be reviewed. Nothing you
              have already paid for is lost, and everything below is still here when it is topped
              up.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <a
                href="https://console.anthropic.com/settings/billing"
                target="_blank"
                rel="noreferrer"
                className="rounded-full px-6 py-3 text-[15px] font-semibold text-white"
                style={{ background: BAND.red.ink }}
              >
                Add credit
              </a>
              <Link
                href="/runs"
                className="rounded-full border bg-white px-6 py-3 text-[15px] font-semibold"
                style={{ borderColor: BAND.red.line, color: BAND.red.ink }}
              >
                Then press Resume
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-3 rounded-2xl p-6 sm:p-7" style={{ background: "#F7F6F3", border: `1px solid ${LINE}` }}>
            <h1 className="text-2xl font-bold leading-snug sm:text-[28px]" style={{ color: INK }}>
              {loading ? "Working out where you are…" : currentStep.name}
            </h1>
            <p className="mt-2 text-[15px] leading-7" style={{ color: MUTED }}>
              {loading ? "One moment." : currentStep.blurb}
            </p>
            {!loading && (
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Link
                  href={currentStep.href}
                  className="rounded-full px-6 py-3 text-[15px] font-semibold text-white"
                  style={{ background: INK }}
                >
                  {currentStep.cta}
                </Link>
                {currentStep.stat !== null && (
                  <span className="text-[14px]" style={{ color: MUTED }}>
                    <strong className="tabular-nums" style={{ color: INK }}>
                      {currentStep.stat}
                    </strong>{" "}
                    {currentStep.statWord}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* ------------------------------------------------------- progress */}
        <div className="mt-8 flex gap-1.5" aria-hidden>
          {STEPS.map((s, i) => (
            <span
              key={s.key}
              className="h-1.5 flex-1 rounded-full"
              style={{
                background: s.done ? BAND.green.ink : i === currentIndex ? INK : "#EAE7E1",
              }}
            />
          ))}
        </div>

        {/* ---------------------------------------------------- the process */}
        <h2
          className="mt-9 text-[11px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: MUTED }}
        >
          How this works, start to finish
        </h2>

        <ol className="mt-3 overflow-hidden rounded-2xl border" style={{ borderColor: LINE }}>
          {STEPS.map((step, i) => {
            const state = step.done ? "done" : i === currentIndex ? "now" : "later";
            const isOpen = expanded === step.key;
            return (
              <li key={step.key} className="border-b last:border-b-0" style={{ borderColor: LINE }}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? "" : step.key)}
                  className="flex w-full items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-[#FAF9F7] sm:px-5"
                  aria-expanded={isOpen}
                >
                  <Bullet state={state} n={i + 1} />

                  <span className="min-w-0 flex-1">
                    <span
                      className="block text-[15px] font-semibold"
                      style={{ color: state === "later" ? "#8C857A" : INK }}
                    >
                      {step.name}
                    </span>
                    {isOpen && (
                      <span className="mt-0.5 block text-[13px] leading-6" style={{ color: MUTED }}>
                        {step.blurb}
                      </span>
                    )}
                  </span>

                  {step.stat !== null && (
                    <span className="shrink-0 text-right">
                      <span
                        className="block text-[19px] font-bold tabular-nums"
                        style={{ color: state === "later" ? "#A49D91" : INK }}
                      >
                        {step.stat}
                      </span>
                    </span>
                  )}

                  <span className="shrink-0 text-sm" style={{ color: "#B5AEA2" }} aria-hidden>
                    {isOpen ? "▴" : "▾"}
                  </span>
                </button>

                {isOpen && (
                  <div className="px-4 pb-5 sm:px-5">
                    {step.stat !== null && step.statWord && (
                      <p className="mb-3 text-[13px]" style={{ color: MUTED }}>
                        {step.stat} {step.statWord}.
                      </p>
                    )}

                    {step.key === "decide" && standing.length > 0 && (
                      <ul className="mb-4 -mx-3">
                        {standing.map(({ row, score }) => (
                          <ProductRow key={row.asin} row={row} score={score} />
                        ))}
                      </ul>
                    )}

                    {step.key === "decide" && !loading && standing.length === 0 && (
                      <p className="mb-4 text-[14px]" style={{ color: MUTED }}>
                        Nothing has survived a full review yet, so there is nothing to decide on.
                      </p>
                    )}

                    <Link
                      href={step.href}
                      className="inline-block rounded-full border px-5 py-2.5 text-[14px] font-semibold"
                      style={{ borderColor: LINE, color: INK }}
                    >
                      {step.cta}
                    </Link>
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {/* ------------------------------------------------------ the scale */}
        <p className="mt-6 text-[13px] leading-6" style={{ color: MUTED }}>
          Scores run 0 to 100.{" "}
          <span className="font-semibold" style={{ color: BAND.green.ink }}>
            61 and over
          </span>{" "}
          is worth a look,{" "}
          <span className="font-semibold" style={{ color: BAND.amber.ink }}>
            50 to 60
          </span>{" "}
          is borderline, and{" "}
          <span className="font-semibold" style={{ color: BAND.red.ink }}>
            under 50
          </span>{" "}
          probably is not. &ldquo;You can pay&rdquo; is the most a unit can cost you, landed in the
          UK, and still leave a 30% margin.
        </p>
      </main>
    </div>
  );
}
