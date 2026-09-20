#!/usr/bin/env node
/**
 * Runs every SQL file in supabase/migrations/, in filename order, against
 * SUPABASE_DB_URL, tracking what's already applied in a bookkeeping table
 * so re-running this script is safe.
 *
 * Why not `supabase db push`? This machine has no Docker and no browser
 * for `supabase login`'s OAuth flow (see docs/DECISIONS.md). A direct
 * Postgres connection sidesteps both — the migrations are just SQL.
 *
 * Usage: node --env-file=.env.local scripts/run-migrations.mjs
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../supabase/migrations");

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error("SUPABASE_DB_URL is not set. See .env.example.");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();

  try {
    await client.query(`
      create table if not exists _lms_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      );
    `);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const { rows: applied } = await client.query(
      "select name from _lms_migrations",
    );
    const appliedNames = new Set(applied.map((r) => r.name));

    let ranCount = 0;
    for (const file of files) {
      if (appliedNames.has(file)) {
        console.log(`skip   ${file} (already applied)`);
        continue;
      }

      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf-8");
      console.log(`apply  ${file}`);

      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into _lms_migrations (name) values ($1)", [
          file,
        ]);
        await client.query("commit");
        ranCount++;
      } catch (err) {
        await client.query("rollback");
        console.error(`FAILED ${file}`);
        throw err;
      }
    }

    console.log(
      ranCount === 0
        ? "Nothing to apply — schema is up to date."
        : `Applied ${ranCount} migration(s).`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
