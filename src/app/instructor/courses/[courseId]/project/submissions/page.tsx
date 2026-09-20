import { notFound } from "next/navigation";
import { getProjectForCourse } from "@/lib/projects/actions";
import { getProjectSubmissions } from "@/lib/domain/project-instructor";
import { downloadProjectSubmission } from "@/lib/domain/project-instructor-actions";
import { ActionButton } from "@/components/ui/action-button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils/cn";

export default async function InstructorProjectSubmissionsPage({
  params,
}: PageProps<"/instructor/courses/[courseId]/project/submissions">) {
  const { courseId } = await params;
  const project = await getProjectForCourse(courseId);
  if (!project) notFound();

  const submissions = await getProjectSubmissions(project.id);

  if (submissions.length === 0) {
    return <EmptyState title="No submissions yet" description="Submissions will appear here once a group submits a deliverable." />;
  }

  return (
    <ul className="divide-y divide-border border-t border-b border-border">
      {submissions.map((s) => (
        <li key={s.id} className={cn("flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-1 py-4", s.superseded && "opacity-50")}>
          <div className="min-w-0">
            <p className="text-sm font-medium text-text">
              {s.deliverableTitle} · {s.groupName}
              {s.superseded && <span className="ml-2 text-xs text-muted uppercase">Superseded</span>}
            </p>
            <p className="text-xs text-muted mt-1">
              Submitted by {s.submittedByName} · {new Date(s.submittedAt).toLocaleString()}
            </p>
            {s.note && <p className="text-xs text-muted mt-1">Note: {s.note}</p>}
          </div>
          <ActionButton action={downloadProjectSubmission.bind(null, s.storagePath)} variant="secondary">
            Download
          </ActionButton>
        </li>
      ))}
    </ul>
  );
}
