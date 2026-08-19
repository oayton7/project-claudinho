/**
 * Regenerates src/lib/migrations.ts from supabase/*.sql.
 *
 * A serverless function cannot read the repo, so the SQL has to be bundled.
 * This keeps the .sql files as the thing you edit and the TypeScript as a
 * build artefact, rather than asking anyone to maintain both.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = "supabase";
const files = readdirSync(dir).filter((f) => /^\d+.*\.sql$/.test(f)).sort();

const parts = files.map((name) => {
  const sql = readFileSync(join(dir, name), "utf8")
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");
  return `  {\n    name: ${JSON.stringify(name)},\n    sql: \`${sql}\`,\n  },`;
});

writeFileSync(
  "src/lib/migrations.ts",
  `/**
 * Every migration, in order, embedded as strings.
 *
 * Embedded rather than read from disk because a serverless function has no
 * repo to read from. Generated from supabase/*.sql — edit those and re-run
 * \`npm run migrations\` rather than editing this file.
 *
 * Every statement in here must be idempotent: \`create table if not exists\`,
 * \`add column if not exists\`. Running the whole list twice is a no-op, which
 * is what makes it safe to press the button whenever you are unsure.
 */
export const MIGRATIONS: { name: string; sql: string }[] = [
${parts.join("\n")}
];
`,
);

console.log(`Embedded ${files.length} migrations: ${files.join(", ")}`);
