import Link from "next/link";
import type { AttemptView } from "@/lib/domain/assessment-types";
import { cn } from "@/lib/utils/cn";
import { optionFeedbackClass, OptionBadge } from "@/components/ui/answer-feedback";

export function AttemptResults({
  view,
  courseId,
}: {
  view: AttemptView;
  courseId: string;
}) {
  const hasMistakes = view.questions.some(
    (q) => q.questionType === "single_choice" && q.selectedOptionId !== q.options.find((o) => o.isCorrect)?.optionId,
  );

  return (
    <div className="max-w-xl">
      <div className="border border-border rounded-md px-6 py-5 mb-8 flex items-center justify-between">
        <div>
          <p className="text-xs font-medium tracking-wide uppercase text-muted mb-1">
            Your score
          </p>
          <p className="font-display text-3xl text-ink">
            {view.score} <span className="text-muted text-xl">/ {view.maxScore}</span>
          </p>
          {view.pendingGradingCount > 0 && (
            <p className="text-xs text-azure mt-1">
              {view.pendingGradingCount} written answer{view.pendingGradingCount === 1 ? "" : "s"} awaiting grading —
              this score may still change.
            </p>
          )}
        </div>
        <p className="text-xs text-muted">
          Submitted {view.submittedAt ? new Date(view.submittedAt).toLocaleString() : ""}
        </p>
      </div>

      {hasMistakes && (
        <div className="mb-8">
          <Link
            href={`/student/courses/${courseId}/tutor?attempt=${view.attemptId}&entry=assessment_review`}
            className="inline-flex items-center justify-center rounded-md bg-ink text-warm-paper px-4 py-2 text-sm font-medium hover:bg-azure transition-colors duration-[180ms] w-full sm:w-auto"
          >
            Review mistakes with AI
          </Link>
        </div>
      )}

      <div className="space-y-6">
        {view.questions.map((q) => {
          if (q.questionType === "written") {
            const graded = q.isCorrectManual !== null;
            return (
              <section key={q.questionId} className="border border-border rounded-md px-5 py-4">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <p className="text-sm font-medium text-text">
                    {q.position}. {q.prompt}
                  </p>
                  <span
                    className={cn(
                      "shrink-0 text-[11px] font-medium tracking-wide uppercase inline-flex items-center gap-1",
                      !graded ? "text-azure" : q.isCorrectManual ? "text-success" : "text-danger",
                    )}
                  >
                    {!graded ? "Awaiting grading" : (
                      <>
                        <span aria-hidden>{q.isCorrectManual ? "✓" : "✕"}</span>
                        {q.isCorrectManual ? "Correct" : "Incorrect"}
                      </>
                    )}
                  </span>
                </div>
                <p className="text-sm text-text bg-surface border border-border rounded-md px-3 py-2 whitespace-pre-line">
                  {q.textResponse || <span className="text-muted">No answer submitted.</span>}
                </p>
                {graded && q.gradingNote && <p className="text-xs text-muted mt-2">Instructor note: {q.gradingNote}</p>}
                {graded && q.explanation && <p className="text-xs text-muted mt-2">Explanation: {q.explanation}</p>}
              </section>
            );
          }

          const correctOption = q.options.find((o) => o.isCorrect);
          const gotIt = q.selectedOptionId === correctOption?.optionId;
          return (
            <section key={q.questionId} className="border border-border rounded-md px-5 py-4">
              <div className="flex items-start justify-between gap-4 mb-3">
                <p className="text-sm font-medium text-text">
                  {q.position}. {q.prompt}
                </p>
                <span
                  className={cn(
                    "shrink-0 text-[11px] font-medium tracking-wide uppercase inline-flex items-center gap-1",
                    gotIt ? "text-success" : "text-danger",
                  )}
                >
                  <span aria-hidden>{gotIt ? "✓" : "✕"}</span>
                  {gotIt ? "Correct" : "Incorrect"}
                </span>
              </div>
              <ul className="space-y-1.5">
                {q.options.map((o) => {
                  const isSelected = o.optionId === q.selectedOptionId;
                  return (
                    <li
                      key={o.optionId}
                      className={cn(
                        "text-sm px-3 py-1.5 rounded border flex flex-wrap items-center",
                        optionFeedbackClass({ isCorrectOption: o.isCorrect, isSelected, isRevealed: true }),
                      )}
                    >
                      <span>{o.text}</span>
                      <OptionBadge isCorrectOption={o.isCorrect} isSelected={isSelected} isRevealed />
                    </li>
                  );
                })}
              </ul>
              {q.explanation && <p className="text-xs text-muted mt-2">Explanation: {q.explanation}</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
