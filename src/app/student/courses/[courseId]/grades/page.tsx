import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { getStudentAssessments } from "@/lib/domain/assessments";
import { formatDateTime, formatPercent } from "@/lib/format";

const KIND_LABEL: Record<string, string> = {
  mock_test: "Mock Test",
  class_test: "Class Test",
  project: "Project",
};

export default async function StudentGradesPage({
  params,
}: PageProps<"/student/courses/[courseId]/grades">) {
  const { courseId } = await params;
  const assessments = await getStudentAssessments(courseId);

  const graded = assessments.filter((a) => a.contributesToGrade);
  const ungraded = assessments.filter((a) => !a.contributesToGrade);

  // Total possible is the syllabus weight (Class Test 10 + Project 10 =
  // 20 today) — a course fact, not something inferred from attempts.
  const pointsPossibleTotal = graded.reduce((sum, a) => sum + (a.pointsPossible ?? 0), 0);
  // Only quiz-engine assessments (class_test) have a submitted score
  // today — a project's marks come from instructor grading, not built
  // this milestone, so it's shown honestly as "not yet graded" rather
  // than silently scored zero.
  const scorableGraded = graded.filter((a) => a.kind !== "project");
  const submittedGraded = scorableGraded.filter((a) => a.submittedAt !== null);
  const pointsEarned = submittedGraded.reduce((sum, a) => sum + (a.score ?? 0), 0);
  const pointsFromSubmitted = submittedGraded.reduce((sum, a) => sum + (a.maxScore ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Grades"
        description="Class Test and Project marks count toward your course grade. Mock Test and Practice are shown separately and never affect it."
      />

      {assessments.length === 0 ? (
        <EmptyState
          title="Nothing graded yet"
          description="Your instructor hasn't published any assessments in this course."
        />
      ) : (
        <>
          <section className="mb-10 grid grid-cols-1 sm:grid-cols-3 gap-px bg-border border border-border rounded-md overflow-hidden">
            <div className="bg-warm-paper px-5 py-4">
              <p className="text-2xl font-display text-ink">
                {pointsFromSubmitted === 0 ? "—" : formatPercent(pointsEarned, pointsFromSubmitted)}
              </p>
              <p className="text-xs text-muted mt-1">Graded so far (submitted only)</p>
            </div>
            <div className="bg-warm-paper px-5 py-4">
              <p className="text-2xl font-display text-ink">{pointsPossibleTotal}</p>
              <p className="text-xs text-muted mt-1">Total course marks (Class Test + Project)</p>
            </div>
            <div className="bg-warm-paper px-5 py-4">
              <p className="text-2xl font-display text-ink">
                {submittedGraded.length} / {scorableGraded.length}
              </p>
              <p className="text-xs text-muted mt-1">Graded components completed</p>
            </div>
          </section>

          <section className="mb-10">
            <h2 className="text-xs font-medium tracking-wide uppercase text-muted mb-3">
              Graded coursework
            </h2>
            <ul className="divide-y divide-border border-t border-b border-border">
              {graded.map((a) => (
                <li key={a.id} className="px-1 py-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-azure uppercase tracking-wide font-medium">
                        {KIND_LABEL[a.kind] ?? a.kind}
                      </p>
                      <p className="text-sm font-medium text-text truncate">{a.title}</p>
                    </div>
                    {a.kind === "project" ? (
                      <span className="text-xs text-muted shrink-0">
                        {a.pointsPossible} marks · not yet graded
                      </span>
                    ) : a.submittedAt ? (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 shrink-0">
                        <span className="text-sm font-display text-ink">
                          {a.score} / {a.pointsPossible ?? a.maxScore}
                        </span>
                        <span className="text-xs text-muted">Submitted {formatDateTime(a.submittedAt)}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted shrink-0">
                        {a.pointsPossible} marks ·{" "}
                        {a.attemptId ? "in progress" : a.locked ? "not open yet" : "not started"}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {ungraded.length > 0 && (
            <section>
              <h2 className="text-xs font-medium tracking-wide uppercase text-muted mb-3">
                Practice assessments (do not affect your grade)
              </h2>
              <ul className="divide-y divide-border border-t border-b border-border">
                {ungraded.map((a) => (
                  <li key={a.id} className="px-1 py-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <p className="text-sm font-medium text-text min-w-0 truncate">{a.title}</p>
                      {a.submittedAt ? (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 shrink-0">
                          <span className="text-sm font-display text-ink">
                            {a.score} / {a.maxScore}
                          </span>
                          <span className="text-xs text-muted">{formatPercent(a.score ?? 0, a.maxScore ?? 0)}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted shrink-0">
                          {a.attemptId ? "In progress" : a.locked ? "Not open yet" : "Not yet attempted"}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}
