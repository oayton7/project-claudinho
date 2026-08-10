"use client";

import { useState } from "react";
import Link from "next/link";
import {
  DEFAULT_PRODUCT,
  WEIGHT_LIMIT_GRAMS,
  type Judgement,
  type Premortem,
  type ProductInput,
} from "@/lib/judge";

type Usage = { inputTokens: number; outputTokens: number; costPence: number };

const US_SIGNALS: { value: ProductInput["usSignal"]; label: string }[] = [
  { value: "rising", label: "Rising in the US" },
  { value: "falling", label: "Falling in the US" },
  { value: "flat", label: "Flat in the US" },
  { value: "no-analogue", label: "No US equivalent" },
  { value: "unchecked", label: "Haven't checked" },
];

const TEXT_FIELDS: {
  key: keyof ProductInput;
  label: string;
  hint: string;
  rows: number;
}[] = [
  {
    key: "listingNotes",
    label: "Paste the listings",
    hint: "Copy the actual titles and bullets from the top few sellers. Add a line on the photography: lifestyle shots or plain white, any video, any A+ content. Do not tidy it up.",
    rows: 6,
  },
  {
    key: "reviewComplaints",
    label: "Paste the reviews",
    hint: "Ten or so 3-star reviews from the market leaders, raw and unedited. Three stars is where people say what is actually wrong. Do not summarise them — pasting is less work for you, and summarising is where the signal gets lost.",
    rows: 10,
  },
  {
    key: "competitorNotes",
    label: "Paste the competition",
    hint: "Brand names as they appear, how many sellers, roughly how many reviews the leaders have. Generic names like KJHFG or Woohoo are themselves a signal.",
    rows: 5,
  },
];

const VERDICT_STYLE: Record<Judgement["verdict"], string> = {
  TEST: "bg-emerald-50 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-100 dark:border-emerald-800",
  PARK: "bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-100 dark:border-amber-800",
  KILL: "bg-red-50 text-red-900 border-red-300 dark:bg-red-950 dark:text-red-100 dark:border-red-800",
};

function Score({ label, score, reasoning }: { label: string; score: number; reasoning: string }) {
  return (
    <div className="py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-black dark:text-zinc-100">{label}</span>
        <span className="flex shrink-0 gap-0.5" aria-label={`${score} out of 5`}>
          {[1, 2, 3, 4, 5].map((n) => (
            <span
              key={n}
              className={`h-1.5 w-4 rounded-sm ${
                n <= score ? "bg-black dark:bg-zinc-100" : "bg-zinc-200 dark:bg-zinc-800"
              }`}
            />
          ))}
        </span>
      </div>
      <p className="mt-1 text-xs leading-5 text-zinc-600 dark:text-zinc-400">{reasoning}</p>
    </div>
  );
}

