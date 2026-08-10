"use client";

import { useState } from "react";
import Link from "next/link";
import { DEFAULT_INPUT, type MarginInput, type MarginResult } from "@/lib/margin";

type Field = {
  key: keyof MarginInput;
  label: string;
  hint: string;
  step?: string;
  suffix?: string;
};

type FieldGroup = { title: string; fields: Field[] };

const GROUPS: FieldGroup[] = [
  {
    title: "The listing",
    fields: [
      {
        key: "sellPrice",
        label: "Sell price",
        hint: "What the customer pays, VAT included. The number on the listing.",
        suffix: "£",
      },
      {
        key: "referralFeePct",
        label: "Referral fee",
        hint: "Amazon's cut of every sale. 5% to 15% depending on category and price band. Look yours up rather than assuming 15%.",
        suffix: "%",
      },
    ],
  },
  {
    title: "Amazon fees",
    fields: [
      {
        key: "fbaFee",
        label: "FBA fulfilment fee",
        hint: "To pick, pack and post one unit. Set by size and weight, so get the real figure from Amazon's revenue calculator. Items at £20 or under may qualify for the cheaper Low-Price FBA rate.",
        suffix: "£",
      },
      {
        key: "fuelSurchargePct",
        label: "Fuel & logistics surcharge",
        hint: "Added on top of the fulfilment fee, not the sell price. 1.5% in the UK from April 2026, against 3.5% in the US.",
        suffix: "%",
      },
      {
        key: "storagePerUnit",
        label: "Storage while held",
        hint: "Monthly storage multiplied by the months you expect to sit on it. This is how slow sellers bleed.",
        suffix: "£",
      },
    ],
  },
  {
    title: "Getting it here",
    fields: [
      {
        key: "fobUnitPrice",
        label: "FOB unit price",
        hint: "What the supplier charges per unit, loaded onto the ship. Freight to the UK is not included, which is why beginners think their margins are better than they are.",
        suffix: "£",
      },
      {
        key: "freightPerUnit",
        label: "Freight per unit",
        hint: "Total shipping cost for the consignment divided by the number of units in it.",
        suffix: "£",
      },
      {
        key: "dutyPerUnit",
        label: "Import duty per unit",
        hint: "£0 on consignments under £135 until the relief ends, expected October 2028. Do not build anything that only works while this is zero.",
        suffix: "£",
      },
      {
        key: "prepPerUnit",
        label: "UK prep and labelling",
        hint: "Barcoding, polybagging, bundling. A prep centre does this before stock reaches Amazon.",
        suffix: "£",
      },
      {
        key: "importVatRatePct",
        label: "Import VAT",
        hint: "Charged at the border on goods, freight and duty. Below £90k you cannot reclaim it, so it is a straight cost. Once registered you get it back. Leave at 20% unless you know otherwise.",
        suffix: "%",
      },
    ],
  },
  {
    title: "The lines people forget",
    fields: [
      {
        key: "returnsPct",
        label: "Returns provision",
        hint: "Money set aside for returns. 2% to 10% by category. Apparel with sizing runs 20% to 40%, which is why the rubric kills it outright.",
        suffix: "%",
      },
      {
        key: "adCostPerUnit",
        label: "Advertising per unit sold",
        hint: "Ad spend divided by units sold, not per click. The single most commonly forgotten cost. Under-funding your launch wastes the stock.",
        suffix: "£",
      },
    ],
  },
  {
    title: "Cash and pace",
    fields: [
      {
        key: "orderQty",
        label: "First order quantity",
        hint: "Units in your first bulk order. Usually dictated by the supplier's minimum order quantity.",
        step: "1",
        suffix: "units",
      },
      {
        key: "unitsPerMonth",
        label: "Expected sales",
        hint: "Your honest guess at how fast it sells. Drives the payback figure, so be pessimistic here.",
        step: "1",
        suffix: "/month",
      },
      {
        key: "totalCapital",
        label: "Total capital",
        hint: "Everything you have to spend across the whole business. Used to check no single product takes more than a quarter of it.",
        suffix: "£",
      },
      {
        key: "vatRatePct",
        label: "VAT rate",
        hint: "20% standard rate. Only bites once turnover crosses £90k and you must register.",
        suffix: "%",
      },
    ],
  },
];

