import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { getCourseMembersDirectory } from "@/lib/domain/course-members";
import { cn } from "@/lib/utils/cn";

export default async function CourseMembersPage({
  params,
}: PageProps<"/student/courses/[courseId]/members">) {
  const { courseId } = await params;
  const members = await getCourseMembersDirectory(courseId);

  return (
    <>
      <PageHeader title="Classmates" description="Everyone enrolled in this course. Names only — no contact details are shared here." />

      {members.length === 0 ? (
        <EmptyState title="No classmates yet" description="You're the only one enrolled so far." />
      ) : (
        <ul className="divide-y divide-border border-t border-b border-border">
          {members.map((m) => (
            <li key={m.userId} className={cn("px-1 py-3", m.isMe && "bg-azure-soft/20")}>
              <p className="text-sm text-text">
                {m.fullName}
                {m.isMe && <span className="ml-2 text-xs text-azure">(you)</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
