import Link from "next/link";

const phases = [
  { n: 0, name: "Setup", detail: "Node, git, project scaffold", done: true },
  { n: 1, name: "Live on the internet", detail: "This page, on Vercel", done: true },
  { n: 2, name: "Margin engine", detail: "Contribution, break-even, both VAT states", done: true },
  { n: 3, name: "Claude scoring", detail: "Marketability and pre-mortem", done: false },
  { n: 4, name: "Database", detail: "Save products, pipeline board", done: false },
  { n: 5, name: "Logins", detail: "Supabase auth, row-level security", done: false },
  { n: 6, name: "The Scout", detail: "Keepa plus the US to UK arbitrage signal", done: false },
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

        <Link
          href="/margin"
          className="mt-10 inline-block rounded bg-black px-5 py-2.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-black"
        >
          Open the margin engine →
        </Link>

        <p className="mt-6 text-sm text-zinc-500">
          Next up: Claude scores marketability and runs the pre-mortem. Set a hard
          billing cap before that session starts.
        </p>
      </main>
    </div>
  );
}
