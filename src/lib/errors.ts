import Anthropic from "@anthropic-ai/sdk";

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

  if (error instanceof Error) {
    // An Error with no message is worse than useless: it reads as a shrug.
    // Its type at least says where to look.
    return error.message || `${error.name} was thrown with no message`;
  }

  // Thrown strings used to become "Unknown error", discarding the only thing
  // anyone knew about the failure. The failure suite caught it.
  if (typeof error === "string" && error.trim()) return error;

  // And a thrown object usually carries the answer somewhere. Guessing at the
  // usual field names beats binning the lot.
  if (error && typeof error === "object") {
    const bag = error as Record<string, unknown>;
    for (const key of ["message", "error", "detail", "description", "statusText"]) {
      const value = bag[key];
      if (typeof value === "string" && value.trim()) return value;
    }
    try {
      const json = JSON.stringify(error);
      if (json && json !== "{}") return `Unrecognised error shape: ${json.slice(0, 300)}`;
    } catch {
      // Circular. Fall through to the last resort below.
    }
  }

  // The genuine last resort, and it says what it does not know rather than
  // pretending to know nothing happened.
  return `Something threw a ${typeof error} with nothing readable on it`;
}
