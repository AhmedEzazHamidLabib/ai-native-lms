import { notFound } from "next/navigation";
import { getProjectForCourse } from "@/lib/projects/actions";
import { getProjectInstructorOverview } from "@/lib/domain/project-instructor";
import { getCourseRoster } from "@/lib/domain/roster";
import { ProjectGroupsManager } from "@/components/instructor/project-groups-manager";

export default async function InstructorProjectGroupsPage({
  params,
}: PageProps<"/instructor/courses/[courseId]/project/groups">) {
  const { courseId } = await params;
  const project = await getProjectForCourse(courseId);
  if (!project) notFound();

  const [overview, roster] = await Promise.all([
    getProjectInstructorOverview(project.id),
    getCourseRoster(courseId),
  ]);

  return (
    <ProjectGroupsManager
      courseId={courseId}
      projectId={project.id}
      initialOverview={overview}
      roster={roster.map((r) => ({ userId: r.userId, email: r.email, fullName: r.fullName }))}
    />
  );
}
