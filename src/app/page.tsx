import Link from "next/link";

const phases = [
  { n: 0, name: "Setup", detail: "Node, git, project scaffold", done: true },
  { n: 1, name: "Live on the internet", detail: "This page, on Vercel", done: true },
  { n: 2, name: "Margin engine", detail: "Contribution, break-even, both VAT states", done: true },
  { n: 3, name: "Claude scoring", detail: "Improvability and pre-mortem", done: true },
  { n: 4, name: "Database", detail: "Save products, pipeline board", done: true },
  { n: 5, name: "Logins", detail: "Supabase auth, row-level security", done: false },
  { n: 6, name: "The Scout", detail: "Keepa search, an unattended sweep, US growth check", done: true },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-2xl flex-1 px-6 py-20 sm:px-10">
        <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">
          Project Claudinho
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Amazon UK Product Scout &amp; Qualifier
        </h1>
        <p className="mt-4 max-w-lg text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Finds candidate products, qualifies them against a hard rubric, and
          argues with you before you spend money.
        </p>

        <h2 className="mt-14 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Build progress
        </h2>
        <ol className="mt-4 divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {phases.map((phase) => (
            <li key={phase.n} className="flex items-baseline gap-4 py-3">
              <span
                className={`w-6 shrink-0 font-mono text-sm ${
                  phase.done ? "text-emerald-600" : "text-zinc-400"
                }`}
              >
                {phase.done ? "✓" : phase.n}
              </span>
              <span className="flex-1">
                <span
                  className={`font-medium ${
                    phase.done
                      ? "text-zinc-500 line-through dark:text-zinc-500"
                      : "text-black dark:text-zinc-100"
                  }`}
                >
                  {phase.name}
                </span>
                <span className="ml-2 text-sm text-zinc-500">{phase.detail}</span>
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/shortlist"
            className="rounded bg-black px-5 py-2.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-black"
          >
            Shortlist →
          </Link>
          <Link
            href="/sweep"
            className="rounded border border-zinc-400 px-5 py-2.5 text-sm font-medium text-zinc-800 dark:border-zinc-600 dark:text-zinc-200"
          >
            Sweep →
          </Link>
          <Link
            href="/scout"
            className="rounded border border-zinc-400 px-5 py-2.5 text-sm font-medium text-zinc-800 dark:border-zinc-600 dark:text-zinc-200"
          >
            Scout →
          </Link>
          <Link
            href="/margin"
            className="rounded border border-zinc-400 px-5 py-2.5 text-sm font-medium text-zinc-800 dark:border-zinc-600 dark:text-zinc-200"
          >
            Margin engine →
          </Link>
          <Link
            href="/judge"
            className="rounded border border-zinc-400 px-5 py-2.5 text-sm font-medium text-zinc-800 dark:border-zinc-600 dark:text-zinc-200"
          >
            The Judge →
          </Link>
          <Link
            href="/products"
            className="rounded border border-zinc-400 px-5 py-2.5 text-sm font-medium text-zinc-800 dark:border-zinc-600 dark:text-zinc-200"
          >
            Products →
          </Link>
          <Link
            href="/reviews"
            className="rounded border border-zinc-400 px-5 py-2.5 text-sm font-medium text-zinc-800 dark:border-zinc-600 dark:text-zinc-200"
          >
            Reviews →
          </Link>
          <Link
            href="/triage"
            className="rounded border border-zinc-400 px-5 py-2.5 text-sm font-medium text-zinc-800 dark:border-zinc-600 dark:text-zinc-200"
          >
            Triage check →
          </Link>
          <Link
            href="/keepa"
            className="rounded border border-zinc-400 px-5 py-2.5 text-sm font-medium text-zinc-800 dark:border-zinc-600 dark:text-zinc-200"
          >
            Keepa check →
          </Link>
        </div>

        <p className="mt-6 text-sm text-zinc-500">
          Next up: reading three-star reviews into the Judge, then logins.
        </p>
      </main>
    </div>
  );
}
