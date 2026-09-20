"use client";

import { useMemo, useState, useTransition } from "react";
import { saveResponse, submitAttempt } from "@/lib/supabase/assessment-actions";
import type { AttemptView } from "@/lib/domain/assessment-types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

type SaveState = "idle" | "saving" | "saved" | "error";

export function AttemptRunner({
  courseId,
  assessmentId,
  view,
}: {
  courseId: string;
  assessmentId: string;
  view: AttemptView;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(view.questions.map((q) => [q.questionId, q.selectedOptionId])),
  );
  const [textAnswers, setTextAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(view.questions.map((q) => [q.questionId, q.textResponse ?? ""])),
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);
  const [submitting, startSubmit] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const question = view.questions[index];
  const answeredCount = useMemo(
    () =>
      view.questions.filter((q) =>
        q.questionType === "written" ? (textAnswers[q.questionId] ?? "").trim().length > 0 : answers[q.questionId] !== null,
      ).length,
    [answers, textAnswers, view.questions],
  );
  const unansweredCount = view.questions.length - answeredCount;

  function selectOption(optionId: string) {
    setAnswers((prev) => ({ ...prev, [question.questionId]: optionId }));
    setSaveState("saving");
    saveResponse(view.attemptId, question.questionId, optionId).then((result) => {
      setSaveState(result.ok ? "saved" : "error");
    });
  }

  function updateTextAnswer(value: string) {
    setTextAnswers((prev) => ({ ...prev, [question.questionId]: value }));
  }

  function saveTextAnswer() {
    setSaveState("saving");
    saveResponse(view.attemptId, question.questionId, null, textAnswers[question.questionId] ?? "").then((result) => {
      setSaveState(result.ok ? "saved" : "error");
    });
  }

  function handleSubmitClick() {
    if (unansweredCount > 0 && !confirmingSubmit) {
      setConfirmingSubmit(true);
      return;
    }
    setSubmitError(null);
    startSubmit(async () => {
      const result = await submitAttempt(courseId, assessmentId, view.attemptId);
      if (result?.error) setSubmitError(result.error);
    });
  }

  return (
    <div className="max-w-xl">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium tracking-wide uppercase text-muted">
          Question {index + 1} of {view.questions.length}
        </p>
        <p className="text-xs text-muted">{answeredCount} answered</p>
      </div>

      <div className="h-1.5 bg-border rounded-full overflow-hidden mb-8">
        <div
          className="h-full bg-azure transition-all duration-[220ms] ease-out"
          style={{ width: `${((index + 1) / view.questions.length) * 100}%` }}
        />
      </div>

      <p
        className="font-display text-xl sm:text-2xl leading-snug text-ink mb-6 animate-fade-up"
        key={question.questionId}
      >
        {question.prompt}
      </p>

      {question.questionType === "written" ? (
        <div className="mb-8">
          <textarea
            value={textAnswers[question.questionId] ?? ""}
            onChange={(e) => updateTextAnswer(e.target.value)}
            onBlur={saveTextAnswer}
            placeholder="Type your answer…"
            rows={8}
            className="w-full border-2 border-border rounded-lg px-5 py-4 text-base text-text focus-visible:border-azure resize-y"
          />
          <p className="text-xs text-muted mt-2">
            This is a written answer — an instructor will grade it manually, not the system.
          </p>
        </div>
      ) : (
        <div className="space-y-3 mb-8">
          {question.options.map((opt) => {
            const selected = answers[question.questionId] === opt.optionId;
            return (
              <button
                key={opt.optionId}
                type="button"
                onClick={() => selectOption(opt.optionId)}
                aria-pressed={selected}
                className={cn(
                  "w-full text-left text-base px-5 py-4 rounded-lg border-2 transition-colors duration-[180ms] active:scale-[0.99]",
                  selected
                    ? "border-azure bg-azure-soft/50 text-text"
                    : "border-border text-text hover:border-ink",
                )}
              >
                {opt.text}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between gap-4 mb-1">
        <div className="flex gap-2 flex-1">
          <Button
            type="button"
            variant="secondary"
            disabled={index === 0}
            onClick={() => {
              setIndex((i) => Math.max(0, i - 1));
              setSaveState("idle");
            }}
            className="flex-1 py-3"
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={index === view.questions.length - 1}
            onClick={() => {
              setIndex((i) => Math.min(view.questions.length - 1, i + 1));
              setSaveState("idle");
            }}
            className="flex-1 py-3"
          >
            Next
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted text-right mb-8" aria-live="polite">
        {saveState === "saving" && "Saving…"}
        {saveState === "saved" && "Saved"}
        {saveState === "error" && "Couldn't save — try again"}
      </p>

      <div className="pt-6 border-t border-border">
        {confirmingSubmit && (
          <p className="text-sm text-text mb-3">
            {unansweredCount} question{unansweredCount === 1 ? "" : "s"} unanswered.
            Submit anyway? You won&apos;t be able to change answers after submitting.
          </p>
        )}
        {submitError && <p className="text-sm text-danger mb-3">{submitError}</p>}
        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            type="button"
            onClick={handleSubmitClick}
            disabled={submitting}
            className="w-full sm:w-auto py-3"
          >
            {submitting
              ? "Submitting…"
              : confirmingSubmit
                ? "Submit anyway"
                : "Submit test"}
          </Button>
          {confirmingSubmit && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmingSubmit(false)}
              className="w-full sm:w-auto py-3"
            >
              Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
