import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { getCourseContent } from "@/lib/domain/queries";
import { getStudentAnnouncements } from "@/lib/domain/announcements";
import { AnnouncementList } from "@/components/announcements/announcement-list";
import { lecturesForUnit, materialsForLecture, publishedOnly, unitsForCourse, notArchived } from "@/lib/domain/selectors";

export default async function StudentCourseHomePage({
  params,
}: PageProps<"/student/courses/[courseId]">) {
  const { courseId } = await params;

  const [{ course, units: allUnits, lectures: allLectures, materials: allMaterials }, announcements] = await Promise.all([
    getCourseContent(courseId),
    getStudentAnnouncements(courseId),
  ]);

  const units = notArchived(unitsForCourse(allUnits, course.id));
  const publishedLectures = publishedOnly(
    units.flatMap((u) => lecturesForUnit(allLectures, u.id)),
  ).sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));

  const nextLecture = publishedLectures[0];
  const recentAnnouncements = announcements.slice(0, 2);

  return (
    <>
      <PageHeader
        eyebrow={course.term}
        title={course.title}
        description={`${course.code} · what's published so far, and what's next.`}
      />

      {recentAnnouncements.length > 0 && (
        <section className="mb-10">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-medium tracking-wide uppercase text-muted">Announcements</h2>
            {announcements.length > 2 && (
              <Link href={`/student/courses/${courseId}/announcements`} className="text-xs text-azure hover:underline">
                View all
              </Link>
            )}
          </div>
          <AnnouncementList announcements={recentAnnouncements} />
        </section>
      )}

      {publishedLectures.length === 0 ? (
        <EmptyState
          title="No published content yet"
          description="Your instructor hasn't published any lectures. Check back once the course opens."
        />
      ) : (
        <div className="space-y-10">
          <section>
            <h2 className="text-xs font-medium tracking-wide uppercase text-muted mb-3">
              Most recent
            </h2>
            <Link
              href={`/student/courses/${courseId}/course/lecture/${nextLecture.id}`}
              className="block border border-border rounded-md px-5 py-4 hover:border-azure transition-colors duration-[180ms] group"
            >
              <p className="font-display text-xl text-ink group-hover:text-azure transition-colors duration-[180ms]">
                {nextLecture.title}
              </p>
              <p className="mt-1 text-sm text-muted">
                {materialsForLecture(allMaterials, nextLecture.id).length}{" "}
                material
                {materialsForLecture(allMaterials, nextLecture.id).length === 1
                  ? ""
                  : "s"}{" "}
                available
              </p>
            </Link>
          </section>

          <section>
            <h2 className="text-xs font-medium tracking-wide uppercase text-muted mb-3">
              All published lectures
            </h2>
            <ul className="divide-y divide-border border-t border-b border-border">
              {publishedLectures.map((lecture) => (
                <li key={lecture.id}>
                  <Link
                    href={`/student/courses/${courseId}/course/lecture/${lecture.id}`}
                    className="flex items-center justify-between px-1 py-3 hover:bg-black/[0.02] transition-colors duration-[180ms]"
                  >
                    <span className="text-sm text-text">{lecture.title}</span>
                    <span className="text-xs text-muted">
                      {lecture.scheduledFor}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </>
  );
}
