import { notFound } from "next/navigation";
import { getProjectForCourse } from "@/lib/projects/actions";
import { getProjectInstructorOverview } from "@/lib/domain/project-instructor";
import { ProjectGradesManager } from "@/components/instructor/project-grades-manager";

export default async function InstructorProjectGradesPage({
  params,
}: PageProps<"/instructor/courses/[courseId]/project/grades">) {
  const { courseId } = await params;
  const project = await getProjectForCourse(courseId);
  if (!project) notFound();

  const overview = await getProjectInstructorOverview(project.id);

  return (
    <ProjectGradesManager
      courseId={courseId}
      projectId={project.id}
      groups={overview.groups}
      pointsPossible={project.pointsPossible}
    />
  );
}
