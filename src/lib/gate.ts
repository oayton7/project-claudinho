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

/**
 * The configured site password, cleaned of the ways it usually arrives wrong.
 *
 * Whitespace was already trimmed, because a password pasted into a hosting
 * dashboard very often picks up a trailing space. Surrounding quotes are the
 * same problem: a value typed as "hunter2" is stored with the quote marks, and
 * the person then types it without them and is told they are wrong. It cost an
 * afternoon, and the health endpoint reporting 12 characters for a 10
 * character password is what finally gave it away.
 *
 * Only matched quotes at both ends are removed, so a password that genuinely
 * contains a quote is left alone.
 */
export function configuredPassword(): string | undefined {
  const raw = process.env.SITE_PASSWORD?.trim();
  if (!raw) return undefined;
  const unquoted =
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
      ? raw.slice(1, -1).trim()
      : raw;
  return unquoted || undefined;
}
