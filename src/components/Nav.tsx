"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

/**
 * One navigation bar, on every page, in the order the work actually happens.
 *
 * Every page had grown its own header and the only full list of destinations
 * was eleven buttons at the bottom of the home page, so finding anything meant
 * going home first. The order here is the workflow: find, read, decide,
 * pursue, and the reference you need while doing it.
 *
 * The rest are real tools but they are workbench tools, used when something
 * needs checking by hand, so they sit behind More rather than competing for
 * attention with the five things you do every time.
 */

const MAIN = [
  { href: "/shortlist", name: "Shortlist" },
  { href: "/runs", name: "Runs" },
  { href: "/reviews", name: "Reviews" },
  { href: "/products", name: "Products" },
  { href: "/playbook", name: "Playbook" },
];

const MORE = [
  { href: "/margin", name: "Margin engine" },
  { href: "/scout", name: "Scout" },
  { href: "/sweep", name: "Sweep" },
  { href: "/judge", name: "The Judge" },
  { href: "/triage", name: "Triage check" },
  { href: "/keepa", name: "Keepa check" },
];

export default function Nav() {
  const pathname = usePathname() ?? "/";
  const [openMore, setOpenMore] = useState(false);

  // The login page is its own world: showing navigation to somebody who
  // cannot follow any of it is just noise.
  if (pathname.startsWith("/login")) return null;

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-black/90">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-8 gap-y-3 px-6 py-4 sm:px-10">
        <Link
          href="/"
          className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 hover:text-black dark:hover:text-zinc-100"
        >
          Claudinho
        </Link>

        <nav className="flex flex-wrap items-center gap-x-7 gap-y-2">
          {MAIN.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`border-b-2 pb-1 text-sm transition-colors ${
                  active
                    ? "border-black font-semibold text-black dark:border-zinc-100 dark:text-zinc-100"
                    : "border-transparent text-zinc-500 hover:text-black dark:hover:text-zinc-100"
                }`}
              >
                {item.name}
              </Link>
            );
          })}

          <div className="relative">
            <button
              type="button"
              onClick={() => setOpenMore((v) => !v)}
              aria-expanded={openMore}
              className="border-b-2 border-transparent pb-1 text-sm text-zinc-500 hover:text-black dark:hover:text-zinc-100"
            >
              More {openMore ? "↑" : "↓"}
            </button>

            {openMore && (
              <div className="absolute left-0 top-9 w-56 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                {MORE.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpenMore(false)}
                    className="block rounded-lg px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    {item.name}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
