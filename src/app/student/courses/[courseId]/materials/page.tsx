import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { getCourseContent } from "@/lib/domain/queries";
import { lecturesForUnit, publishedOnly, unitsForCourse, notArchived } from "@/lib/domain/selectors";

export default async function StudentMaterialsPage({
  params,
}: PageProps<"/student/courses/[courseId]/materials">) {
  const { courseId } = await params;
  const { course, units: allUnits, lectures: allLectures } = await getCourseContent(courseId);

  const units = notArchived(unitsForCourse(allUnits, course.id));
  const publishedLectures = units.flatMap((u) => publishedOnly(lecturesForUnit(allLectures, u.id)));

  return (
    <>
      <PageHeader title="Materials" description="Course presentations, in the order they're taught." />

      {publishedLectures.length === 0 ? (
        <EmptyState title="Nothing published yet" description="Your instructor hasn't published a lecture yet." />
      ) : (
        <ul className="divide-y divide-border border-t border-b border-border">
          {publishedLectures.map((l) => (
            <li key={l.id}>
              <Link
                href={`/student/courses/${courseId}/course/lecture/${l.id}`}
                className="flex items-center justify-between gap-3 px-1 py-4 hover:bg-black/[0.02] transition-colors duration-[180ms]"
              >
                <span className="text-sm font-medium text-text">{l.title}</span>
                <span className="text-sm text-azure shrink-0">Open Presentation →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
