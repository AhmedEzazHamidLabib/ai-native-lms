"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { startAttempt, type StartAttemptState } from "@/lib/supabase/assessment-actions";

const initialState: StartAttemptState = { error: null };

export function StartAttemptButton({
  courseId,
  assessmentId,
  label,
}: {
  courseId: string;
  assessmentId: string;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(startAttempt, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="assessmentId" value={assessmentId} />
      {state.error && (
        <p role="alert" className="text-sm text-danger mb-3">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Starting…" : label}
      </Button>
    </form>
  );
}
