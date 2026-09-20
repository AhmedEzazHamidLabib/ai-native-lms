import { notFound } from "next/navigation";
import { getProjectForCourse } from "@/lib/projects/actions";
import { getProjectInstructorOverview, getProjectDeliverables, getProjectSubmissions } from "@/lib/domain/project-instructor";

export default async function InstructorProjectOverviewPage({
  params,
}: PageProps<"/instructor/courses/[courseId]/project">) {
  const { courseId } = await params;
  const project = await getProjectForCourse(courseId);
  if (!project) notFound();

  const [overview, deliverables, submissions] = await Promise.all([
    getProjectInstructorOverview(project.id),
    getProjectDeliverables(project.id),
    getProjectSubmissions(project.id),
  ]);

  const totalStudents = overview.groups.reduce((n, g) => n + g.members.length, 0) + overview.unassignedStudents.length;
  const currentSubmissions = submissions.filter((s) => !s.superseded);
  const gradedGroups = overview.groups.filter((g) => g.grade !== null).length;

  return (
    <>
      {project.description && <p className="text-sm text-muted mb-8 max-w-2xl">{project.description}</p>}

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border border border-border rounded-md overflow-hidden mb-10">
        <div className="bg-warm-paper px-4 py-3">
          <p className="text-xl font-display text-ink">{overview.groups.length}</p>
          <p className="text-xs text-muted mt-0.5">Groups</p>
        </div>
        <div className="bg-warm-paper px-4 py-3">
          <p className="text-xl font-display text-ink">{overview.unassignedStudents.length}</p>
          <p className="text-xs text-muted mt-0.5">Unassigned students</p>
        </div>
        <div className="bg-warm-paper px-4 py-3">
          <p className="text-xl font-display text-ink">{deliverables.filter((d) => d.published).length}</p>
          <p className="text-xs text-muted mt-0.5">Published deliverables</p>
        </div>
        <div className="bg-warm-paper px-4 py-3">
          <p className="text-xl font-display text-ink">{currentSubmissions.length}</p>
          <p className="text-xs text-muted mt-0.5">Current submissions</p>
        </div>
      </section>

      <section className="text-sm text-text space-y-1.5 border border-border rounded-md px-5 py-4 max-w-lg">
        <p>
          Group mode:{" "}
          <span className="font-medium">
            {overview.groupMode === "self_enrollment" ? "Student self-enrollment" : "Instructor-assigned"}
          </span>
        </p>
        <p>
          Groups: <span className="font-medium">{overview.groupsLocked ? "Locked" : "Unlocked"}</span>
        </p>
        <p>
          Students: <span className="font-medium">{totalStudents}</span> total
        </p>
        <p>
          Grading: <span className="font-medium">{gradedGroups}</span>/{overview.groups.length} groups graded
        </p>
      </section>
    </>
  );
}
