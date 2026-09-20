import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { getCurrentUser } from "@/lib/supabase/course";
import { getAttemptView, isAssessmentDiagnostic } from "@/lib/domain/assessments";
import { AttemptRunner } from "@/components/assessment/attempt-runner";
import { AttemptResults } from "@/components/assessment/attempt-results";
import { DiagnosticSummary } from "@/components/assessment/diagnostic-summary";

export default async function StudentAttemptPage({
  params,
}: PageProps<"/student/courses/[courseId]/assessments/[assessmentId]/attempt/[attemptId]">) {
  const { courseId, assessmentId, attemptId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // get_attempt_view() is itself the authorization check (owner or
  // instructor only, see 0006_assessments_rls.sql) — a null result here
  // means either the attempt doesn't exist or isn't this user's, and
  // both render identically as "not found" (Invariant 3).
  const [view, isDiagnostic] = await Promise.all([
    getAttemptView(attemptId),
    isAssessmentDiagnostic(assessmentId),
  ]);
  if (!view || view.assessmentId !== assessmentId) notFound();

  return (
    <>
      <PageHeader
        eyebrow={view.assessmentTitle}
        title={view.submittedAt ? (isDiagnostic ? "Practice Test" : "Results") : "In progress"}
      />
      {view.submittedAt && isDiagnostic && (
        <DiagnosticSummary courseId={courseId} score={view.score} maxScore={view.maxScore} />
      )}
      {view.submittedAt ? (
        <AttemptResults view={view} courseId={courseId} />
      ) : (
        <AttemptRunner courseId={courseId} assessmentId={assessmentId} view={view} />
      )}
    </>
  );
}
