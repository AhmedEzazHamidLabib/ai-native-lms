import { PageHeader } from "@/components/ui/page-header";
import { SubTabNav } from "@/components/ui/sub-tab-nav";
import { EmptyState } from "@/components/ui/empty-state";
import { getProjectForCourse } from "@/lib/projects/actions";

export default async function InstructorProjectLayout({
  children,
  params,
}: LayoutProps<"/instructor/courses/[courseId]/project">) {
  const { courseId } = await params;
  const project = await getProjectForCourse(courseId);

  if (!project) {
    return (
      <>
        <PageHeader title="Project" />
        <EmptyState
          title="No project configured"
          description="A project is created as a 'project'-kind assessment. Ask an owner to set one up if this course should have one."
        />
      </>
    );
  }

  const base = `/instructor/courses/${courseId}/project`;

  return (
    <>
      <PageHeader title="Project" />
      <SubTabNav
        tabs={[
          { label: "Overview", href: base },
          { label: "Groups", href: `${base}/groups` },
          { label: "Deliverables", href: `${base}/deliverables` },
          { label: "Submissions", href: `${base}/submissions` },
          { label: "Grades", href: `${base}/grades` },
        ]}
      />
      {children}
    </>
  );
}
