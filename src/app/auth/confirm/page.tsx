"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Status = "working" | "error";

/**
 * Lands here after clicking the verification email's link. Supabase's
 * own /auth/v1/verify endpoint already consumed the token and set
 * email_confirmed_at server-side before redirecting here (see
 * docs/DECISIONS.md — that's the real security event; instructor
 * access was granted by the database trigger at that moment, not by
 * anything on this page).
 *
 * This page's only job is establishing a browser session from the
 * tokens Supabase's default email-link redirect puts in the URL
 * *fragment* (`#access_token=...`) — readable only client-side, which
 * is why this can't be a server component.
 */
export default function AuthConfirmPage() {
  const [status, setStatus] = useState<Status>("working");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      const hashError = hash.get("error_description") ?? hash.get("error");

      if (hashError) {
        if (!cancelled) {
          setStatus("error");
          setMessage(decodeURIComponent(hashError.replace(/\+/g, " ")));
        }
        return;
      }

      if (!accessToken || !refreshToken) {
        if (!cancelled) {
          setStatus("error");
          setMessage("This verification link is missing its token.");
        }
        return;
      }

      const supabase = createClient();
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (cancelled) return;

      if (error) {
        setStatus("error");
        setMessage(error.message);
        return;
      }

      // Full navigation (not client-side routing) so the server sees
      // the new session cookie and resolves the real destination
      // (src/app/page.tsx) — a soft nav here could render before the
      // cookie write is visible to the next request.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/";
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="flex-1 flex items-center justify-center px-6">
      <div className="max-w-sm w-full text-center">
        {status === "working" ? (
          <p className="text-sm text-muted">Verifying your email…</p>
        ) : (
          <>
            <p className="font-display text-xl text-ink mb-2">
              Verification didn&apos;t complete
            </p>
            <p className="text-sm text-muted mb-6">
              {message ?? "This link may have expired."}
            </p>
            <a
              href="/login"
              className="text-sm text-azure hover:underline underline-offset-2"
            >
              Back to sign in
            </a>
          </>
        )}
      </div>
    </main>
  );
}
