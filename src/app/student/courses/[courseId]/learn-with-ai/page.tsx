import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { getAssessmentEvidence, getPracticeEvidence } from "@/lib/tutor/evidence";
import { getStudentAssessments } from "@/lib/domain/assessments";

interface ObjectiveRow {
  id: string;
  title: string;
  assessmentCorrect: number;
  assessmentTotal: number;
  practiceCorrect: number;
  practiceTotal: number;
  totalCorrect: number;
  totalAttempted: number;
}

/**
 * A new front door into the EXISTING Tutor architecture (Part "Learn
 * with AI") — every action below is a link into an already-shipped
 * surface (the objective-scoped Tutor entry at ?entry=performance, the
 * Practice catalog, the general Tutor). No new provider calls, no new
 * session storage: this page only reads existing evidence and routes.
 */
export default async function LearnWithAiPage({
  params,
}: PageProps<"/student/courses/[courseId]/learn-with-ai">) {
  const { courseId } = await params;
  const supabase = await createClient();

  const [assessmentEvidence, practiceEvidence, assessments] = await Promise.all([
    getAssessmentEvidence(supabase, courseId),
    getPracticeEvidence(supabase, courseId),
    getStudentAssessments(courseId),
  ]);

  const diagnostic = assessments.find((a) => a.isDiagnostic) ?? null;

  const byObjective = new Map<string, ObjectiveRow>();
  for (const e of assessmentEvidence) {
    byObjective.set(e.learningObjectiveId, {
      id: e.learningObjectiveId,
      title: e.title,
      assessmentCorrect: e.correct,
      assessmentTotal: e.attempted,
      practiceCorrect: 0,
      practiceTotal: 0,
      totalCorrect: e.correct,
      totalAttempted: e.attempted,
    });
  }
  for (const e of practiceEvidence) {
    const existing = byObjective.get(e.learningObjectiveId);
    if (existing) {
      existing.practiceCorrect = e.correct;
      existing.practiceTotal = e.attempted;
      existing.totalCorrect += e.correct;
      existing.totalAttempted += e.attempted;
    } else {
      byObjective.set(e.learningObjectiveId, {
        id: e.learningObjectiveId,
        title: e.title,
        assessmentCorrect: 0,
        assessmentTotal: 0,
        practiceCorrect: e.correct,
        practiceTotal: e.attempted,
        totalCorrect: e.correct,
        totalAttempted: e.attempted,
      });
    }
  }

  const withEvidence = [...byObjective.values()].filter((o) => o.totalAttempted > 0);
  const hasEvidence = withEvidence.length > 0;
  const weakest = [...withEvidence]
    .sort((a, b) => a.totalCorrect / a.totalAttempted - b.totalCorrect / b.totalAttempted)
    .slice(0, 3);

  const diagnosticHref = diagnostic
    ? diagnostic.attemptId && !diagnostic.submittedAt
      ? `/student/courses/${courseId}/assessments/${diagnostic.id}/attempt/${diagnostic.attemptId}`
      : `/student/courses/${courseId}/assessments/${diagnostic.id}`
    : null;
  const diagnosticInProgress = Boolean(diagnostic?.attemptId && !diagnostic?.submittedAt);
  const diagnosticNotStarted = Boolean(diagnostic && !diagnostic.attemptId);

  return (
    <>
      <PageHeader
        title="Learn with AI"
        description="Personalized help using your course materials and learning progress."
      />

      {!hasEvidence ? (
        <div className="border border-dashed border-border rounded-md px-6 py-8 mb-8 max-w-xl">
          <p className="text-sm text-text mb-4">
            Complete the Learning Diagnostic or some Practice questions to personalize this page.
          </p>
          {diagnosticHref && (
            <Link
              href={diagnosticHref}
              className="inline-flex items-center justify-center rounded-md bg-ink text-warm-paper px-4 py-2 text-sm font-medium hover:bg-azure transition-colors duration-[180ms]"
            >
              {diagnosticInProgress
                ? "Continue the Learning Diagnostic"
                : diagnosticNotStarted
                  ? "Take the Learning Diagnostic"
                  : "Open the Learning Diagnostic"}
            </Link>
          )}
        </div>
      ) : (
        <>
          {diagnosticHref && (diagnosticInProgress || diagnosticNotStarted) && (
            <section className="mb-8">
              <h2 className="text-xs font-medium tracking-wide uppercase text-muted mb-3">Continue learning</h2>
              <Link
                href={diagnosticHref}
                className="block border border-border rounded-md px-5 py-4 hover:bg-black/[0.02] transition-colors duration-[180ms] max-w-xl"
              >
                <p className="text-sm font-medium text-text">
                  {diagnosticInProgress ? "Resume your Learning Diagnostic" : "Take the Learning Diagnostic"}
                </p>
                <p className="text-xs text-muted mt-1">Practice only — does not affect your grade.</p>
              </Link>
            </section>
          )}

          <section className="mb-8">
            <h2 className="text-xs font-medium tracking-wide uppercase text-muted mb-3">Review weak areas</h2>
            <ul className="space-y-3 max-w-xl">
              {weakest.map((o) => (
                <li key={o.id} className="border border-border rounded-md px-5 py-4">
                  <p className="text-sm font-medium text-text mb-1">{o.title}</p>
                  <p className="text-xs text-muted mb-3">
                    {o.assessmentTotal > 0 && `Assessment: ${o.assessmentCorrect}/${o.assessmentTotal}`}
                    {o.assessmentTotal > 0 && o.practiceTotal > 0 && " · "}
                    {o.practiceTotal > 0 && `Practice: ${o.practiceCorrect}/${o.practiceTotal}`}
                  </p>
                  <Link
                    href={`/student/courses/${courseId}/tutor?entry=performance&objective=${o.id}`}
                    className="text-sm text-azure hover:underline underline-offset-2"
                  >
                    Review with AI →
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <section className="grid sm:grid-cols-2 gap-4 max-w-xl">
        <Link
          href={`/student/courses/${courseId}/practice`}
          className="border border-border rounded-md px-5 py-4 hover:bg-black/[0.02] transition-colors duration-[180ms]"
        >
          <p className="text-sm font-medium text-text mb-1">Practice with AI</p>
          <p className="text-xs text-muted">Choose a lecture and get instant feedback with an AI explanation.</p>
        </Link>
        <Link
          href={`/student/courses/${courseId}/tutor`}
          className="border border-border rounded-md px-5 py-4 hover:bg-black/[0.02] transition-colors duration-[180ms]"
        >
          <p className="text-sm font-medium text-text mb-1">Ask about the course</p>
          <p className="text-xs text-muted">Open the Tutor for anything covered so far.</p>
        </Link>
      </section>
    </>
  );
}
