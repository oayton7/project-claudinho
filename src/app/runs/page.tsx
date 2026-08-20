"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Run = {
  id: string;
  created_at: string;
  status: string;
  stage_detail: string;
  categories: { name: string }[];
  category_cursor: number;
  triage_queue: string[];
  triage_cursor: number;
  scanned: number;
  killed: number;
  triaged: number;
  spent_pence: number;
  cap_pence: number;
  keepa_tokens_left: number | null;
  error: string | null;
  ticks: number;
};

const STATUS_STYLE: Record<string, string> = {
  queued: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  finding: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  sweeping: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  triaging: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  done: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  halted: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  failed: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};

/**
 * Fetches the run list.
 *
 * Deliberately outside the component. Inside, it was either wrapped in a
 * useCallback that stopped React Compiler optimising the whole component, or
 * left bare and re-created every render — which reset the polling interval on
 * every render, so a page that re-renders often would never finish a ten
 * second wait. Out here it has one stable identity and neither problem.
 */
async function fetchRuns(): Promise<{ runs: Run[]; error?: string }> {
  try {
    const response = await fetch("/api/pipeline/start");
    const data = await response.json();
    if (!response.ok)
      return { runs: [], error: data.error ?? "Could not load runs" };
    return { runs: data.runs as Run[] };
  } catch {
    return { runs: [], error: "Could not reach the server." };
  }
}

