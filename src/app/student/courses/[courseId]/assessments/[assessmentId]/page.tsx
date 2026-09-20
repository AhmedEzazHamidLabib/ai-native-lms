import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { getStudentAssessments } from "@/lib/domain/assessments";
import { StartAttemptButton } from "@/components/assessment/start-attempt-button";

export default async function StudentAssessmentIntroPage({
  params,
}: PageProps<"/student/courses/[courseId]/assessments/[assessmentId]">) {
  const { courseId, assessmentId } = await params;

  const assessments = await getStudentAssessments(courseId);
  const assessment = assessments.find((a) => a.id === assessmentId);
  if (!assessment) notFound();

  if (assessment.submittedAt) {
    redirect(
      `/student/courses/${courseId}/assessments/${assessment.id}/attempt/${assessment.attemptId}`,
    );
  }

  const canStart = assessment.attemptId !== null || !assessment.locked;

  return (
    <>
      <PageHeader title={assessment.title} />

      <div className="max-w-lg">
        <p className="text-sm text-text mb-6 whitespace-pre-line">
          {assessment.instructions}
        </p>

        <ul className="text-sm text-muted space-y-1 mb-8">
          <li>{assessment.questionCount} questions, one attempt.</li>
          <li>You can move between questions before submitting.</li>
          <li>Your results appear immediately after you submit.</li>
        </ul>

        {canStart ? (
          <StartAttemptButton
            courseId={courseId}
            assessmentId={assessment.id}
            label={assessment.attemptId ? "Resume test" : "Start test"}
          />
        ) : (
          <p className="text-sm text-muted border border-dashed border-border rounded-md px-4 py-3">
            Your instructor hasn&apos;t opened this test yet. Check back soon.
          </p>
        )}

        <p className="mt-6">
          <Link
            href={`/student/courses/${courseId}/assessments`}
            className="text-sm text-azure hover:underline underline-offset-2"
          >
            ← Back to assessments
          </Link>
        </p>
      </div>
    </>
  );
}
