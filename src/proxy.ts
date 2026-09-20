import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/supabase/database.types";

const PROTECTED_PREFIXES = ["/student", "/instructor"];

// Session cookie lifetime — shorter than @supabase/ssr's 400-day
// default, applied consistently here and in src/lib/supabase/server.ts
// (every place a session cookie gets written). Each silent token
// refresh rewrites the cookie with a fresh 24h window, so in practice
// this caps idle sessions at 24h rather than forcing re-login every day
// during active use. A hard, activity-independent cap is a native
// Supabase project setting ("time-box user sessions") — see
// docs/DECISIONS.md.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24;

export async function proxy(request: NextRequest) {
  // Transitional: Milestone 1's fixture-backed screens run without a
  // Supabase project configured yet. Once NEXT_PUBLIC_SUPABASE_URL /
  // NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are set (see .env.example), auth
  // protection below activates automatically — nothing else to flip.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: { maxAge: SESSION_MAX_AGE_SECONDS },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Refreshes the session token if expired — required for Server
  // Components, which can only read cookies, not write them.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isProtected = PROTECTED_PREFIXES.some((p) =>
    request.nextUrl.pathname.startsWith(p),
  );

  if (isProtected && !user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Role gate for /instructor: this is a UX-level redirect for someone
  // who is signed in but typed the URL directly — it is not the
  // authorization boundary. That's RLS (0002_rls_policies.sql), which
  // holds regardless of what this check does or misses.
  if (request.nextUrl.pathname.startsWith("/instructor") && user) {
    const { data: membership } = await supabase
      .from("course_members")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "instructor")
      .limit(1)
      .maybeSingle();

    if (!membership) {
      return NextResponse.redirect(new URL("/student", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
