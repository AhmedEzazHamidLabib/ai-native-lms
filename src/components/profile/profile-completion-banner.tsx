"use client";

import { useActionState } from "react";
import { updateMyFullName } from "@/lib/supabase/profile-actions";
import { initialProfileActionState } from "@/lib/supabase/profile-client-types";

/**
 * Shown only to pre-existing accounts with no full_name yet
 * (docs/COURSEWORK_LEARNING_ARCHITECTURE.md "PROFILES"). Never blocks
 * anything else on the page — dismissible in spirit by just ignoring
 * it, since access to courses/assessments/grades never depends on this.
 */
export function ProfileCompletionBanner({
  message = "Add your name so instructors and group members can recognize you.",
}: {
  message?: string;
}) {
  const [state, formAction, pending] = useActionState(updateMyFullName, initialProfileActionState);

  if (state.saved) return null;

  return (
    <div className="border border-dashed border-border rounded-md px-4 py-3 mb-6 flex flex-col sm:flex-row sm:items-center gap-3">
      <p className="text-sm text-text flex-1">{message}</p>
      <form action={formAction} className="flex gap-2">
        <input
          type="text"
          name="fullName"
          placeholder="Full name"
          required
          maxLength={200}
          className="border border-border rounded-md px-3 py-1.5 text-sm bg-surface focus-visible:border-azure w-full sm:w-48"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-md bg-ink text-warm-paper px-3 py-1.5 text-sm font-medium hover:bg-azure transition-colors duration-[180ms] disabled:opacity-40 shrink-0"
        >
          {pending ? "…" : "Save"}
        </button>
      </form>
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
    </div>
  );
}
