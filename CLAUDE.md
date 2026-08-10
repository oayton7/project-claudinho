# Project Claudinho — product-finder

Amazon UK product scout and qualifier. Scout finds candidates, Judge scores
them against a rubric, Coach teaches at the point of decision. Next.js 16
(App Router), TypeScript, Tailwind 4, Anthropic SDK.

@AGENTS.md

## Source of truth

- The canonical plan is `../product-finder-full-plan.md` (UK market, 2026
  fees). Section 6 defines the margin maths, section 16 is the running build
  log, section 17 is the product thesis. When code and plan disagree, flag it
  before changing either.
- `../product-qualifier-plan.md` is the superseded US version. Ignore it.
- The "≥15% net margin if VAT-registered" rule is a warning, not a kill
  (Oscar's call, 10 Aug 2026). The worked example verdict is PARK.

## How to work with Oscar

- Claude writes the code, Oscar sets requirements. Explain what you are doing
  in plain terms as you go, so he learns the concepts without typing the code.
- British English everywhere, including UI copy and comments. Currency is GBP.
- Direct over polite, short over long. No em-dashes, no exclamation marks,
  no corporate buzzwords.
- Ask before assuming. If a requirement is ambiguous, check.

## Commands

Node is installed via nvm. If a command fails with "node: command not found",
run `. "$HOME/.nvm/nvm.sh"` first.

- `npm run dev` — local dev server
- `npm run lint` — ESLint
- `npm run build` — production build; run before pushing
- `npm run verify` — pins the margin engine to the plan's section 6 worked
  example. Run it after any change to `src/lib/margin.ts`. If it fails, the
  code is wrong or the plan changed; find out which before "fixing" the test.

## Deploy

`git push` to `github.com/oayton7/project-claudinho` is the deploy. Vercel
builds from main and serves https://project-claudinho.vercel.app (public).
Do not use the Vercel connector tools for this project; the token is broken.
Never push without a passing `npm run build` and `npm run verify`.

## Architecture rules

- `src/lib/margin.ts` is pure arithmetic: no network calls, no AI, no
  dependencies beyond the language. Every number it produces must be
  reproducible by hand on paper. Keep it that way.
- `src/lib/claude.ts` is the only file that touches the Anthropic API key,
  and it may only be imported from code under `src/app/api/`. Importing it
  from a page or component leaks the key into the browser bundle.
- All Claude responses are validated with zod before use. Never trust raw
  model output shape.
- Server-side secrets live in `.env.local` (gitignored) locally and in
  Vercel env vars in production. Never create a `NEXT_PUBLIC_` variable for
  anything secret.
- The per-hour call guard in `src/lib/claude.ts` protects Oscar's API
  balance. Do not remove or raise it without asking him.

## Coding rules

- TypeScript strict; no `any`, no `@ts-ignore`. Model data with explicit
  types like `MarginInput` and `MarginResult`, and keep them exported.
- Match the existing comment style: comments explain the business reason or
  constraint (why import VAT is irrecoverable below the threshold), not what
  the next line does.
- Keep the structure flat: pages in `src/app/`, API routes in
  `src/app/api/`, shared logic in `src/lib/`. No new top-level folders
  without a reason.
- Prefer small pure functions that can be tested against worked examples
  over abstractions. This codebase optimises for Oscar being able to read
  and check it, not for generality.
- Money is `number` in pounds throughout. Round only at display time.
- Error messages should tell the user what to do next, in plain English,
  the way `MissingApiKey` and `RateLimited` already do.
