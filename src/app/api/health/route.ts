/**
 * GET /api/health
 *
 * Reports whether configuration is wired up, so a misconfigured deployment
 * says so plainly instead of failing later in a confusing way.
 *
 * Reports **names and presence only, never values**. That is what makes it
 * safe to leave reachable: knowing SUPABASE_URL exists tells an attacker
 * nothing, and having this available before the password gate works is the
 * whole point — it is how you diagnose the gate itself.
 */
import { getDb } from "@/lib/db";

/**
 * Counts rows without returning any. Proves the credentials work, the schema
 * exists and the tables are reachable, while telling an unauthenticated
 * caller nothing about what is in them.
 */
async function checkDatabase() {
  try {
    const db = getDb();
    const { count, error } = await db
      .from("products")
      .select("*", { count: "exact", head: true });

    if (error) return { connected: false, note: error.message };
    return { connected: true, products: count ?? 0 };
  } catch (error) {
    return {
      connected: false,
      note: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function GET() {
  const present = (name: string) => Boolean(process.env[name]);

  // The Supabase integration names things differently depending on how it was
  // installed, so list what actually arrived rather than assuming.
  const supabaseVars = Object.keys(process.env)
    .filter((k) => k.toUpperCase().includes("SUPABASE") || k.toUpperCase().includes("POSTGRES"))
    .sort();

  return Response.json({
    siteGate: (() => {
      const raw = process.env.SITE_PASSWORD;
      if (!raw) {
        return {
          configured: false,
          note: "SITE_PASSWORD not visible to this build — the site is OPEN. Set it in Vercel, then redeploy.",
        };
      }
      // Shape only, never the value. A password pasted into Vercel very often
      // picks up a trailing space or newline, which makes it silently refuse
      // the thing you are certain you typed correctly.
      return {
        configured: true,
        length: raw.length,
        hasSurroundingWhitespace: raw !== raw.trim(),
        note:
          raw !== raw.trim()
            ? "The stored password has a space or newline around it. That is almost certainly why it will not accept what you type."
            : "Gate is on.",
      };
    })(),
    anthropic: {
      configured: present("ANTHROPIC_API_KEY"),
    },
    keepa: {
      configured: present("KEEPA_API_KEY"),
      note: present("KEEPA_API_KEY")
        ? "Key present. Verify the data format with /api/keepa/probe?asin=...&domain=uk before trusting any derived number."
        : "KEEPA_API_KEY not set. Phase 6 is inert until it is.",
      // Names only, never values. A typo in the variable name is the most
      // likely cause of "I set it and it still says not set", and this turns
      // that from a guessing game into a one-line answer.
      similarNamesFound: Object.keys(process.env)
        .filter((k) => /KEEPA|KEPA|KEEEPA/i.test(k))
        .sort(),
    },
    supabase: {
      variablesFound: supabaseVars,
      count: supabaseVars.length,
      database: await checkDatabase(),
    },
    deployment: {
      env: process.env.VERCEL_ENV ?? "local",
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "unknown",
    },
  });
}
