/**
 * A single shared password on the whole site.
 *
 * This is not user accounts — that is Phase 5, with real logins and row-level
 * security. This exists so that the moment there is a database behind a public
 * URL, strangers cannot read your shortlist or write to it.
 *
 * The cookie holds a hash of the password, never the password itself, so
 * reading the cookie gives an attacker nothing they can type into the form.
 */

export const COOKIE_NAME = "claudinho_gate";

/**
 * Uses Web Crypto rather than node:crypto because middleware runs on the edge
 * runtime, where the node module is not available.
 */
export async function tokenFor(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`claudinho:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Compares in constant time. A normal === returns early on the first differing
 * character, and the timing difference can in principle be measured to guess
 * the value one character at a time.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let differing = 0;
  for (let i = 0; i < a.length; i++) {
    differing |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return differing === 0;
}
