"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { enrollInCourse, type EnrollState } from "@/lib/supabase/enrollment-actions";

export function EnrollButton({
  courseId,
  autoEnroll,
  initialStatus,
}: {
  courseId: string;
  autoEnroll: boolean;
  /** Already known server-side — avoids a flash of "Enroll" for someone already enrolled/pending. */
  initialStatus: "enrolled" | "pending" | "idle";
}) {
  const initialState: EnrollState = { status: initialStatus, error: null };
  const [state, formAction, pending] = useActionState(enrollInCourse, initialState);

  if (state.status === "enrolled") {
    return (
      <p className="text-sm text-azure font-medium whitespace-nowrap">You&apos;re enrolled</p>
    );
  }
  if (state.status === "pending") {
    return <p className="text-sm text-muted whitespace-nowrap">Request pending</p>;
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="courseId" value={courseId} />
      {state.error && <p className="text-xs text-danger mb-1">{state.error}</p>}
      <Button type="submit" disabled={pending} variant="secondary" className="w-full sm:w-auto">
        {pending ? "…" : autoEnroll ? "Enroll" : "Request to Join"}
      </Button>
    </form>
  );
}
