"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { gradeWrittenResponse } from "@/lib/supabase/assessment-actions";
import { Button } from "@/components/ui/button";

export function WrittenResponseGrader({
  courseId,
  assessmentId,
  attemptId,
  questionId,
  isCorrectManual,
  gradingNote,
}: {
  courseId: string;
  assessmentId: string;
  attemptId: string;
  questionId: string;
  isCorrectManual: boolean | null;
  gradingNote: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState(gradingNote ?? "");

  function grade(isCorrect: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await gradeWrittenResponse(courseId, assessmentId, attemptId, questionId, isCorrect, note.trim() || null);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      {error && <p className="text-xs text-danger mb-2">{error}</p>}
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Grading note shown to the student (optional)"
        className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-surface mb-2"
      />
      <div className="flex gap-2">
        <Button variant={isCorrectManual === true ? "primary" : "secondary"} disabled={pending} onClick={() => grade(true)}>
          Mark correct
        </Button>
        <Button variant={isCorrectManual === false ? "destructive" : "secondary"} disabled={pending} onClick={() => grade(false)}>
          Mark incorrect
        </Button>
      </div>
    </div>
  );
}
