import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { CourseCard } from "@/components/course/course-card";
import { EnrollButton } from "@/components/course/enroll-button";
import { getAllCoursesWithStatus } from "@/lib/supabase/course";

export default async function AvailableCoursesPage() {
  const courses = await getAllCoursesWithStatus();

  return (
    <>
      <PageHeader
        title="Available Courses"
        description="Choose a course to join. You can be enrolled in more than one at a time."
      />

      {courses.length === 0 ? (
        <EmptyState
          title="No courses yet"
          description="Nothing has been set up in the LMS yet."
        />
      ) : (
        <ul className="space-y-3">
          {courses.map((c) => (
            <CourseCard
              key={c.id}
              code={c.code}
              title={c.title}
              term={c.term}
              action={
                c.status === "enrolled_student" || c.status === "enrolled_instructor" ? (
                  <Link
                    href={`/student/courses/${c.id}`}
                    className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium hover:border-ink transition-colors duration-[180ms] w-full sm:w-auto"
                  >
                    Open Course
                  </Link>
                ) : (
                  <EnrollButton
                    courseId={c.id}
                    autoEnroll={c.autoEnroll}
                    initialStatus={c.status === "pending" ? "pending" : "idle"}
                  />
                )
              }
            />
          ))}
        </ul>
      )}
    </>
  );
}
