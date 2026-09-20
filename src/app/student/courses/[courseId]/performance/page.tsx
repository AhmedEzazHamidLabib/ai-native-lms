import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { getStudentPerformance } from "@/lib/domain/assessments";
import { formatPercent } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getAssessmentEvidence, getPracticeEvidence } from "@/lib/tutor/evidence";

const WEAK_THRESHOLD = 0.7;

export default async function StudentPerformancePage({
  params,
}: PageProps<"/student/courses/[courseId]/performance">) {
  const { courseId } = await params;
  const performance = await getStudentPerformance(courseId);
  const supabase = await createClient();
  const [assessmentEvidence, practiceEvidence] = await Promise.all([
    getAssessmentEvidence(supabase, courseId),
    getPracticeEvidence(supabase, courseId),
  ]);
  const weakObjectives = assessmentEvidence.filter(
    (e) => e.attempted > 0 && e.correct / e.attempted < WEAK_THRESHOLD,
  );

  if (!performance || performance.assessmentsCompleted === 0) {
    return (
      <>
        <PageHeader
          title="Performance"
          description="A breakdown of your accuracy by lecture and topic, derived from your own submitted assessments."
        />
        <EmptyState
          title="No submitted assessments yet"
          description="Complete an assessment to see your performance broken down by lecture and topic."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Performance"
        description="A breakdown of your accuracy by lecture and topic, derived from your own submitted assessments."
      />

      <section className="mb-10 grid grid-cols-1 sm:grid-cols-3 gap-px bg-border border border-border rounded-md overflow-hidden">
        <div className="bg-warm-paper px-5 py-4">
          <p className="text-2xl font-display text-ink">
            {formatPercent(performance.questionsCorrect, performance.questionsTotal)}
          </p>
          <p className="text-xs text-muted mt-1">Overall accuracy</p>
        </div>
        <div className="bg-warm-paper px-5 py-4">
          <p className="text-2xl font-display text-ink">
            {performance.questionsCorrect} / {performance.questionsTotal}
          </p>
          <p className="text-xs text-muted mt-1">Questions answered correctly</p>
        </div>
        <div className="bg-warm-paper px-5 py-4">
          <p className="text-2xl font-display text-ink">{performance.assessmentsCompleted}</p>
          <p className="text-xs text-muted mt-1">Assessments completed</p>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-xs font-medium tracking-wide uppercase text-muted mb-3">
          By lecture
        </h2>
        <ul className="divide-y divide-border border-t border-b border-border">
          {performance.lectureBreakdown.map((l) => (
            <li
              key={l.lectureId}
              className="flex items-center justify-between gap-3 px-1 py-3"
            >
              <span className="text-sm text-text min-w-0 truncate">{l.lectureTitle}</span>
              <span className="text-xs text-muted shrink-0">
                {l.correct} / {l.total} correct · {formatPercent(l.correct, l.total)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xs font-medium tracking-wide uppercase text-muted mb-3">
          By topic
        </h2>
        <p className="text-xs text-muted mb-3">
          Some topics only appeared in one or two of your assessment questions — the count
          is shown as-is rather than presented as a confident trend.
        </p>
        <ul className="divide-y divide-border border-t border-b border-border">
          {performance.topicBreakdown.map((t) => (
            <li key={t.topic} className="flex items-center justify-between gap-3 px-1 py-3">
              <span className="text-sm text-text min-w-0 truncate">{t.topic}</span>
              <span className="text-xs text-muted shrink-0">
                {t.correct} / {t.total} correct · {formatPercent(t.correct, t.total)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {assessmentEvidence.length > 0 && (
        <section>
          <h2 className="text-xs font-medium tracking-wide uppercase text-muted mb-3">
            By learning objective
          </h2>
          <p className="text-xs text-muted mb-3">
            Assessment evidence is your official, unchanged score. Practice evidence is
            separate, ungraded AI Tutor practice — shown side by side, never merged.
          </p>
          <ul className="divide-y divide-border border-t border-b border-border">
            {assessmentEvidence.map((e) => {
              const practice = practiceEvidence.find(
                (p) => p.learningObjectiveId === e.learningObjectiveId,
              );
              const isWeak = weakObjectives.some(
                (w) => w.learningObjectiveId === e.learningObjectiveId,
              );
              return (
                <li
                  key={e.learningObjectiveId}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1 py-3"
                >
                  <div className="min-w-0">
                    <span className="text-sm text-text">{e.title}</span>
                    <p className="text-xs text-muted mt-0.5">
                      Assessment evidence {e.correct}/{e.attempted} correct
                      {practice && practice.attempted > 0
                        ? ` · Practice evidence ${practice.correct}/${practice.attempted} correct`
                        : ""}
                    </p>
                  </div>
                  {isWeak && (
                    <Link
                      href={`/student/courses/${courseId}/tutor?objective=${e.learningObjectiveId}&entry=performance`}
                      className="shrink-0 inline-flex items-center justify-center rounded-md border border-azure text-azure px-3 py-1.5 text-xs font-medium hover:bg-azure hover:text-warm-paper transition-colors duration-[180ms] w-full sm:w-auto"
                    >
                      Practice with AI
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