const GLOSSARY: { term: string; body: string }[] = [
  {
    term: "Contribution per unit",
    body: "What you actually keep from one sale after every cost above. Not the same as profit, because it ignores fixed costs like your seller account.",
  },
  {
    term: "Net margin",
    body: "Contribution as a percentage of the sell price. The plan's floor is 15% after advertising.",
  },
  {
    term: "Margin before returns and advertising",
    body: "The same sum stopped earlier. It shows how much headroom you have to spend on ads before the product stops working. Floor is 35%.",
  },
  {
    term: "The VAT cliff",
    body: "Below £90k turnover you keep the VAT inside your price. Once registered you hand a sixth of the shelf price to HMRC. A product that only works below the threshold is a trap, so both states are modelled.",
  },
  {
    term: "Landed cost",
    body: "Supplier price plus freight plus duty plus prep plus import VAT. Everything it takes to get one unit into Amazon. Should be under 30% of the sell price.",
  },
  {
    term: "Import VAT",
    body: "Charged at the border on goods, freight and duty. It is the cost people most often leave out, because it does not appear on the supplier's invoice. Below £90k it is irrecoverable and adds around a fifth to your landed cost.",
  },
  {
    term: "Break-even units",
    body: "How many you have to sell before you have your cash back. Everything after that is return.",
  },
  {
    term: "Payback",
    body: "Break-even units at your expected pace. Cash flow kills more small sellers than thin margins do, so the ceiling is 90 days.",
  },
  {
    term: "The verdict",
    body: "TEST means order samples, not stock. PARK means the maths works but cash or pace is off. KILL means a hard threshold failed, so log the reason and stop re-finding it.",
  },
];

const gbp = (n: number) =>
  `${n < 0 ? "−" : ""}£${Math.abs(n).toFixed(2)}`;

const VERDICT_STYLE: Record<MarginResult["verdict"], string> = {
  TEST: "bg-emerald-50 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-100 dark:border-emerald-800",
  PARK: "bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-100 dark:border-amber-800",
  KILL: "bg-red-50 text-red-900 border-red-300 dark:bg-red-950 dark:text-red-100 dark:border-red-800",
};

const VERDICT_BLURB: Record<MarginResult["verdict"], string> = {
  TEST: "Every threshold cleared. Order samples, not stock.",
  PARK: "No hard threshold failed, but something below needs a decision before you commit money.",
  KILL: "At least one hard threshold failed. Log the reason so you stop re-finding this product.",
};

