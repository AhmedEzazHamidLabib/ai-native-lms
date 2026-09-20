#!/usr/bin/env node
/**
 * Runs supabase/seed.sql against SUPABASE_DB_URL. Safe to re-run —
 * every insert in seed.sql uses ON CONFLICT DO NOTHING.
 *
 * Usage: node --env-file=.env.local scripts/run-seed.mjs
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error("SUPABASE_DB_URL is not set. See .env.example.");
    process.exit(1);
  }

  const sql = await readFile(
    path.resolve(import.meta.dirname, "../supabase/seed.sql"),
    "utf-8",
  );

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    await client.query(sql);
    console.log("Seed applied.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
