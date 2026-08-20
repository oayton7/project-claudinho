/**
 * /playbook — the Coach, which is the third of the plan's three jobs and the
 * one that had never been built.
 *
 * The plan is specific about the shape: teach the relevant piece at the point
 * of decision, rather than front-loading a syllabus nobody finishes. So the
 * chapters that the code already owns the facts for are **generated from the
 * code itself** — the fee map is rendered from the same table the margin
 * engine charges from, and the VAT chapter runs the real engine at real
 * prices. Documentation written by hand drifts from the code within weeks and
 * then quietly misleads. This cannot: change a fee and this page changes.
 *
 * The chapters the code does not own the facts for are listed honestly as
 * outstanding, with what is needed. Writing plausible regulatory detail from
 * memory is exactly how a tool ends up confidently wrong about something
 * expensive.
 *
 * A server component, and deliberately importing only pure modules. fees.ts
 * and margin.ts hold no secrets; claude.ts and db.ts must never be imported
 * from a page.
 */
import Link from "next/link";
import {
  FEE_CATEGORY_LABELS,
  FEE_TABLE_VERSION,
  FBA_TIERS,
  REFERRAL_BANDS,
  DIGITAL_SERVICES_FEE_PCT,
  MINIMUM_REFERRAL_FEE,
  lowPriceThresholdFor,
  type FeeCategory,
} from "@/lib/fees";
import {
  maxLandedCostBothVatStates,
  orderCostAtMoq,
  maxLandedCost,
  CAPITAL_CAP_PCT,
  DEFAULT_INPUT,
} from "@/lib/margin";

export const metadata = { title: "Playbook" };

const money = (n: number) => `£${n.toFixed(2)}`;

function Chapter({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10 border-t border-zinc-200 pt-8 dark:border-zinc-800">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        <span className="mr-2 text-zinc-400">{n}.</span>
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
        {children}
      </div>
    </section>
  );
}

function Outstanding({ needs }: { needs: string }) {
  return (
    <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      <strong>Not written yet.</strong> {needs} Left blank on purpose: a
      confident-sounding guess about a rule that costs money is worse than an
      empty chapter.
    </p>
  );
}

