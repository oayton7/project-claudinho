/**
 * The one place the Anthropic API key is used.
 *
 * This file must only ever be imported by code under src/app/api/. If it is
 * imported by a page or component, the key ends up in the JavaScript bundle
 * the browser downloads, which is the same as publishing it. Next.js will not
 * stop you doing that, so the discipline is yours.
 */
import Anthropic from "@anthropic-ai/sdk";
import { describeError } from "./errors";

export const MODEL = "claude-opus-5";

/** Claude Opus 5, $ per million tokens. */
const PRICE_PER_MTOK = { input: 5, output: 25 } as const;

/**
 * A crude guard against a runaway loop emptying the prepaid balance. The
 * process restarting resets it, so it is a seatbelt rather than a budget.
 */
const CALL_LIMIT_PER_HOUR = 40;
const calls: number[] = [];

export class RateLimited extends Error {}
export class MissingApiKey extends Error {}

function checkRate() {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  while (calls.length > 0 && calls[0] < hourAgo) calls.shift();
  if (calls.length >= CALL_LIMIT_PER_HOUR) {
    throw new RateLimited(
      `Hit the local guard of ${CALL_LIMIT_PER_HOUR} calls per hour. This exists to stop a bug emptying your API credit. Wait, or raise the limit in src/lib/claude.ts.`,
    );
  }
  calls.push(Date.now());
}

export function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new MissingApiKey(
      "ANTHROPIC_API_KEY is not set. Locally that means .env.local; in production it means the Vercel project's environment variables.",
    );
  }
  return new Anthropic();
}

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costPence: number;
};



export function priceIt(usage: {
  input_tokens: number;
  output_tokens: number;
}): Usage {
  const costUsd =
    (usage.input_tokens / 1_000_000) * PRICE_PER_MTOK.input +
    (usage.output_tokens / 1_000_000) * PRICE_PER_MTOK.output;

  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    costUsd: Math.round(costUsd * 10000) / 10000,
    // Rough GBP conversion. Good enough to notice a problem, not for accounts.
    costPence: Math.round(costUsd * 0.79 * 100 * 100) / 100,
  };
}

/**
 * Wraps every call so the guard cannot be bypassed by forgetting it.
 *
 * Two guards now, and only the second is real. The in-process counter catches
 * a runaway loop inside one invocation; the database counter is the one that
 * holds across the many processes Vercel runs, where a per-process limit of 40
 * an hour was really no limit at all.
 */
export async function guarded<T>(fn: (client: Anthropic) => Promise<T>): Promise<T> {
  const client = getClient();
  checkRate();

  const { checkApiBudget } = await import("./db");
  const budget = await checkApiBudget("judge", CALL_LIMIT_PER_HOUR);
  if (!budget.allowed) {
    throw new RateLimited(
      `${budget.callsThisHour} deep judgements already this hour, against a limit of ${CALL_LIMIT_PER_HOUR}. At roughly 10p each that is about £${((budget.callsThisHour * 10) / 100).toFixed(2)} of spend. Counted in the database, so it holds across every serverless instance rather than per process. Raise it in src/lib/claude.ts.`,
    );
  }

  return fn(client);
}

/**
 * The triage model.
 *
 * Judging with Opus costs about 11p and ninety seconds per product, which is
 * fine for five products and impossible for a hundred. This is the cheap first
 * pass: same rubric, a verdict and one line instead of a full analysis.
 *
 * Sonnet rather than Haiku, and the reason is not the headline price. Haiku is
 * cheaper per token but its minimum cacheable prompt is 4,096 tokens, and the
 * rubric is about 1,800 — so the cache silently never engages and every call
 * pays full price for it. Sonnet caches from 1,024. That closes the gap to
 * roughly 0.05p per product, which is not worth the drop in judgement.
 */
export const TRIAGE_MODEL = "claude-sonnet-5";

/**
 * Introductory Sonnet 5 pricing, which runs until 31 August 2026. After that
 * it becomes $3 / $15, so triage gets about 50% dearer and is still trivial
 * next to Opus. Update these two numbers then.
 */
const TRIAGE_PRICE_PER_MTOK = { input: 2, output: 10 };

/**
 * Triage is roughly fifty times cheaper per call than a full judgement, so it
 * gets its own, much higher ceiling. The point of the guard is to stop a bug
 * emptying the balance, and a bug here does far less damage per call.
 */
const TRIAGE_LIMIT_PER_HOUR = 400;
const triageCalls: number[] = [];

function checkTriageRate() {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  while (triageCalls.length > 0 && triageCalls[0] < hourAgo) triageCalls.shift();
  if (triageCalls.length >= TRIAGE_LIMIT_PER_HOUR) {
    throw new RateLimited(
      `Hit the triage guard of ${TRIAGE_LIMIT_PER_HOUR} calls per hour. At roughly 0.2p each that is about 80p of spend, so this is a bug guard rather than a budget. Wait, or raise it in src/lib/claude.ts.`,
    );
  }
  triageCalls.push(Date.now());
}

export function priceTriage(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): Usage {
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;

  // Cached reads bill at a tenth of the input rate; the first write costs a
  // premium of a quarter. Two calls and the cache has already paid for itself.
  const costUsd =
    (usage.input_tokens / 1_000_000) * TRIAGE_PRICE_PER_MTOK.input +
    (cacheRead / 1_000_000) * TRIAGE_PRICE_PER_MTOK.input * 0.1 +
    (cacheWrite / 1_000_000) * TRIAGE_PRICE_PER_MTOK.input * 1.25 +
    (usage.output_tokens / 1_000_000) * TRIAGE_PRICE_PER_MTOK.output;

  return {
    inputTokens: usage.input_tokens + cacheRead + cacheWrite,
    outputTokens: usage.output_tokens,
    costUsd: Math.round(costUsd * 100000) / 100000,
    costPence: Math.round(costUsd * 0.79 * 100 * 100) / 100,
  };
}

export async function guardedTriage<T>(
  fn: (client: Anthropic) => Promise<T>,
): Promise<T> {
  const client = getClient();
  checkTriageRate();

  const { checkApiBudget } = await import("./db");
  const budget = await checkApiBudget("triage", TRIAGE_LIMIT_PER_HOUR);
  if (!budget.allowed) {
    throw new RateLimited(
      `${budget.callsThisHour} triage calls already this hour, against a limit of ${TRIAGE_LIMIT_PER_HOUR}. At roughly 0.2p each that is about ${(budget.callsThisHour * 0.2).toFixed(0)}p — a bug guard rather than a budget. Wait, or raise it in src/lib/claude.ts.`,
    );
  }

  return fn(client);
}

export { describeError } from "./errors";
