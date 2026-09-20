"use client";

import { useState, useTransition } from "react";
import { submitPracticeAnswer } from "@/lib/tutor/actions";
import { initialPracticeAnswerState } from "@/lib/tutor/client-types";
import { ResultBanner } from "@/components/ui/answer-feedback";

export function PracticeQuestionCard({
  practiceQuestion,
}: {
  practiceQuestion: { id: string; prompt: string; expectedAnswerKind: string };
}) {
  const [answer, setAnswer] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<typeof initialPracticeAnswerState>(initialPracticeAnswerState);

  const graded = result.status === "graded";

  function submit() {
    if (!answer.trim() || pending || graded) return;
    const formData = new FormData();
    formData.set("practiceAttemptId", practiceQuestion.id);
    formData.set("answer", answer);
    startTransition(async () => {
      const outcome = await submitPracticeAnswer(initialPracticeAnswerState, formData);
      setResult(outcome);
    });
  }

  return (
    <div className="border border-azure/30 bg-azure-soft/20 rounded-md px-3 py-3">
      <p className="text-[11px] font-medium tracking-wide uppercase text-azure mb-1.5">
        Practice question
      </p>
      <p className="text-sm text-text mb-3 whitespace-pre-wrap">{practiceQuestion.prompt}</p>

      {!graded ? (
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Your answer…"
            className="flex-1 border border-border rounded-md px-3 py-2 text-sm bg-surface focus-visible:border-azure"
          />
          <button
            type="button"
            onClick={submit}
            disabled={pending || !answer.trim()}
            className="inline-flex items-center justify-center rounded-md bg-ink text-warm-paper px-4 py-2 text-sm font-medium hover:bg-azure transition-colors duration-[180ms] disabled:opacity-40 shrink-0 w-full sm:w-auto"
          >
            {pending ? "Checking…" : "Submit"}
          </button>
        </div>
      ) : (
        <div>
          <ResultBanner correct={Boolean(result.correct)} />
          {result.evaluationReason && (
            <p className="text-xs text-muted mt-1">{result.evaluationReason}</p>
          )}
        </div>
      )}
      {result.error && <p className="text-xs text-danger mt-2">{result.error}</p>}
    </div>
  );
}
