import { notFound } from "next/navigation";
import { getProjectForCourse } from "@/lib/projects/actions";
import { getProjectDeliverables } from "@/lib/domain/project-instructor";
import { ProjectDeliverablesManager } from "@/components/instructor/project-deliverables-manager";

export default async function InstructorProjectDeliverablesPage({
  params,
}: PageProps<"/instructor/courses/[courseId]/project/deliverables">) {
  const { courseId } = await params;
  const project = await getProjectForCourse(courseId);
  if (!project) notFound();

  const deliverables = await getProjectDeliverables(project.id);

  return <ProjectDeliverablesManager courseId={courseId} projectId={project.id} deliverables={deliverables} />;
}
