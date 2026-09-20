import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { getGradebookSummary } from "@/lib/domain/roster";
import { cn } from "@/lib/utils/cn";
import type { GradebookStatus } from "@/lib/domain/assessment-types";

const STATUS_LABEL: Record<GradebookStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  submitted: "Submitted",
};

export default async function InstructorGradebookPage({
  params,
}: PageProps<"/instructor/courses/[courseId]/gradebook">) {
  const { courseId } = await params;
  const students = await getGradebookSummary(courseId);

  if (students.length === 0) {
    return (
      <>
        <PageHeader title="Gradebook" description="How each enrolled student is doing, assessment by assessment." />
        <EmptyState title="No enrolled students yet" description="Once students enroll, their results will appear here." />
      </>
    );
  }

  // Assessment columns come from whatever is actually configured for
  // this course right now — never hardcoded to "Mock/Class/Project."
  const columns = new Map<string, { title: string; kind: string }>();
  for (const s of students) {
    for (const a of s.assessments) {
      if (!columns.has(a.assessmentId)) columns.set(a.assessmentId, { title: a.title, kind: a.kind });
    }
  }
  const hasProject = students.some((s) => s.project !== null);

  const submittedAnywhere = students.filter((s) => s.assessments.some((a) => a.status === "submitted")).length;

  return (
    <>
      <PageHeader title="Gradebook" description="How each enrolled student is doing, assessment by assessment." />

      <section className="mb-8 grid grid-cols-2 sm:grid-cols-3 gap-px bg-border border border-border rounded-md overflow-hidden max-w-lg">
        <div className="bg-warm-paper px-5 py-4">
          <p className="text-2xl font-display text-ink">{students.length}</p>
          <p className="text-xs text-muted mt-1">Enrolled students</p>
        </div>
        <div className="bg-warm-paper px-5 py-4">
          <p className="text-2xl font-display text-ink">{submittedAnywhere}</p>
          <p className="text-xs text-muted mt-1">Submitted at least one</p>
        </div>
        <div className="bg-warm-paper px-5 py-4">
          <p className="text-2xl font-display text-ink">{columns.size}</p>
          <p className="text-xs text-muted mt-1">Assessments configured</p>
        </div>
      </section>

      <ul className="divide-y divide-border border-t border-b border-border">
        {students.map((s) => (
          <li key={s.userId}>
            <Link
              href={`/instructor/courses/${courseId}/students/${s.userId}`}
              className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-1 py-4 hover:bg-black/[0.02] transition-colors duration-[180ms]"
            >
              <div className="min-w-0 shrink-0 sm:w-48">
                <p className="text-sm font-medium text-text truncate">{s.fullName ?? s.email}</p>
                {s.fullName && <p className="text-xs text-muted truncate">{s.email}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                {[...columns.entries()].map(([assessmentId, col]) => {
                  const a = s.assessments.find((x) => x.assessmentId === assessmentId);
                  return (
                    <div key={assessmentId} className="text-xs">
                      <p className="text-muted">{col.title}</p>
                      {a?.status === "submitted" ? (
                        <p className="text-text font-medium">
                          {a.score}/{a.maxScore}
                        </p>
                      ) : (
                        <p className={cn(a?.status === "in_progress" ? "text-azure" : "text-muted")}>
                          {STATUS_LABEL[a?.status ?? "not_started"]}
                        </p>
                      )}
                    </div>
                  );
                })}
                {hasProject && (
                  <div className="text-xs">
                    <p className="text-muted">Project</p>
                    {s.project?.score != null ? (
                      <p className="text-text font-medium">
                        {s.project.score}/{s.project.maxScore}
                      </p>
                    ) : (
                      <p className="text-muted">{s.project?.groupName ? "Not graded" : "No group"}</p>
                    )}
                  </div>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
