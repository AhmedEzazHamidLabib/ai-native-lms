import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "./database.types";

/**
 * Supabase client for Server Components, Server Actions, and Route
 * Handlers. Runs as the signed-in user — RLS applies. Create a fresh one
 * per request; never cache across requests.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      // Kept in sync with src/proxy.ts — see the comment there.
      cookieOptions: { maxAge: 60 * 60 * 24 },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component that can't set cookies —
            // proxy.ts refreshes the session instead. Safe to ignore.
          }
        },
      },
    },
  );
}