export default function RunsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [working, setWorking] = useState(false);
  const [resuming, setResuming] = useState("");
  const [judging, setJudging] = useState(false);

  /**
   * Work whatever is queued.
   *
   * A run no longer starts itself. Two attempts at having each slice call the
   * next over HTTP both died silently mid-run, so one invocation now does as
   * many slices as it can and the next invocation picks up the rest — which is
   * either this button or the watchdog.
   */
  async function work() {
    setWorking(true);
    setError("");
    try {
      const response = await fetch("/api/pipeline/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await response.json();
      if (data.error) setError(data.error);
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setWorking(false);
    }
  }

  const load = async () => {
    const result = await fetchRuns();
    if (result.error) setError(result.error);
    else setRuns(result.runs);
  };

  // A live view of something that advances on its own, so it polls. Ten
  // seconds is slow enough to be free and fast enough to feel alive.
  useEffect(() => {
    let live = true;
    const poll = async () => {
      const result = await fetchRuns();
      if (!live) return;
      if (result.error) setError(result.error);
      else setRuns(result.runs);
    };
    void poll();
    const timer = setInterval(() => void poll(), 10000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  /**
   * Puts one stopped run back in the queue.
   *
   * Separate from "Work the queue" on purpose: that button only drives runs
   * the system already considers live, and a failed run is deliberately not
   * one of them until a person has looked at why.
   */
  const resume = async (id: string) => {
    setResuming(id);
    setError("");
    try {
      const response = await fetch("/api/pipeline/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: id }),
      });
      const data = await response.json();
      if (data.error) setError(data.error);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resume that run.");
    } finally {
      setResuming("");
    }
  };

  /**
   * Queues a run that only judges.
   *
   * Skips finding and sweeping, so it costs no Keepa tokens — which matters
   * when the bucket is empty and there is already a backlog that passed
   * triage. A pound is about ten deep judgements; press it again for more,
   * rather than committing four pounds to one click.
   */
  async function judgeBacklog() {
    setJudging(true);
    setError("");
    try {
      const response = await fetch("/api/pipeline/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: "judging", capPence: 100 }),
      });
      const data = await response.json();
      if (data.error) setError(data.error);
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not queue the judging run.",
      );
    } finally {
      setJudging(false);
    }
  }

  async function start() {
    setStarting(true);
    setError("");
    try {
      const response = await fetch("/api/pipeline/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minGrowth: 1.5,
          // Twelve categories at three products each is 36 scanned and up to
          // 30 judged, for about 250 Keepa tokens and 6p. The ceiling is the
          // token bucket, not the code, and a long run costs nothing extra
          // now that a run is a job rather than a request.
          categoryLimit: 12,
          triageLimit: 30,
          maxPages: 10,
          capPence: 50,
        }),
      });
      const data = await response.json();
      if (!response.ok) setError(data.error ?? "Could not start");
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setStarting(false);
    }
  }

  const active = runs.filter((r) =>
    ["queued", "finding", "sweeping", "triaging"].includes(r.status),
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
          Runs
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          A run is a row in the database, not a request. It advances itself one
          slice at a time — the finding stage, then a category, then a handful
          of judgements — committing after each. Close the tab, deploy
          mid-flight, lose your connection: none of it re-spends money already
          spent.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            onClick={() => void start()}
            disabled={starting || active.length > 0}
            className="rounded bg-black px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-black"
          >
            {starting ? "Queueing…" : "Start a run"}
          </button>
          <button
            onClick={() => void work()}
            disabled={working || active.length === 0}
            className="rounded border border-zinc-400 px-5 py-2.5 text-sm font-medium text-zinc-800 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200"
          >
            {working
              ? "Working…"
              : `Work the queue${active.length ? ` (${active.length})` : ""}`}
          </button>
          {active.length > 0 && !working && (
            <span className="text-xs text-zinc-500">
              {active.length} waiting. This runs for about four minutes, then
              hands back.
            </span>
          )}
          <button
            onClick={() => void judgeBacklog()}
            disabled={judging}
            className="rounded border border-zinc-400 px-5 py-2.5 text-sm font-medium text-zinc-800 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200"
          >
            {judging ? "Queueing…" : "Judge what passed triage (£1, about 10)"}
          </button>
          <Link href="/shortlist" className="ml-auto text-sm underline">
            The shortlist →
          </Link>
        </div>

        {error && (
          <p className="mt-5 rounded border border-red-300 bg-red-50 p-4 text-sm leading-6 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
            {error}
          </p>
        )}

        <ul className="mt-6 space-y-3">
          {runs.map((r) => {
            const sweepDone = r.categories.length
              ? Math.min(r.category_cursor, r.categories.length)
              : 0;
            return (
              <li
                key={r.id}
                className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[r.status] ?? ""}`}
                  >
                    {r.status}
                  </span>
                  <span className="font-mono text-[11px] text-zinc-500">
                    {new Date(r.created_at).toLocaleString("en-GB")} · {r.ticks}{" "}
                    ticks
                  </span>
                </div>

                <p className="mt-2 text-sm text-zinc-800 dark:text-zinc-200">
                  {r.stage_detail || "—"}
                </p>

                {r.categories.length > 0 && (
                  <p className="mt-1 text-xs text-zinc-500">
                    {sweepDone}/{r.categories.length} categories:{" "}
                    {r.categories.map((c) => c.name).join(", ")}
                  </p>
                )}

                <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                  {[
                    ["scanned", r.scanned],
                    ["killed free", r.killed],
                    [
                      "judged",
                      `${r.triage_cursor}/${r.triage_queue.length || 0}`,
                    ],
                    [
                      "spent",
                      `${Number(r.spent_pence).toFixed(2)}p of ${r.cap_pence}p`,
                    ],
                    ["keepa", r.keepa_tokens_left ?? "—"],
                  ].map(([k, v]) => (
                    <div key={String(k)}>
                      <div className="text-zinc-500">{k}</div>
                      <div className="tabular-nums text-zinc-800 dark:text-zinc-200">
                        {String(v)}
                      </div>
                    </div>
                  ))}
                </div>

                {r.error && (
                  <p className="mt-2 rounded bg-amber-50 p-2 text-xs leading-5 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    {r.error}
                  </p>
                )}

                {(r.status === "failed" || r.status === "halted") && (
                  <button
                    onClick={() => void resume(r.id)}
                    disabled={resuming === r.id}
                    className="mt-2 rounded border border-zinc-400 px-3 py-1.5 text-xs font-medium text-zinc-800 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200"
                  >
                    {resuming === r.id
                      ? "Resuming…"
                      : "Resume — keeps what it already paid for"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
