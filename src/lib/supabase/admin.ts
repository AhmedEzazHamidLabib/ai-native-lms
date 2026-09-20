import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Scope this narrowly: the ingestion pipeline (writing slides and
 * ingestion_status after ingesting a PPTX, see docs/DECISIONS.md) is the
 * only intended caller today. Never use this to serve a user request —
 * user-facing reads and writes must go through src/lib/supabase/server.ts
 * so RLS actually runs.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) {
    throw new Error("SUPABASE_SECRET_KEY is not set. See .env.example.");
  }

  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
