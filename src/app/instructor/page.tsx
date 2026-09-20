import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { CourseCard } from "@/components/course/course-card";
import { getInstructorCourses, getMyFullName } from "@/lib/supabase/course";
import { ProfileCompletionBanner } from "@/components/profile/profile-completion-banner";

export default async function InstructorOverviewPage() {
  const [courses, fullName] = await Promise.all([getInstructorCourses(), getMyFullName()]);

  return (
    <>
      <PageHeader
        title="Your courses"
        description="Pick a course to manage its content, assessments, and roster."
      />
      {!fullName && (
        <ProfileCompletionBanner message="Add your name so students and co-instructors can recognize you." />
      )}

      {courses.length === 0 ? (
        <EmptyState
          title="No courses yet"
          description="You aren't set up as an instructor on any course."
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
                <Link
                  href={`/instructor/courses/${c.id}`}
                  className="inline-flex items-center justify-center rounded-md bg-ink text-warm-paper px-4 py-2 text-sm font-medium hover:bg-azure transition-colors duration-[180ms] w-full sm:w-auto"
                >
                  Manage course
                </Link>
              }
            />
          ))}
        </ul>
      )}
    </>
  );
}
