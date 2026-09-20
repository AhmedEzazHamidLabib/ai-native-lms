import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { getStudentAssessments } from "@/lib/domain/assessments";

const KIND_LABEL: Record<string, string> = {
  mock_test: "Mock Test",
  class_test: "Class Test",
  project: "Project",
};

export default async function StudentAssessmentsPage({
  params,
}: PageProps<"/student/courses/[courseId]/assessments">) {
  const { courseId } = await params;
  const assessments = await getStudentAssessments(courseId);

  return (
    <>
      <PageHeader
        title="Assessments"
        description="Mock tests are ungraded practice. Class Test and Project marks count toward your final grade."
      />

      {assessments.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          description="Your instructor hasn't published any assessments."
        />
      ) : (
        <ul className="divide-y divide-border border-t border-b border-border">
          {assessments.map((a) => {
            const href =
              a.kind === "project"
                ? `/student/courses/${courseId}/project`
                : `/student/courses/${courseId}/assessments/${a.id}`;
            return (
              <li key={a.id}>
                <Link
                  href={href}
                  className="flex items-center justify-between gap-3 px-1 py-4 hover:bg-black/[0.02] transition-colors duration-[180ms]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] font-medium tracking-wide uppercase text-azure">
                        {a.isDiagnostic ? "Practice Test" : (KIND_LABEL[a.kind] ?? a.kind)}
                      </span>
                      {!a.contributesToGrade && (
                        <span className="text-[10px] text-muted">· Does not affect grade</span>
                      )}
                      {a.contributesToGrade && a.pointsPossible != null && (
                        <span className="text-[10px] text-muted">· {a.pointsPossible} marks</span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-text">{a.title}</p>
                    {a.kind !== "project" && (
                      <p className="text-xs text-muted mt-1">{a.questionCount} questions</p>
                    )}
                  </div>
                  {a.kind !== "project" && (
                    <span className="text-xs text-muted shrink-0">
                      {a.submittedAt
                        ? `Submitted · ${a.score}/${a.maxScore}`
                        : a.attemptId
                          ? "In progress"
                          : a.locked
                            ? "Not open yet"
                            : "Not started"}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
