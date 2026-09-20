import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { getStudentDetail } from "@/lib/domain/student-detail";

export default async function InstructorStudentDetailPage({
  params,
}: PageProps<"/instructor/courses/[courseId]/students/[userId]">) {
  const { courseId, userId } = await params;
  const student = await getStudentDetail(courseId, userId);
  if (!student) notFound();

  // Lowest-accuracy objective with enough graded-assessment evidence to
  // be meaningful (>=2 attempted) — evidence-based, never an opaque
  // "weak student" label (Part 9).
  const weakestObjective = student.objectives
    .filter((o) => (o.assessment?.attempted ?? 0) >= 2 && o.assessment!.correct / o.assessment!.attempted < 0.7)
    .sort((a, b) => a.assessment!.correct / a.assessment!.attempted - b.assessment!.correct / b.assessment!.attempted)[0];

  return (
    <>
      <PageHeader
        title={student.fullName ?? student.email}
        description={student.fullName ? student.email : undefined}
        action={
          <Link href={`/instructor/courses/${courseId}/students`} className="text-xs text-azure hover:underline">
            ← Back to Students
          </Link>
        }
      />

      <section className="mb-10 grid grid-cols-1 sm:grid-cols-3 gap-px bg-border border border-border rounded-md overflow-hidden">
        <div className="bg-warm-paper px-5 py-4">
          <p className="text-sm font-medium text-ink">{new Date(student.enrolledAt).toLocaleDateString()}</p>
          <p className="text-xs text-muted mt-1">Enrolled</p>
        </div>
        <div className="bg-warm-paper px-5 py-4">
          <p className="text-sm font-medium text-ink">
            {student.projectGrade?.score != null
              ? `${student.projectGrade.score}/${student.projectGrade.maxScore}`
              : (student.projectGroupName ?? "Not assigned")}
          </p>
          <p className="text-xs text-muted mt-1">
            Project{student.projectGroupName ? ` · ${student.projectGroupName}` : ""}
          </p>
        </div>
        <div className="bg-warm-paper px-5 py-4">
          <p className="text-sm font-medium text-ink">
            {student.grades.filter((g) => g.status === "submitted").length}/{student.grades.length}
          </p>
          <p className="text-xs text-muted mt-1">Assessments submitted</p>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-xs font-medium tracking-wide uppercase text-muted mb-3">Attempts &amp; grades</h2>
        {student.grades.length === 0 && !student.projectGrade ? (
          <p className="text-sm text-muted">No assessments in this course yet.</p>
        ) : (
          <ul className="divide-y divide-border border-t border-b border-border">
            {student.grades.map((g) => (
              <li key={g.assessmentId} className="flex items-center justify-between gap-2 px-1 py-3">
                <div className="min-w-0">
                  <p className="text-sm text-text truncate">{g.assessmentTitle}</p>
                  <p className="text-xs text-muted">
                    {g.status === "submitted"
                      ? `Submitted ${g.submittedAt ? new Date(g.submittedAt).toLocaleDateString() : ""}`
                      : g.status === "in_progress"
                        ? "In progress"
                        : "Not started"}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {g.status === "submitted" && (
                    <p className="text-sm text-text">
                      {g.score}/{g.maxScore}
                    </p>
                  )}
                  {g.attemptId && (
                    <Link
                      href={`/instructor/courses/${courseId}/assessments/${g.assessmentId}/attempts/${g.attemptId}`}
                      className="text-xs text-azure hover:underline"
                    >
                      View attempt
                    </Link>
                  )}
                </div>
              </li>
            ))}
            {student.projectGrade && (
              <li className="flex items-center justify-between gap-2 px-1 py-3">
                <div className="min-w-0">
                  <p className="text-sm text-text truncate">Project</p>
                  <p className="text-xs text-muted">{student.projectGroupName ? `Group: ${student.projectGroupName}` : "Not assigned to a group"}</p>
                </div>
                <p className="text-sm text-text shrink-0">
                  {student.projectGrade.score != null ? `${student.projectGrade.score}/${student.projectGrade.maxScore}` : "Not graded"}
                </p>
              </li>
            )}
          </ul>
        )}
      </section>

      {weakestObjective && (
        <section className="mb-10">
          <h2 className="text-xs font-medium tracking-wide uppercase text-muted mb-3">Weakest evidence</h2>
          <div className="border border-danger/30 bg-danger-soft rounded-md px-5 py-4">
            <p className="text-sm font-medium text-text">{weakestObjective.title}</p>
            <p className="text-xs text-muted mt-1">
              {weakestObjective.assessment!.correct} / {weakestObjective.assessment!.attempted} correct on graded assessments
            </p>
          </div>
        </section>
      )}

      <section>
        <h2 className="text-xs font-medium tracking-wide uppercase text-muted mb-3">
          Learning profile — evidence by objective
        </h2>
        <p className="text-xs text-muted mb-4">
          Transparent evidence counts, never an opaque score. &quot;Trend&quot; compares recent practice accuracy against
          assessment accuracy on the same objective.
        </p>
        {student.objectives.length === 0 ? (
          <p className="text-sm text-muted">No learning objectives configured for this course yet.</p>
        ) : (
          <ul className="space-y-3">
            {student.objectives.map((o) => (
              <li key={o.learningObjectiveId} className="border border-border rounded-md px-5 py-4">
                <div className="flex items-center justify-between gap-3 mb-1">
                  <p className="text-sm font-medium text-text">{o.title}</p>
                  <span className="text-xs text-azure shrink-0">{o.trend}</span>
                </div>
                <p className="text-xs text-muted">
                  Assessment: {o.assessment ? `${o.assessment.correct}/${o.assessment.attempted} correct` : "no evidence"} ·
                  Practice: {o.practice ? `${o.practice.correct}/${o.practice.attempted} correct` : "no evidence"}
                </p>
                {o.misconception && !o.misconception.resolved && (
                  <p className="text-xs text-danger mt-1">Possible misconception: {o.misconception.description}</p>
                )}
                {o.misconception?.resolved && (
                  <p className="text-xs text-success mt-1">Resolved: {o.misconception.description}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
