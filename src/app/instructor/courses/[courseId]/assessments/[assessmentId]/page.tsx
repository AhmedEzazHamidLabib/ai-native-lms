import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { ActionButton } from "@/components/ui/action-button";
import { getAssessmentAttempts, getInstructorAssessments } from "@/lib/domain/assessments";
import { resetAttempt, toggleLockAssessment, togglePublishAssessment } from "@/lib/supabase/assessment-actions";

export default async function InstructorAssessmentDetailPage({
  params,
}: PageProps<"/instructor/courses/[courseId]/assessments/[assessmentId]">) {
  const { courseId, assessmentId } = await params;

  const assessments = await getInstructorAssessments(courseId);
  const assessment = assessments.find((a) => a.id === assessmentId);
  if (!assessment) notFound();

  const attempts = await getAssessmentAttempts(assessmentId);

  return (
    <>
      <PageHeader
        title={assessment.title}
        description={assessment.instructions}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={assessment.publishedAt ? "PUBLISHED" : "DRAFT"} />
            <ActionButton
              action={togglePublishAssessment.bind(
                null,
                courseId,
                assessment.id,
                !assessment.publishedAt,
              )}
              variant={assessment.publishedAt ? "secondary" : "primary"}
            >
              {assessment.publishedAt ? "Unpublish" : "Publish"}
            </ActionButton>
            <ActionButton
              action={toggleLockAssessment.bind(
                null,
                courseId,
                assessment.id,
                !assessment.locked,
              )}
              variant={assessment.locked ? "primary" : "secondary"}
            >
              {assessment.locked ? "Unlock test-taking" : "Lock test-taking"}
            </ActionButton>
          </div>
        }
      />

      <section className="mb-10 grid grid-cols-1 sm:grid-cols-3 gap-px bg-border border border-border rounded-md overflow-hidden">
        <div className="bg-warm-paper px-5 py-4">
          <p className="text-2xl font-display text-ink">{assessment.questionCount}</p>
          <p className="text-xs text-muted mt-1">Questions per attempt</p>
        </div>
        <div className="bg-warm-paper px-5 py-4">
          <p className="text-2xl font-display text-ink">{assessment.attemptCount}</p>
          <p className="text-xs text-muted mt-1">Attempts started</p>
        </div>
        <div className="bg-warm-paper px-5 py-4">
          <p className="text-2xl font-display text-ink">{assessment.submittedCount}</p>
          <p className="text-xs text-muted mt-1">Submitted</p>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-xs font-medium tracking-wide uppercase text-muted mb-3">
          Configuration
        </h2>
        <ul className="text-sm text-text space-y-1.5 border border-border rounded-md px-5 py-4">
          {assessment.selectionMode === "fixed"
            ? assessment.ruleBreakdown.map((r, i) => (
                <li key={i}>
                  {i + 1}. <span className="font-medium">{r.fixedQuestionPrompt ?? "Question"}</span>
                </li>
              ))
            : assessment.ruleBreakdown.map((r, i) => (
                <li key={i}>
                  {r.count} question{r.count === 1 ? "" : "s"} sampled from{" "}
                  <span className="font-medium">{r.lectureTitle ?? "any lecture"}</span>
                </li>
              ))}
          <li className="text-muted text-xs pt-1">
            Question order: {assessment.questionOrderMode === "fixed" ? "fixed, as listed above" : "shuffled for each student"}.{" "}
            Answer choice order: {assessment.optionOrderMode === "fixed" ? "fixed" : "shuffled for each student"}.
            {" "}Once a student starts, their order stays the same even if they refresh the page.
          </li>
        </ul>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-medium tracking-wide uppercase text-muted">
            Attempts
          </h2>
        </div>
        {attempts.length === 0 ? (
          <p className="text-sm text-muted">No student has started this test yet.</p>
        ) : (
          <ul className="divide-y divide-border border-t border-b border-border">
            {attempts.map((at) => (
              <li
                key={at.id}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-1 py-3"
              >
                <Link
                  href={`/instructor/courses/${courseId}/assessments/${assessment.id}/attempts/${at.id}`}
                  className="text-sm text-text hover:text-azure transition-colors duration-[180ms] min-w-0 truncate"
                >
                  {at.userEmail}
                </Link>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-muted">
                    {at.submittedAt
                      ? `${at.score}/${at.maxScore}`
                      : "In progress"}
                  </span>
                  <ActionButton
                    action={resetAttempt.bind(null, courseId, at.id, assessment.id)}
                    variant="destructive"
                  >
                    Reset
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