export default function JudgePage() {
  const [product, setProduct] = useState<ProductInput>(DEFAULT_PRODUCT);
  const [judgement, setJudgement] = useState<Judgement | null>(null);
  const [premortem, setPremortem] = useState<Premortem | null>(null);
  const [usage, setUsage] = useState<Usage[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState<"judge" | "premortem" | null>(null);
  const [thinking, setThinking] = useState("");

  const set = <K extends keyof ProductInput>(key: K, value: ProductInput[K]) =>
    setProduct((prev) => ({ ...prev, [key]: value }));

  /**
   * Both routes stream newline-delimited JSON: many "thinking" events while
   * Claude reasons, then one "done". Read it a chunk at a time rather than
   * waiting for the whole response — these calls take minutes, and a silent
   * connection that long gets dropped by the platform.
   */
  async function streamPost(
    url: string,
    payload: unknown,
    kind: "judge" | "premortem",
    onDone: (event: Record<string, unknown>) => void,
  ) {
    setPending(kind);
    setErrors([]);
    setThinking("");

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        setErrors(data.details ?? [data.error ?? "Something went wrong"]);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // A chunk can split a line in half, so keep the last partial back.
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "thinking") {
            setThinking((t) => t + event.text);
          } else if (event.type === "done") {
            if (event.usage) setUsage((u) => [...u, event.usage]);
            onDone(event);
          } else if (event.type === "error") {
            setErrors([event.error]);
          }
        }
      }
    } catch {
      setErrors(["Lost the connection to the server"]);
    } finally {
      setPending(null);
    }
  }

  async function runJudge(event: React.FormEvent) {
    event.preventDefault();
    setJudgement(null);
    setPremortem(null);
    await streamPost("/api/judge", product, "judge", (e) =>
      setJudgement(e.judgement as Judgement),
    );
  }

  async function runPremortem() {
    await streamPost(
      "/api/premortem",
      { product, judgement },
      "premortem",
      (e) => setPremortem(e.premortem as Premortem),
    );
  }

  const totalPence = usage.reduce((sum, u) => sum + u.costPence, 0);
  const overweight = product.weightGrams > WEIGHT_LIMIT_GRAMS;

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
          The Judge
        </h1>
        <p className="mt-3 max-w-2xl text-zinc-600 dark:text-zinc-400">
          Scores what the margin engine can&rsquo;t: whether there is a gap here
          you can actually exploit. Looking for proven demand that is being
          executed badly.
        </p>

        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
          <form onSubmit={runJudge} className="space-y-5">
            <label className="block text-sm">
              <span className="block text-zinc-700 dark:text-zinc-300">Product</span>
              <input
                value={product.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Silicone pan lid that stops boil-over"
                className="mt-1 w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </label>

            <label className="block text-sm">
              <span className="block text-zinc-700 dark:text-zinc-300">Category</span>
              <input
                value={product.category}
                onChange={(e) => set("category", e.target.value)}
                placeholder="Kitchen &amp; Home"
                className="mt-1 w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="block text-zinc-700 dark:text-zinc-300">Sell price £</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={product.sellPrice}
                  onChange={(e) => set("sellPrice", Number(e.target.value))}
                  className="mt-1 w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 tabular-nums text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </label>
              <label className="block text-sm">
                <span className="block text-zinc-700 dark:text-zinc-300">Weight g</span>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={product.weightGrams}
                  onChange={(e) => set("weightGrams", Number(e.target.value))}
                  className={`mt-1 w-full rounded border bg-white px-2.5 py-1.5 tabular-nums text-black dark:bg-zinc-900 dark:text-zinc-100 ${
                    overweight
                      ? "border-amber-500 dark:border-amber-600"
                      : "border-zinc-300 dark:border-zinc-700"
                  }`}
                />
              </label>
            </div>
            {overweight && (
              <p className="-mt-3 text-xs text-amber-700 dark:text-amber-500">
                Over {WEIGHT_LIMIT_GRAMS}g. Freight and FBA size tiers start
                eating the margin above this.
              </p>
            )}

            {TEXT_FIELDS.map((field) => (
              <label key={field.key} className="block text-sm">
                <span className="block text-zinc-700 dark:text-zinc-300">{field.label}</span>
                <span className="mt-0.5 block text-xs leading-4 text-zinc-500">
                  {field.hint}
                </span>
                <textarea
                  rows={field.rows}
                  value={product[field.key] as string}
                  onChange={(e) => set(field.key, e.target.value as never)}
                  className="mt-1.5 w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </label>
            ))}

            <fieldset className="text-sm">
              <legend className="text-zinc-700 dark:text-zinc-300">US signal</legend>
              <span className="mt-0.5 block text-xs leading-4 text-zinc-500">
                US trends run roughly a year ahead of the UK. Check it on Google
                Trends: search the term, add the same term for the United States,
                set 5 years. &ldquo;No US equivalent&rdquo; is neutral, not a mark
                against. &ldquo;Haven&rsquo;t checked&rdquo; is honest and the
                Judge will say if it needs the answer.
              </span>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {US_SIGNALS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => set("usSignal", s.value)}
                    className={`rounded border px-2.5 py-1 text-xs ${
                      product.usSignal === s.value
                        ? "border-black bg-black text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-black"
                        : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <button
              type="submit"
              disabled={pending !== null}
              className="rounded bg-black px-5 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-black"
            >
              {pending === "judge" ? "Thinking…" : "Judge it"}
            </button>

            {errors.length > 0 && (
              <ul className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}

            {usage.length > 0 && (
              <p className="text-xs text-zinc-500">
                {usage.length} call{usage.length === 1 ? "" : "s"} this session,
                about {totalPence.toFixed(1)}p total.
              </p>
            )}
          </form>

          <section>
            {pending && thinking && (
              <div className="mb-8 rounded border border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
                <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                  {pending === "judge" ? "Working through it" : "Arguing against you"}
                </h2>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-zinc-600 dark:text-zinc-400">
                  {thinking}
                </p>
              </div>
            )}

            {!judgement && !thinking ? (
              <p className="rounded border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
                {pending === "judge"
                  ? "Starting…"
                  : "Paste in what you find and press Judge. Raw reviews beat a summary every time: it reads them as evidence and counts which complaint actually recurs, which is often not the one you would have picked."}
              </p>
            ) : !judgement ? null : (
              <div className="space-y-8">
                <div className={`rounded border p-5 ${VERDICT_STYLE[judgement.verdict]}`}>
                  <p className="text-2xl font-semibold tracking-tight">
                    {judgement.verdict}
                  </p>
                  <p className="mt-2 text-sm leading-6 opacity-90">{judgement.summary}</p>
                </div>

                <div
                  className={`rounded border p-4 ${
                    judgement.targetBuyer.nameable
                      ? "border-zinc-300 dark:border-zinc-700"
                      : "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950"
                  }`}
                >
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
                    Target buyer {judgement.targetBuyer.nameable ? "" : "— hard fail"}
                  </h2>
                  <p className="mt-2 text-sm text-black dark:text-zinc-100">
                    {judgement.targetBuyer.buyer || "Could not be named."}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
                    {judgement.targetBuyer.reasoning}
                  </p>
                </div>

                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
                    Improvability — the thing you&rsquo;re actually hunting
                  </h2>
                  <div className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
                    <Score label="The product" {...judgement.improvability.product} />
                    <Score label="The marketing" {...judgement.improvability.marketing} />
                    <Score label="The branding" {...judgement.improvability.branding} />
                  </div>
                  <div className="mt-4 rounded border border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      The specific fix
                    </h3>
                    <p className="mt-1.5 text-sm leading-6 text-black dark:text-zinc-100">
                      {judgement.improvability.specificFix}
                    </p>
                  </div>
                </div>

                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
                    Can you sell it
                  </h2>
                  <div className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
                    <Score label="Visual and demonstrable" {...judgement.marketability.visual} />
                    <Score label="Solves a visible problem" {...judgement.marketability.problem} />
                    <Score label="Giftable" {...judgement.marketability.giftable} />
                    <Score label="Repeat purchase" {...judgement.marketability.repeatPurchase} />
                  </div>
                </div>

                <div className="rounded border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/50">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-200">
                    If it&rsquo;s that obvious, why hasn&rsquo;t someone fixed it?
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-amber-900 dark:text-amber-100">
                    {judgement.whyHasntSomeoneFixedIt}
                  </p>
                  {judgement.concerns.length > 0 && (
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-5 text-amber-900 dark:text-amber-200">
                      {judgement.concerns.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  )}
                </div>

                {!premortem ? (
                  <div className="rounded border border-dashed border-zinc-300 p-5 dark:border-zinc-700">
                    <h2 className="text-sm font-medium text-black dark:text-zinc-100">
                      About to spend money on this?
                    </h2>
                    <p className="mt-1 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
                      The pre-mortem assumes you already bought it and lost
                      £1,500, then argues why. It is separate because it costs a
                      second call, and because it is for things you are actually
                      about to buy.
                    </p>
                    <button
                      type="button"
                      onClick={runPremortem}
                      disabled={pending !== null}
                      className="mt-3 rounded border border-zinc-400 px-4 py-1.5 text-sm text-zinc-800 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200"
                    >
                      {pending === "premortem" ? "Arguing against you…" : "Run the pre-mortem"}
                    </button>
                  </div>
                ) : (
                  <div className="rounded border border-red-300 bg-red-50 p-5 dark:border-red-800 dark:bg-red-950/50">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-red-900 dark:text-red-200">
                      Pre-mortem
                    </h2>
                    <p className="mt-2 text-sm italic leading-6 text-red-900 dark:text-red-100">
                      {premortem.scenario}
                    </p>
                    <ul className="mt-4 space-y-3">
                      {premortem.causes.map((c) => (
                        <li key={c.cause} className="border-t border-red-200 pt-3 dark:border-red-900">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-sm font-medium text-red-950 dark:text-red-100">
                              {c.cause}
                            </span>
                            <span className="shrink-0 font-mono text-xs uppercase text-red-700 dark:text-red-300">
                              {c.likelihood}
                            </span>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-red-900 dark:text-red-200">
                            <strong className="font-medium">Cost:</strong> {c.whatItWouldCost}
                          </p>
                          <p className="mt-0.5 text-xs leading-5 text-red-900 dark:text-red-200">
                            <strong className="font-medium">Could you have seen it coming:</strong>{" "}
                            {c.couldYouSeeItComing}
                          </p>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-4 border-t border-red-200 pt-3 dark:border-red-900">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-red-900 dark:text-red-200">
                        Answer this before spending anything
                      </h3>
                      <p className="mt-1 text-sm font-medium leading-6 text-red-950 dark:text-red-50">
                        {premortem.theQuestionToAnswerFirst}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
