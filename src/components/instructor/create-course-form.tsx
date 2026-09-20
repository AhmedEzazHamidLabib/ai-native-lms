"use client";

import { useActionState, useState } from "react";
import { createCourseAction } from "@/lib/domain/course-actions";
import { initialCreateCourseActionState } from "@/lib/domain/course-client-types";

/**
 * Collapsed by default — a single obvious "+ Create course" primary
 * action, not a permanently-open enterprise form. Expands into the
 * minimum three fields the current schema actually stores per course
 * (code/title/term); nothing invented to look more "complete."
 */
export function CreateCourseForm() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(createCourseAction, initialCreateCourseActionState);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center rounded-md bg-ink text-warm-paper px-4 py-2 text-sm font-medium hover:bg-azure transition-colors duration-[180ms] w-full sm:w-auto"
      >
        + Create course
      </button>
    );
  }

  return (
    <form action={formAction} className="border border-border rounded-md px-5 py-4 space-y-3 w-full sm:w-96">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-xs text-muted mb-1.5">Course code</span>
          <input
            type="text"
            name="code"
            required
            maxLength={40}
            placeholder="e.g. CSE 1204"
            className="w-full border border-border rounded-md px-3 py-2 text-sm bg-surface focus-visible:border-azure"
          />
        </label>
        <label className="block">
          <span className="block text-xs text-muted mb-1.5">Term</span>
          <input
            type="text"
            name="term"
            required
            maxLength={40}
            placeholder="e.g. Spring 2027"
            className="w-full border border-border rounded-md px-3 py-2 text-sm bg-surface focus-visible:border-azure"
          />
        </label>
      </div>
      <label className="block">
        <span className="block text-xs text-muted mb-1.5">Course title</span>
        <input
          type="text"
          name="title"
          required
          maxLength={200}
          placeholder="e.g. Data Structures"
          className="w-full border border-border rounded-md px-3 py-2 text-sm bg-surface focus-visible:border-azure"
        />
      </label>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-md bg-ink text-warm-paper px-4 py-2 text-sm font-medium hover:bg-azure transition-colors duration-[180ms] disabled:opacity-40"
        >
          {pending ? "Creating…" : "Create course"}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={pending} className="text-sm text-muted disabled:opacity-40">
          Cancel
        </button>
      </div>
    </form>
  );
}
