"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { addInstructorEmail } from "@/lib/supabase/instructor-management";

const initialState = { error: null, success: false };

export function AddInstructorForm() {
  const [state, formAction, pending] = useActionState(addInstructorEmail, initialState);

  return (
    <form action={formAction} className="flex items-start gap-2">
      <div className="flex-1">
        <input
          type="email"
          name="email"
          required
          placeholder="name@example.edu"
          className="w-full border border-border rounded-md px-3 py-2 text-sm bg-surface focus-visible:border-azure"
        />
        {state.error && (
          <p role="alert" className="text-xs text-danger mt-1.5">
            {state.error}
          </p>
        )}
        {state.success && (
          <p role="status" className="text-xs text-azure mt-1.5">
            Authorized. They can now use Instructor Sign Up.
          </p>
        )}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add instructor"}
      </Button>
    </form>
  );
}
