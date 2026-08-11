"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { STAGES, STAGE_LABELS, type ProductRow, type Stage } from "@/lib/stages";

const VERDICT_COLOUR: Record<string, string> = {
  TEST: "text-emerald-700 dark:text-emerald-400",
  PARK: "text-amber-700 dark:text-amber-400",
  KILL: "text-red-700 dark:text-red-400",
};

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [filter, setFilter] = useState<Stage | "all">("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const url = filter === "all" ? "/api/products" : `/api/products?stage=${filter}`;
      const response = await fetch(url);
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Could not load products");
        return;
      }
      setProducts(data.products);
    } catch {
      setError("Could not reach the server");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(id: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? "Could not update");
      return;
    }
    void load();
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Delete "${name}"? Its judgements and pre-mortems go too.`)) return;
    const response = await fetch(`/api/products/${id}`, { method: "DELETE" });
    if (!response.ok) {
      setError("Could not delete");
      return;
    }
    void load();
  }

  const counts = STAGES.reduce<Record<string, number>>((acc, stage) => {
    acc[stage] = products.filter((p) => p.stage === stage).length;
    return acc;
  }, {});

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-5xl flex-1 px-6 py-14 sm:px-10">
        <Link
          href="/"
          className="font-mono text-xs uppercase tracking-widest text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
        >
          ← Project Claudinho
        </Link>
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Products
          </h1>
          <Link
            href="/judge"
            className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-black"
          >
            Judge a new one →
          </Link>
        </div>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Everything you have scored. Dead ones stay here on purpose, with the
          reason, so you stop re-finding them.
        </p>

        <div className="mt-6 flex flex-wrap gap-1.5">
          <button
            onClick={() => setFilter("all")}
            className={`rounded border px-2.5 py-1 text-xs ${
              filter === "all"
                ? "border-black bg-black text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-black"
                : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
            }`}
          >
            All ({products.length})
          </button>
          {STAGES.map((stage) => (
            <button
              key={stage}
              onClick={() => setFilter(stage)}
              className={`rounded border px-2.5 py-1 text-xs ${
                filter === stage
                  ? "border-black bg-black text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-black"
                  : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
              }`}
            >
              {STAGE_LABELS[stage]}
              {filter === "all" && counts[stage] > 0 ? ` (${counts[stage]})` : ""}
            </button>
          ))}
        </div>

        {error && (
          <p className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
            {error}
          </p>
        )}

        {loading ? (
          <p className="mt-8 text-sm text-zinc-500">Loading…</p>
        ) : products.length === 0 ? (
          <p className="mt-8 rounded border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
            Nothing here yet. Judge a product and press Save.
          </p>
        ) : (
          <ul className="mt-6 divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {products.map((p) => {
              const latest = p.judgements?.[0];
              const disagreed = p.my_verdict && latest && p.my_verdict !== latest.verdict;
              return (
                <li key={p.id} className="py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="font-medium text-black dark:text-zinc-100">
                      {p.name}
                      <span className="ml-2 text-xs font-normal text-zinc-500">
                        {p.category} · £{Number(p.sell_price).toFixed(2)} · {p.weight_grams}g
                      </span>
                    </h2>
                    <div className="flex items-center gap-3 text-xs">
                      {latest && (
                        <span className={`font-medium ${VERDICT_COLOUR[latest.verdict] ?? ""}`}>
                          Judge: {latest.verdict}
                        </span>
                      )}
                      {p.my_verdict && (
                        <span
                          className={`font-medium ${VERDICT_COLOUR[p.my_verdict] ?? ""}`}
                          title="Your own verdict"
                        >
                          You: {p.my_verdict}
                        </span>
                      )}
                      {disagreed && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                          disagreed
                        </span>
                      )}
                    </div>
                  </div>

                  {latest && (
                    <p className="mt-1 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
                      {latest.summary}
                    </p>
                  )}
                  {p.killed_reason && (
                    <p className="mt-1 text-xs leading-5 text-red-800 dark:text-red-400">
                      <strong className="font-medium">Killed:</strong> {p.killed_reason}
                    </p>
                  )}
                  {p.my_notes && (
                    <p className="mt-1 text-xs leading-5 text-zinc-700 dark:text-zinc-300">
                      <strong className="font-medium">Your note:</strong> {p.my_notes}
                    </p>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                      value={p.stage}
                      onChange={(e) => void patch(p.id, { stage: e.target.value })}
                      className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    >
                      {STAGES.map((stage) => (
                        <option key={stage} value={stage}>
                          {STAGE_LABELS[stage]}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs text-zinc-400">
                      {new Date(p.created_at).toLocaleDateString("en-GB")}
                    </span>
                    <button
                      onClick={() => void remove(p.id, p.name)}
                      className="ml-auto text-xs text-zinc-500 hover:text-red-700 dark:hover:text-red-400"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
