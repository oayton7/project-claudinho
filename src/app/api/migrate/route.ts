import { Client } from "pg";
import { MIGRATIONS } from "@/lib/migrations";

/**
 * POST /api/migrate — apply every migration
 * GET  /api/migrate — say which tables exist, changing nothing
 *
 * Migrations had been a manual step in the Supabase dashboard, and the manual
 * step never happened: four of them were unrun, so sweeps, triage verdicts and
 * review analyses were all rendering to screen and evaporating. The tool was
 * quietly amnesiac.
 *
 * This takes no SQL from the caller. It runs the bundled list and nothing
 * else, so it cannot become a way to execute arbitrary statements against the
 * database. Every statement in that list is idempotent, which is what makes it
 * safe to press twice.
 *
 * Uses the direct connection rather than the pooled one. Pooled connections
 * are for many short queries; DDL wants one session that owns its transaction.
 */
export const maxDuration = 120;

/**
 * Supabase terminates TLS with a chain Node does not carry, so a default
 * client fails with "self-signed certificate in certificate chain".
 *
 * The connection is still encrypted; what is switched off is verification of
 * the chain. That is the usual arrangement for Supabase's direct connection,
 * and the exposure is bounded: the host comes from an environment variable set
 * by the Supabase integration, not from anything a caller can influence.
 */
const SSL = { rejectUnauthorized: false };

function connectionString(): string | null {
  return (
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.POSTGRES_URL ??
    null
  );
}

const EXPECTED_TABLES = [
  "products",
  "judgements",
  "premortems",
  "scout_candidates",
  "reviews",
  "keepa_categories",
  "category_picks",
];

export async function GET() {
  const url = connectionString();
  if (!url) {
    return Response.json(
      { error: "No POSTGRES_URL_NON_POOLING or POSTGRES_URL is set on this deployment." },
      { status: 503 },
    );
  }

  const client = new Client({ connectionString: url, ssl: SSL });
  try {
    await client.connect();
    const { rows } = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' order by table_name`,
    );
    const present = rows.map((r) => r.table_name);
    const missing = EXPECTED_TABLES.filter((t) => !present.includes(t));

    return Response.json({
      present,
      missing,
      verdict:
        missing.length === 0
          ? "Every expected table exists. Nothing to run."
          : `Missing: ${missing.join(", ")}. POST to this same URL to create them.`,
      migrations: MIGRATIONS.map((m) => m.name),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not connect" },
      { status: 502 },
    );
  } finally {
    await client.end().catch(() => {});
  }
}

export async function POST() {
  const url = connectionString();
  if (!url) {
    return Response.json(
      { error: "No POSTGRES_URL_NON_POOLING or POSTGRES_URL is set on this deployment." },
      { status: 503 },
    );
  }

  const client = new Client({ connectionString: url, ssl: SSL });
  const applied: { name: string; ok: boolean; error?: string }[] = [];

  try {
    await client.connect();

    for (const migration of MIGRATIONS) {
      try {
        // Each migration is its own transaction. One failing must not undo the
        // ones before it, and must not stop the ones after — a half-applied
        // schema you can see beats an all-or-nothing failure you cannot.
        await client.query("begin");
        await client.query(migration.sql);
        await client.query("commit");
        applied.push({ name: migration.name, ok: true });
      } catch (error) {
        await client.query("rollback").catch(() => {});
        applied.push({
          name: migration.name,
          ok: false,
          // Verbatim. A migration that fails is exactly the moment a generic
          // message costs an hour.
          error: error instanceof Error ? error.message : "unknown error",
        });
      }
    }

    const { rows } = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' order by table_name`,
    );
    const present = rows.map((r) => r.table_name);
    const missing = EXPECTED_TABLES.filter((t) => !present.includes(t));
    const failed = applied.filter((a) => !a.ok);

    return Response.json({
      verdict:
        missing.length === 0
          ? `All ${applied.length} migrations applied. Every expected table now exists.`
          : `Still missing: ${missing.join(", ")}. Read the errors below.`,
      applied,
      failed: failed.length,
      present,
      missing,
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Could not connect",
        applied,
      },
      { status: 502 },
    );
  } finally {
    await client.end().catch(() => {});
  }
}
