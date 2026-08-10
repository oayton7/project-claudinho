/**
 * The one place the Anthropic API key is used.
 *
 * This file must only ever be imported by code under src/app/api/. If it is
 * imported by a page or component, the key ends up in the JavaScript bundle
 * the browser downloads, which is the same as publishing it. Next.js will not
 * stop you doing that, so the discipline is yours.
 */
import Anthropic from "@anthropic-ai/sdk";

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

/**
 * Anthropic's own error text, safe to show. It names the actual problem —
 * invalid key, credit exhausted, rate limited — instead of the useless
 * "something went wrong" that had us guessing at timeouts for an hour.
 * The key itself never appears in these messages.
 */
export function describeError(error: unknown): string {
  if (error instanceof Anthropic.APIError) {
    const status = error.status ? `${error.status}: ` : "";
    return `Anthropic API said — ${status}${error.message}`;
  }
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

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

/** Wraps every call so the guard cannot be bypassed by forgetting it. */
export async function guarded<T>(fn: (client: Anthropic) => Promise<T>): Promise<T> {
  const client = getClient();
  checkRate();
  return fn(client);
}
