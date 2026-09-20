"use client";

import Link from "next/link";

/**
 * Root error boundary. Without this, an unexpected exception anywhere
 * in a server component or action (a dropped Supabase connection, a
 * bug we haven't seen yet) fell through to Next.js's default crash
 * screen — a dead end with no way back into the app short of manually
 * editing the URL. This never shows the raw error to the student.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-sm w-full text-center">
        <p className="font-display text-xl text-ink mb-2">Something went wrong</p>
        <p className="text-sm text-muted mb-6">
          That&apos;s on us, not something you did. Please try again.
        </p>
        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center justify-center rounded-md bg-ink text-warm-paper px-4 py-2 text-sm font-medium hover:bg-azure transition-colors duration-[180ms]"
          >
            Try again
          </button>
          <Link
            href="/login"
            className="text-sm text-azure hover:underline underline-offset-2"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
