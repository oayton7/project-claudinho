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

function Step({
  n,
  title,
  cost,
  children,
}: {
  n: string;
  title: string;
  cost: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-semibold text-zinc-900 dark:text-zinc-100">
          {n}. {title}
        </span>
        <span className="text-xs text-zinc-500">{cost}</span>
      </div>
      <p className="mt-1 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
        {children}
      </p>
    </div>
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

        <Chapter n={1} title="Setting the business up">
          <p>
            Checked against gov.uk on 25 August 2026. Order matters here: each
            step needs something the one before it produces, and doing them out
            of sequence means waiting.
          </p>

          <Step
            n="1"
            title="Verify your identity, before anything else"
            cost="Free"
          >
            Mandatory for every director and person with significant control
            since 18 November 2025, and it has to happen{" "}
            <strong>before</strong> you can register a company. Do it through
            GOV.UK One Login, which routes you to an app, online security
            questions, or photo ID at a participating Post Office. You come out
            with a <strong>Companies House personal code</strong>. Keep it as
            carefully as a UTR.
            <br />
            <span className="text-zinc-500">
              The trap: most company formation guides online still predate this
              and tell you to start at registration. You will get stuck.
            </span>
          </Step>

          <Step n="2" title="Register the company" cost="£100, live within 24 hours">
            Online with Companies House. You need the company name, a registered
            office address, your director details and personal code, the
            shareholding, and anyone with more than 25% of shares or votes
            recorded as a PSC. For SIC code, <strong>47910</strong> is retail
            sale via mail order or internet, which is what selling on Amazon is.
            47990 and 46499 are the near neighbours if you want alternatives.
            <br />
            <span className="text-zinc-500">
              Two traps. The fee is £100, not the £50 half the internet still
              quotes. And your registered office address goes on the public
              register, so do not use your home address unless you are content
              with it being searchable forever.
            </span>
          </Step>

          <Step n="3" title="Tick the Corporation Tax box while you are there" cost="Free">
            Registration offers to set you up for Corporation Tax at the same
            time. It is an <strong>option, not automatic</strong>. Take it,
            because it produces the UTR that the next step depends on. Miss it
            and you have to add Corporation Tax services to your business tax
            account separately and wait again.
          </Step>

          <Step n="4" title="Get a GB EORI number" cost="Free, usually immediate">
            You cannot import without one. It needs your UTR, your business
            start date, your SIC code, and your VAT number if you have one.
            Normally issued immediately; up to five working days if HMRC decides
            to check something.
            <br />
            <span className="text-zinc-500">
              The trap: it needs the UTR, so it cannot be done first. This is
              the step that catches people who leave it until the freight is
              already moving.
            </span>
          </Step>

          <Step n="5" title="Decide about VAT, and probably wait" cost="Free">
            You must register once turnover passes <strong>£90,000</strong> in
            any twelve months, or if you expect to pass it within 30 days. Below
            that it is voluntary.
            <br />
            My read for where you are: do not register voluntarily yet. Chapter
            3 shows what it does to what you can pay a supplier, and on a £20
            product it takes roughly a third of your headroom. The counter is
            that registering lets you reclaim import VAT on stock, which is real
            money on a first order. Which way it nets out depends on your
            margins and volume, and it is a genuine accountant question rather
            than one to guess at.
          </Step>

          <p className="pt-2">
            After that it is a business bank account and the Amazon
            Professional seller account, neither of which is gov.uk, and the
            Amazon one will want the company number and the bank details you
            just created.
          </p>

          <h3 className="pt-2 font-semibold text-zinc-900 dark:text-zinc-100">
            What it costs while you are earning nothing
          </h3>
          <p>
            Tax is charged on profit, so no sales means no Corporation Tax and
            no VAT. But a company is not free to keep alive, and the obligations
            do not pause because you have not started.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Confirmation statement, £50 a year.</strong> Due
              annually whether or not you have traded. It rose from £34 on 1
              February 2026.
            </li>
            <li>
              <strong>Annual accounts, free to file, compulsory to file.</strong>{" "}
              A company that has never traded files dormant accounts, which are
              short, but they still have to arrive.
            </li>
            <li>
              <strong>A Corporation Tax return, if HMRC asks for one.</strong>{" "}
              Once they issue a notice to deliver, you file it or you tell them
              the company is dormant. Ignoring it is not an option.
            </li>
          </ul>
          <p>
            The real risk of a dormant company is not the fees, it is
            forgetting it exists. Filing accounts late costs{" "}
            <strong>£150</strong> up to a month, £375 to three months, £750 to
            six, and £1,500 beyond that — and it{" "}
            <strong>doubles if you are late two years running</strong>. That is
            a bigger number than anything else on this page, and it is charged
            on a company earning nothing.
          </p>
          <p>
            So do not incorporate months before you need to. The company is
            worth starting when you are close to placing a first order, because
            that is when the EORI and the bank account matter. If you are only
            exploring, you have not lost anything by waiting.
          </p>
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
