import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { getCourseContent } from "@/lib/domain/queries";
import {
  lecturesForUnit,
  materialsForLecture,
  publishedOnly,
  unitsForCourse,
  notArchived,
} from "@/lib/domain/selectors";

const MATERIAL_ICON: Record<string, string> = {
  pptx: "Slides",
  pdf: "PDF",
  document: "Doc",
  link: "Link",
  video: "Video",
};

export default async function StudentCoursePage({
  params,
}: PageProps<"/student/courses/[courseId]/course">) {
  const { courseId } = await params;

  const { course, units: allUnits, lectures: allLectures, materials: allMaterials } =
    await getCourseContent(courseId);

  const units = notArchived(unitsForCourse(allUnits, course.id));

  const unitsWithPublishedLectures = units
    .map((unit) => ({
      unit,
      lectures: publishedOnly(lecturesForUnit(allLectures, unit.id)),
    }))
    .filter((u) => u.lectures.length > 0);

  return (
    <>
      <PageHeader
        eyebrow={course.code}
        title="Course"
        description="Units and lectures, in the order your instructor teaches them."
      />

      {unitsWithPublishedLectures.length === 0 ? (
        <EmptyState
          title="Nothing published yet"
          description="Once your instructor publishes a lecture, it will appear here."
        />
      ) : (
        <div className="space-y-12">
          {unitsWithPublishedLectures.map(({ unit, lectures }) => (
            <section key={unit.id}>
              <h2 className="font-display text-xl text-ink mb-4">
                {unit.title}
              </h2>
              <ul className="space-y-3">
                {lectures.map((lecture) => {
                  const materials = publishedOnly(
                    materialsForLecture(allMaterials, lecture.id),
                  );
                  return (
                    <li
                      key={lecture.id}
                      className="border border-border rounded-md px-5 py-4"
                    >
                      <Link
                        href={`/student/courses/${courseId}/course/lecture/${lecture.id}`}
                        className="text-sm font-medium text-text hover:text-azure transition-colors duration-[180ms]"
                      >
                        {lecture.title}
                      </Link>
                      {materials.length === 0 ? (
                        <p className="mt-2 text-xs text-muted">
                          No materials published yet.
                        </p>
                      ) : (
                        <ul className="mt-3 flex flex-wrap gap-2">
                          {materials.map((m) => (
                            <li key={m.id}>
                              <span className="inline-flex items-center gap-1.5 text-xs text-muted border border-border rounded-full px-2.5 py-1">
                                {MATERIAL_ICON[m.kind]} {m.title}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