export default function PlaybookPage() {
  // Worked live, so the examples can never disagree with the engine.
  const examplePrices = [12, 18, 25, 40];
  const vatRows = examplePrices.map((p) => ({
    price: p,
    ...maxLandedCostBothVatStates(p, { feeCategory: "home", packageWeightG: 400 }),
  }));

  const ceiling = maxLandedCost(24.99, { feeCategory: "home", packageWeightG: 400 });
  const orders = orderCostAtMoq(ceiling.landed, DEFAULT_INPUT.totalCapital);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-900">
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link href="/" className="text-sm underline">
          ← Home
        </Link>

        <h1 className="mt-4 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
          Playbook
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          The chapters below marked with live figures are generated from the
          same tables the margin engine charges from, so they cannot drift from
          what the tool actually calculates. Fee tables verified{" "}
          {FEE_TABLE_VERSION}. Amazon moved them twice in 2026, so treat that
          date as an expiry rather than a signature.
        </p>

        <Chapter n={1} title="Account setup">
          <Outstanding needs="Professional account, EORI number, and the verification traps." />
        </Chapter>

        <Chapter n={2} title="The fee map">
          <p>
            Three fees come out of every sale, plus one that catches people out.
            Referral is a percentage of the whole price including VAT. FBA is a
            flat rate by size tier, so <strong>box dimensions matter before
            weight does</strong>. The Digital Services Fee is{" "}
            {DIGITAL_SERVICES_FEE_PCT}% charged on top of the other two rather
            than on the sale, which is the one most people forget. Referral
            never falls below {money(MINIMUM_REFERRAL_FEE)}.
          </p>

          <h3 className="pt-2 font-semibold text-zinc-900 dark:text-zinc-100">
            Referral, by category
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-1 pr-4 font-medium">Category</th>
                  <th className="py-1 pr-4 font-medium">Rate</th>
                  <th className="py-1 font-medium">Low-Price FBA under</th>
                </tr>
              </thead>
              <tbody className="align-top">
                {(Object.keys(REFERRAL_BANDS) as FeeCategory[]).map((c) => (
                  <tr key={c} className="border-t border-zinc-200 dark:border-zinc-800">
                    <td className="py-1 pr-4">{FEE_CATEGORY_LABELS[c]}</td>
                    <td className="py-1 pr-4 tabular-nums">
                      {REFERRAL_BANDS[c]
                        .map((b) =>
                          Number.isFinite(b.upTo)
                            ? `${b.pct}% to £${b.upTo}`
                            : `${b.pct}%`,
                        )
                        .join(", then ")}
                    </td>
                    <td className="py-1 tabular-nums">
                      £{lowPriceThresholdFor(c)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="pt-2 font-semibold text-zinc-900 dark:text-zinc-100">
            FBA, by size tier
          </h3>
          <p>
            The tier is decided by the longest edge first, then weight. A box a
            few millimetres over drops you a tier and costs more than the
            product often earns.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-1 pr-4 font-medium">Tier</th>
                  <th className="py-1 pr-4 font-medium">Max box (mm)</th>
                  <th className="py-1 pr-4 font-medium">Max weight</th>
                  <th className="py-1 pr-4 font-medium">Standard</th>
                  <th className="py-1 font-medium">Low-Price</th>
                </tr>
              </thead>
              <tbody>
                {FBA_TIERS.map((t, i) => (
                  <tr key={i} className="border-t border-zinc-200 dark:border-zinc-800">
                    <td className="py-1 pr-4">{t.name}</td>
                    <td className="py-1 pr-4 tabular-nums">{t.mm.join(" × ")}</td>
                    <td className="py-1 pr-4 tabular-nums">{t.maxG}g</td>
                    <td className="py-1 pr-4 tabular-nums">{money(t.standard)}</td>
                    <td className="py-1 tabular-nums">
                      {t.lowPrice === null ? "—" : money(t.lowPrice)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Chapter>

        <Chapter n={3} title="VAT, and the cliff">
          <p>
            Below £90,000 of turnover you charge VAT to nobody and keep the
            whole shelf price. Cross it and the VAT comes out of the same price,
            so your margin falls overnight without a single cost changing. You
            do get import VAT back, which softens it, but not by as much as the
            output VAT takes.
          </p>
          <p>
            What that does to the most you can pay a supplier, run through the
            live engine on a 400g Home &amp; Kitchen product:
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-1 pr-4 font-medium">Shelf price</th>
                  <th className="py-1 pr-4 font-medium">Ceiling below</th>
                  <th className="py-1 pr-4 font-medium">Ceiling registered</th>
                  <th className="py-1 font-medium">Fall</th>
                </tr>
              </thead>
              <tbody>
                {vatRows.map((r) => (
                  <tr
                    key={r.price}
                    className="border-t border-zinc-200 dark:border-zinc-800"
                  >
                    <td className="py-1 pr-4 tabular-nums">{money(r.price)}</td>
                    <td className="py-1 pr-4 tabular-nums">
                      {money(r.marginOnlyBelow)}
                    </td>
                    <td className="py-1 pr-4 tabular-nums">
                      {money(r.marginOnlyRegistered)}
                    </td>
                    <td className="py-1 tabular-nums">
                      {r.dropPct.toFixed(0)}%
                      {r.onlyWorksBelowThreshold ? " — nothing left" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The pattern is the point: <strong>the cheaper the product, the
            harder the cliff hits</strong>, because the VAT taken out of a £12
            price is a far bigger share of the headroom than out of a £40 one.
            A product that only works below the threshold is a trap rather than
            an opportunity, and the Judge is told to say so.
          </p>
          <p>
            These are ceilings against the margin floor, not quotes. The
            supplier ceiling the tool gives you elsewhere applies the capital
            cap as well and is usually lower.
          </p>
          <p>
            Registering voluntarily early lets you reclaim import VAT on stock.
            Whether it nets out depends on your margins and volume, and it is a
            genuine accountant question rather than something to guess at.
          </p>
        </Chapter>

        <Chapter n={4} title="Capital, and what an order actually costs">
          <p>
            The rule is that no single order takes more than {CAPITAL_CAP_PCT}%
            of working capital, against {money(DEFAULT_INPUT.totalCapital)}. It
            is a warning rather than a kill, because &quot;needs more money than
            you have&quot; is a decision rather than a fact.
          </p>
          <p>
            Priced at the landed ceiling for a £24.99 product,{" "}
            {money(ceiling.landed)} a unit, at the MOQs suppliers actually
            quote:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            {orders.map((o) => (
              <li key={o.units} className="tabular-nums">
                {o.units} units: {money(o.cost)} ({o.pctOfCapital.toFixed(0)}% of
                capital)
                {o.withinCap ? "" : ` — needs ${money(o.shortfall)} more`}
              </li>
            ))}
          </ul>
          <p>
            This is why MOQ negotiation matters more than unit price at this
            size. The difference between 300 and 500 units is usually the
            difference between a product you can fund and one you cannot.
          </p>
        </Chapter>

        <Chapter n={5} title="Importing">
          <Outstanding needs="HS codes, freight forwarders, DDP against FOB, prep centres, and the current state of the £135 relief." />
        </Chapter>

        <Chapter n={6} title="Compliance by category">
          <Outstanding needs="UKCA marking, what needs testing, and what to avoid entirely." />
        </Chapter>

        <Chapter n={7} title="Sourcing">
          <Outstanding needs="Vetting suppliers, the sample protocol, negotiating MOQ, QC, and the classic scams." />
        </Chapter>

        <Chapter n={8} title="Listing mechanics">
          <Outstanding needs="Keywords, images, A+ content, and the first-review problem." />
        </Chapter>

        <Chapter n={9} title="Launch">
          <Outstanding needs="PPC structure, budget, and what good looks like in week one." />
        </Chapter>

        <Chapter n={10} title="The pitfalls file">
          <p>
            Every mistake, written down as it happens. The plan reckons this is
            the most valuable chapter by month six, and it only works if it is
            kept honestly.
          </p>
          <Outstanding needs="Yours to fill in, as things go wrong." />
        </Chapter>
      </main>
    </div>
  );
}
