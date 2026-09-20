import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { getCurrentUser } from "@/lib/supabase/course";
import { getAttemptView } from "@/lib/domain/assessments";
import { cn } from "@/lib/utils/cn";
import { optionFeedbackClass, OptionBadge } from "@/components/ui/answer-feedback";
import { WrittenResponseGrader } from "@/components/assessment/written-response-grader";

export default async function InstructorAttemptDetailPage({
  params,
}: PageProps<"/instructor/courses/[courseId]/assessments/[assessmentId]/attempts/[attemptId]">) {
  const { courseId, assessmentId, attemptId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const view = await getAttemptView(attemptId);
  if (!view) notFound();

  return (
    <>
      <PageHeader
        eyebrow={view.assessmentTitle}
        title="Attempt detail"
        description={
          view.submittedAt
            ? `Submitted ${new Date(view.submittedAt).toLocaleString()} · Score ${view.score}/${view.maxScore}` +
              (view.pendingGradingCount > 0 ? ` · ${view.pendingGradingCount} awaiting grading` : "")
            : `Started ${new Date(view.startedAt).toLocaleString()} · still in progress`
        }
      />

      <div className="space-y-8">
        {view.questions.map((q) => {
          if (q.questionType === "written") {
            const graded = q.isCorrectManual !== null;
            return (
              <section key={q.questionId} className="border border-border rounded-md px-5 py-4">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <p className="text-sm font-medium text-text">
                    {q.position}. {q.prompt}
                  </p>
                  {view.submittedAt && (
                    <span
                      className={cn(
                        "shrink-0 text-[11px] font-medium tracking-wide uppercase inline-flex items-center gap-1",
                        !graded ? "text-azure" : q.isCorrectManual ? "text-success" : "text-danger",
                      )}
                    >
                      {!graded ? "Awaiting grading" : q.isCorrectManual ? "Correct" : "Incorrect"}
                    </span>
                  )}
                </div>
                {q.answerGuide && <p className="text-xs text-muted mb-2">Answer guide: {q.answerGuide}</p>}
                <p className="text-sm text-text bg-surface border border-border rounded-md px-3 py-2 whitespace-pre-line">
                  {q.textResponse || <span className="text-muted">No answer submitted.</span>}
                </p>
                {view.submittedAt && q.textResponse && (
                  <WrittenResponseGrader
                    courseId={courseId}
                    assessmentId={assessmentId}
                    attemptId={attemptId}
                    questionId={q.questionId}
                    isCorrectManual={q.isCorrectManual}
                    gradingNote={q.gradingNote}
                  />
                )}
              </section>
            );
          }

          const correctOption = q.options.find((o) => o.isCorrect);
          const gotIt = view.submittedAt
            ? q.selectedOptionId === correctOption?.optionId
            : null;
          return (
            <section key={q.questionId} className="border border-border rounded-md px-5 py-4">
              <div className="flex items-start justify-between gap-4 mb-3">
                <p className="text-sm font-medium text-text">
                  {q.position}. {q.prompt}
                </p>
                {view.submittedAt && (
                  <span
                    className={cn(
                      "shrink-0 text-[11px] font-medium tracking-wide uppercase inline-flex items-center gap-1",
                      gotIt ? "text-success" : "text-danger",
                    )}
                  >
                    <span aria-hidden>{gotIt ? "✓" : "✕"}</span>
                    {gotIt ? "Correct" : "Incorrect"}
                  </span>
                )}
              </div>
              <ul className="space-y-1.5">
                {q.options.map((o) => {
                  const isSelected = o.optionId === q.selectedOptionId;
                  const revealed = Boolean(view.submittedAt);
                  return (
                    <li
                      key={o.optionId}
                      className={cn(
                        "text-sm px-3 py-1.5 rounded border flex flex-wrap items-center",
                        revealed
                          ? optionFeedbackClass({ isCorrectOption: o.isCorrect, isSelected, isRevealed: true })
                          : isSelected
                            ? "border-azure bg-azure-soft/30"
                            : "border-border",
                      )}
                    >
                      <span>{o.text}</span>
                      {revealed && (
                        <OptionBadge isCorrectOption={o.isCorrect} isSelected={isSelected} isRevealed />
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
