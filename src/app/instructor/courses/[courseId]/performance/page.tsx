import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { getCoursePerformance } from "@/lib/domain/assessments";
import { formatPercent } from "@/lib/format";

export default async function InstructorPerformancePage({
  params,
}: PageProps<"/instructor/courses/[courseId]/performance">) {
  const { courseId } = await params;
  const performance = await getCoursePerformance(courseId);

  if (!performance || performance.studentsSubmitted === 0) {
    return (
      <>
        <PageHeader
          title="Performance"
          description="Class-wide accuracy by lecture, topic, and question, derived only from submitted attempts."
        />
        <EmptyState
          title="No submissions yet"
          description="Once students submit an assessment, aggregate accuracy will appear here."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Performance"
        description="Class-wide accuracy by lecture, topic, and question, derived only from submitted attempts."
      />

      <section className="mb-10 grid grid-cols-1 sm:grid-cols-3 gap-px bg-border border border-border rounded-md overflow-hidden max-w-2xl">
        <div className="bg-warm-paper px-5 py-4">
          <p className="text-2xl font-display text-ink">
            {performance.studentsSubmitted} / {performance.totalStudents}
          </p>
          <p className="text-xs text-muted mt-1">Students submitted</p>
        </div>
        <div className="bg-warm-paper px-5 py-4">
          <p className="text-2xl font-display text-ink">
            {performance.averagePercent ?? "—"}%
          </p>
          <p className="text-xs text-muted mt-1">Average score</p>
        </div>
        <div className="bg-warm-paper px-5 py-4">
          <p className="text-2xl font-display text-ink">
            {performance.medianPercent ?? "—"}%
          </p>
          <p className="text-xs text-muted mt-1">Median score</p>
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
          Topics with very few submitted answers are shown with their raw count rather
          than a confident percentage-only judgment.
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

      <section>
        <h2 className="text-xs font-medium tracking-wide uppercase text-muted mb-3">
          By question — lowest accuracy first
        </h2>
        <ul className="divide-y divide-border border-t border-b border-border">
          {performance.questionBreakdown.map((q) => (
            <li key={q.questionId} className="flex flex-col gap-1 px-1 py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-text min-w-0">{q.prompt}</p>
                <span className="text-xs text-muted shrink-0">
                  {q.correct} / {q.total} · {q.correctPct}%
                </span>
              </div>
              <p className="text-xs text-muted">
                {q.lectureTitle ?? "No lecture"} · {q.topic}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
