import Link from "next/link";
import { getCourseMembership } from "@/lib/supabase/course";
import { CourseContextBar, type CourseNavSection } from "@/components/shell/course-context-bar";

export default async function StudentCourseLayout({
  children,
  params,
}: LayoutProps<"/student/courses/[courseId]">) {
  const { courseId } = await params;
  const membership = await getCourseMembership(courseId);

  if (!membership || membership.role !== "student") {
    return (
      <div className="max-w-md">
        <p className="font-display text-xl text-ink mb-2">
          You don&apos;t have access to this course
        </p>
        <p className="text-sm text-muted mb-6">
          You&apos;re not enrolled here, or your access was removed.
        </p>
        <Link
          href="/student/courses"
          className="text-sm text-azure hover:underline underline-offset-2"
        >
          Browse available courses
        </Link>
      </div>
    );
  }

  const base = `/student/courses/${courseId}`;

  // Not restructured this pass (the reported crowding was specifically
  // the instructor experience) — same 12 destinations, just expressed
  // as flat single-item sections for the shared two-tier component.
  const sections: CourseNavSection[] = [
    { label: "Home", href: base, exactOnly: true },
    { label: "Announcements", href: `${base}/announcements` },
    { label: "Calendar", href: `${base}/calendar` },
    { label: "Course", href: `${base}/course` },
    { label: "Materials", href: `${base}/materials` },
    { label: "Practice", href: `${base}/practice` },
    { label: "Assessments", href: `${base}/assessments` },
    { label: "Project", href: `${base}/project` },
    { label: "Grades", href: `${base}/grades` },
    { label: "Performance", href: `${base}/performance` },
    { label: "AI Tutor", href: `${base}/tutor` },
    { label: "Learn with AI", href: `${base}/learn-with-ai`, badge: "New" },
    { label: "Classmates", href: `${base}/members` },
  ];

  return (
    <>
      <CourseContextBar
        backHref="/student"
        courseCode={membership.course.code}
        courseTitle={membership.course.title}
        sections={sections}
      />
      {children}
    </>
  );
}
