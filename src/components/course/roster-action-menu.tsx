"use client";

import { useRef, useState, useTransition } from "react";
import { removeCourseMember } from "@/lib/supabase/enrollment-actions";

/**
 * Replaces a permanently-visible red "Remove" button on every roster
 * row with a quiet "⋯" menu — the row itself (a Link to the student
 * detail page) is already the one obvious action; removal is rare and
 * destructive, so it belongs behind a contextual surface, confirmed
 * before it runs.
 */
export function RosterActionMenu({ courseId, userId }: { courseId: string; userId: string }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function close() {
    setConfirming(false);
    if (detailsRef.current) detailsRef.current.open = false;
  }

  return (
    <details
      ref={detailsRef}
      className="relative shrink-0"
      onClick={(e) => e.stopPropagation()}
      onToggle={(e) => {
        if (!(e.currentTarget as HTMLDetailsElement).open) setConfirming(false);
      }}
    >
      <summary
        className="list-none cursor-pointer text-muted hover:text-text px-1.5 py-0.5 rounded select-none"
        aria-label="More actions"
      >
        ⋯
      </summary>
      <div className="absolute right-0 z-10 mt-1 w-48 border border-border rounded-md bg-warm-paper shadow-md py-1.5">
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="w-full text-left px-3 py-1.5 text-sm text-danger hover:bg-danger-soft"
          >
            Remove from course
          </button>
        ) : (
          <div className="px-3 py-2">
            <p className="text-xs text-muted mb-2">Remove from course?</p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await removeCourseMember(courseId, userId);
                    close();
                  })
                }
                className="text-sm font-medium text-danger disabled:opacity-40"
              >
                {pending ? "Removing…" : "Confirm"}
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="text-sm text-muted">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
