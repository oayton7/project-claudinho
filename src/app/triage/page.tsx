"use client";

import { useState } from "react";
import Link from "next/link";

type Row = {
  product?: string;
  opus?: string;
  triage?: string;
  match?: string;
  triageReason?: string;
  pence?: number;
  error?: string;
};

type Report = {
  verdict?: string;
  agreement?: string;
  sameVerdict?: number;
  triageKinder?: number;
  triageHarsher?: number;
  costPence?: number;
  costPerProductPence?: number;
  caveat?: string;
  rows?: Row[];
  error?: string;
};

export default function TriageCheckPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setLoading(true);
    setError("");
    setReport(null);
    try {
      const response = await fetch("/api/triage/agreement");
      if (response.status === 401) {
        setError("Your session expired. Reload the page and sign in again.");
        return;
      }
      const data = (await response.json()) as Report;
      if (data.error) {
        setError(data.error);
        return;
      }
      setReport(data);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

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
          Does the cheap tier cost accuracy?
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Judging with Opus costs about 11p a product. Triage costs about 0.2p.
          Fewer tokens does change the answer, so the only useful question is by
          how much and in which direction. This re-runs triage over every
          product that already carries an Opus verdict and compares them.
        </p>
        <p className="mt-3 max-w-2xl rounded border border-zinc-200 bg-white p-4 text-sm leading-6 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
          The headline agreement rate is not the number that matters.
          <strong className="font-medium"> Triage harsher</strong> is: those are
          products the cheap tier killed that Opus wanted to keep, and you would
          never have seen them. Triage being kinder is the system working, since
          Opus settles it for 11p.
        </p>

        <button
          onClick={() => void run()}
          disabled={loading}
          className="mt-6 rounded bg-black px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-black"
        >
          {loading ? "Running…" : "Run the comparison (about 3p)"}
        </button>

        {error && (
          <p className="mt-5 rounded border border-red-300 bg-red-50 p-4 text-sm leading-6 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
            {error}
          </p>
        )}

        {report && (
          <>
            <p
              className={`mt-6 rounded border p-4 text-sm leading-6 ${
                (report.triageHarsher ?? 0) === 0
                  ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
                  : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
              }`}
            >
              {report.verdict}
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Same verdict", report.sameVerdict],
                ["Triage kinder", report.triageKinder],
                ["Triage harsher", report.triageHarsher],
                ["Cost", `${report.costPence}p`],
              ].map(([label, value]) => (
                <div
                  key={String(label)}
                  className="rounded border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <div className="text-xs text-zinc-500">{label}</div>
                  <div className="mt-0.5 text-xl font-semibold tabular-nums text-black dark:text-zinc-100">
                    {String(value)}
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-4 text-xs leading-5 text-zinc-500">{report.caveat}</p>

            <div className="mt-5 overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead className="bg-zinc-100 text-left text-xs uppercase tracking-wide text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Product</th>
                    <th className="px-3 py-2 font-medium">Opus</th>
                    <th className="px-3 py-2 font-medium">Triage</th>
                    <th className="px-3 py-2 font-medium">Why triage said so</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {(report.rows ?? []).map((r, i) => (
                    <tr
                      key={i}
                      className={
                        r.match === "TRIAGE HARSHER"
                          ? "bg-amber-50 dark:bg-amber-950/40"
                          : ""
                      }
                    >
                      <td className="px-3 py-2 text-black dark:text-zinc-100">
                        {r.product}
                        {r.error && (
                          <span className="block text-xs text-red-700 dark:text-red-400">
                            {r.error}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                        {r.opus ?? "—"}
                      </td>
                      <td
                        className={`px-3 py-2 font-medium ${
                          r.match === "TRIAGE HARSHER"
                            ? "text-amber-800 dark:text-amber-300"
                            : "text-zinc-700 dark:text-zinc-300"
                        }`}
                      >
                        {r.triage ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
                        {r.triageReason ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
