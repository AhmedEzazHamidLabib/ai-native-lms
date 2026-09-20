import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { CourseCard } from "@/components/course/course-card";
import { EnrollButton } from "@/components/course/enroll-button";
import { getMyCourses, getAllCoursesWithStatus, getMyFullName } from "@/lib/supabase/course";
import { ProfileCompletionBanner } from "@/components/profile/profile-completion-banner";

export default async function MyCoursesPage() {
  const [memberships, fullName] = await Promise.all([getMyCourses(), getMyFullName()]);
  const studentCourses = memberships.filter((m) => m.role === "student");

  // A student with zero memberships must never hit a dead end here —
  // show the joinable courses directly, one tap away, instead of only
  // pointing at a second page (see docs/DECISIONS.md, onboarding fix).
  const availableCourses =
    studentCourses.length === 0 ? await getAllCoursesWithStatus() : [];
  const joinableCourses = availableCourses.filter((c) => c.status === "none" || c.status === "pending");

  return (
    <>
      <PageHeader title="My Courses" />
      {!fullName && <ProfileCompletionBanner />}

      {studentCourses.length === 0 ? (
        <div className="border border-dashed border-border rounded-md px-6 py-10">
          <p className="font-display text-lg text-text text-center">
            No courses yet
          </p>
          <p className="mt-1.5 text-sm text-muted max-w-md mx-auto text-center">
            Choose a course below to get started.
          </p>

          {joinableCourses.length > 0 ? (
            <ul className="space-y-3 mt-6 max-w-lg mx-auto text-left">
              {joinableCourses.map((c) => (
                <CourseCard
                  key={c.id}
                  code={c.code}
                  title={c.title}
                  term={c.term}
                  action={
                    <EnrollButton
                      courseId={c.id}
                      autoEnroll={c.autoEnroll}
                      initialStatus={c.status === "pending" ? "pending" : "idle"}
                    />
                  }
                />
              ))}
            </ul>
          ) : (
            <p className="mt-5 text-sm text-muted text-center">
              Nothing has been set up in the LMS yet.
            </p>
          )}

          <div className="mt-5 flex justify-center">
            <Link
              href="/student/courses"
              className="text-sm text-azure hover:underline underline-offset-2"
            >
              Browse all available courses →
            </Link>
          </div>
        </div>
      ) : (
        <>
          <ul className="space-y-3 mb-8">
            {studentCourses.map((m) => (
              <CourseCard
                key={m.courseId}
                code={m.course.code}
                title={m.course.title}
                term={m.course.term}
                action={
                  <Link
                    href={`/student/courses/${m.courseId}`}
                    className="inline-flex items-center justify-center rounded-md bg-ink text-warm-paper px-4 py-2 text-sm font-medium hover:bg-azure transition-colors duration-[180ms] w-full sm:w-auto"
                  >
                    Open Course
                  </Link>
                }
              />
            ))}
          </ul>
          <Link
            href="/student/courses"
            className="text-sm text-azure hover:underline underline-offset-2"
          >
            Browse more courses →
          </Link>
        </>
      )}
    </>
  );
}