export default function MarginPage() {
  const [input, setInput] = useState<MarginInput>(DEFAULT_INPUT);
  const [result, setResult] = useState<MarginResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  function update(key: keyof MarginInput, raw: string) {
    setInput((prev) => ({ ...prev, [key]: raw === "" ? 0 : Number(raw) }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setErrors([]);

    try {
      // The browser sends the numbers to our own server, which does the maths
      // and sends back JSON. Open the Network tab and watch it happen.
      const response = await fetch("/api/margin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await response.json();

      if (!response.ok) {
        setErrors(data.details ?? [data.error ?? "Something went wrong"]);
        setResult(null);
      } else {
        setResult(data as MarginResult);
      }
    } catch {
      setErrors(["Could not reach the server"]);
      setResult(null);
    } finally {
      setPending(false);
    }
  }

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
          Margin engine
        </h1>
        <p className="mt-3 max-w-2xl text-zinc-600 dark:text-zinc-400">
          Every cost between the shelf price and what you actually keep, modelled
          at both VAT states. Pre-filled with the worked example from the plan.
        </p>

        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <form onSubmit={onSubmit} className="space-y-7">
            {GROUPS.map((group) => (
              <fieldset key={group.title}>
                <legend className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
                  {group.title}
                </legend>
                <div className="mt-3 space-y-3">
                  {group.fields.map((field) => (
                    <label
                      key={field.key}
                      className="flex items-start justify-between gap-3 text-sm"
                    >
                      <span className="flex-1">
                        <span className="block text-zinc-700 dark:text-zinc-300">
                          {field.label}
                        </span>
                        <span className="mt-0.5 block text-xs leading-4 text-zinc-500">
                          {field.hint}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <input
                          type="number"
                          step={field.step ?? "0.01"}
                          min="0"
                          value={input[field.key]}
                          onChange={(e) => update(field.key, e.target.value)}
                          className="w-24 rounded border border-zinc-300 bg-white px-2 py-1 text-right tabular-nums text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                        />
                        <span className="w-11 text-xs text-zinc-500">
                          {field.suffix}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={pending}
                className="rounded bg-black px-5 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-black"
              >
                {pending ? "Working…" : "Run the numbers"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setInput(DEFAULT_INPUT);
                  setResult(null);
                  setErrors([]);
                }}
                className="rounded border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
              >
                Reset
              </button>
            </div>

            {errors.length > 0 && (
              <ul className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </form>

          <section>
            {!result ? (
              <p className="rounded border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
                Press &ldquo;Run the numbers&rdquo; and the answer comes back from
                the server.
              </p>
            ) : (
              <div className="space-y-8">
                <div
                  className={`rounded border p-5 ${VERDICT_STYLE[result.verdict]}`}
                >
                  <p className="text-2xl font-semibold tracking-tight">
                    {result.verdict}
                  </p>
                  <p className="mt-1 text-sm opacity-90">
                    {VERDICT_BLURB[result.verdict]}
                  </p>
                </div>

                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
                    Where the money goes
                  </h2>
                  <table className="mt-3 w-full text-sm">
                    <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                      {result.waterfall.map((line) => (
                        <tr key={line.label}>
                          <td className="py-2 pr-4 align-top text-zinc-700 dark:text-zinc-300">
                            {line.label}
                            {line.note && (
                              <span className="block text-xs text-zinc-500">
                                {line.note}
                              </span>
                            )}
                          </td>
                          <td className="py-2 text-right align-top tabular-nums text-zinc-900 dark:text-zinc-100">
                            {gbp(line.amount)}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-zinc-400 dark:border-zinc-600">
                        <td className="py-2 font-semibold text-black dark:text-zinc-50">
                          Contribution per unit
                        </td>
                        <td className="py-2 text-right font-semibold tabular-nums text-black dark:text-zinc-50">
                          {gbp(result.contribution)}{" "}
                          <span className="font-normal text-zinc-500">
                            ({result.netMarginPct.toFixed(1)}%)
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="rounded border border-amber-300 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-950/50">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-200">
                    The VAT cliff
                  </h2>
                  <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-zinc-600 dark:text-zinc-400">
                        Below £90k threshold
                      </p>
                      <p className="mt-1 text-xl font-semibold tabular-nums text-black dark:text-zinc-50">
                        {gbp(result.contribution)}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {result.netMarginPct.toFixed(1)}% net
                      </p>
                    </div>
                    <div>
                      <p className="text-zinc-600 dark:text-zinc-400">
                        VAT-registered
                      </p>
                      <p className="mt-1 text-xl font-semibold tabular-nums text-black dark:text-zinc-50">
                        {gbp(result.contributionVatRegistered)}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {result.netMarginVatRegisteredPct.toFixed(1)}% net
                      </p>
                    </div>
                  </div>
                  <p className="mt-4 text-sm text-amber-900 dark:text-amber-200">
                    Crossing £90k without repricing costs you{" "}
                    <strong>{result.vatCliffDropPct.toFixed(0)}%</strong> of your
                    margin overnight.
                  </p>
                  <p className="mt-2 text-xs leading-5 text-amber-800 dark:text-amber-300/80">
                    Both legs are modelled: registering means you owe output VAT
                    but reclaim import VAT on stock. Still simplified — VAT on
                    Amazon&rsquo;s own fees is not included, so the registered
                    column remains slightly conservative.
                  </p>
                </div>

                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
                    Against your thresholds
                  </h2>
                  <table className="mt-3 w-full text-sm">
                    <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                      {result.checks.map((check) => (
                        <tr key={check.label}>
                          <td className="w-6 py-2 align-top">
                            <span
                              className={
                                check.pass
                                  ? "text-emerald-600"
                                  : check.hard
                                    ? "text-red-600"
                                    : "text-amber-600"
                              }
                            >
                              {check.pass ? "✓" : check.hard ? "✕" : "!"}
                            </span>
                          </td>
                          <td className="py-2 pr-4 text-zinc-700 dark:text-zinc-300">
                            {check.label}
                            {!check.pass && check.note && (
                              <span className="mt-0.5 block text-xs leading-4 text-zinc-500">
                                {check.note}
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums text-zinc-900 dark:text-zinc-100">
                            {check.actual}
                          </td>
                          <td className="py-2 text-right tabular-nums text-zinc-500">
                            {check.threshold}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
                    Cash
                  </h2>
                  <dl className="mt-3 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                    {[
                      ["Cash tied up", gbp(result.cashTiedUp)],
                      [
                        "Break-even",
                        Number.isFinite(result.breakEvenUnits)
                          ? `${result.breakEvenUnits} units`
                          : "never",
                      ],
                      [
                        "Payback",
                        Number.isFinite(result.daysToPayback)
                          ? `${result.daysToPayback} days`
                          : "never",
                      ],
                      ["Landed cost", `${result.landedCostPctOfSell.toFixed(1)}%`],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-zinc-500">{label}</dt>
                        <dd className="mt-1 text-lg font-semibold tabular-nums text-black dark:text-zinc-50">
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            )}
          </section>
        </div>

        <section className="mt-16 border-t border-zinc-200 pt-8 dark:border-zinc-800">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            How to read the results
          </h2>
          <dl className="mt-4 grid gap-x-10 gap-y-4 sm:grid-cols-2">
            {GLOSSARY.map((entry) => (
              <div key={entry.term}>
                <dt className="text-sm font-medium text-black dark:text-zinc-100">
                  {entry.term}
                </dt>
                <dd className="mt-0.5 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
                  {entry.body}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-8 rounded border border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
            <h3 className="text-sm font-medium text-black dark:text-zinc-100">
              Two things this engine does not know
            </h3>
            <ul className="mt-2 space-y-1.5 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
              <li>
                <strong className="font-medium">Input VAT recovery.</strong> Once
                registered you reclaim VAT on imported stock and on Amazon&rsquo;s
                fees. That is not modelled, so the VAT-registered column is
                pessimistic. How pessimistic is a question for an accountant.
              </li>
              <li>
                <strong className="font-medium">Whether your inputs are real.</strong>{" "}
                It will happily calculate a beautiful margin from numbers you
                guessed. The fulfilment fee, the freight cost and the ad spend are
                the three most commonly wrong, and all three are checkable.
              </li>
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}
