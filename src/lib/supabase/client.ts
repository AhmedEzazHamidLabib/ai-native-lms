import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    // Kept in sync with src/proxy.ts and src/lib/supabase/server.ts.
    { cookieOptions: { maxAge: 60 * 60 * 24 } },
  );
}
