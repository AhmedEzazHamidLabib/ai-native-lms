import Link from "next/link";
import { getCourseMembership } from "@/lib/supabase/course";
import { CourseContextBar, type CourseNavSection } from "@/components/shell/course-context-bar";

export default async function InstructorCourseLayout({
  children,
  params,
}: LayoutProps<"/instructor/courses/[courseId]">) {
  const { courseId } = await params;
  const membership = await getCourseMembership(courseId);

  if (!membership || membership.role !== "instructor") {
    return (
      <div className="max-w-md">
        <p className="font-display text-xl text-ink mb-2">
          You don&apos;t have access to this course
        </p>
        <p className="text-sm text-muted mb-6">
          You&apos;re not an instructor here.
        </p>
        <Link href="/instructor" className="text-sm text-azure hover:underline underline-offset-2">
          Back to your courses
        </Link>
      </div>
    );
  }

  const base = `/instructor/courses/${courseId}`;

  // Six peer-level sections instead of twelve — a presentation/
  // navigation grouping only. Every href below is an existing route;
  // nothing moved underneath this, so no deep link breaks.
  const sections: CourseNavSection[] = [
    { label: "Overview", href: base, exactOnly: true },
    {
      label: "Course Content",
      href: `${base}/content`,
      matchPrefixes: [`${base}/calendar`, `${base}/announcements`],
      subTabs: [
        { label: "Materials", href: `${base}/content` },
        { label: "Calendar", href: `${base}/calendar` },
        { label: "Announcements", href: `${base}/announcements` },
      ],
    },
    {
      label: "Assessments",
      href: `${base}/assessments`,
      matchPrefixes: [`${base}/question-bank`, `${base}/project`],
      subTabs: [
        { label: "Tests", href: `${base}/assessments` },
        { label: "Question Bank", href: `${base}/question-bank` },
        { label: "Project", href: `${base}/project` },
      ],
    },
    {
      label: "Students",
      href: `${base}/students`,
      matchPrefixes: [`${base}/gradebook`],
      subTabs: [
        { label: "Roster", href: `${base}/students` },
        { label: "Gradebook", href: `${base}/gradebook` },
      ],
    },
    {
      label: "Insights",
      href: `${base}/performance`,
      matchPrefixes: [`${base}/content/intelligence`, `${base}/ai-usage`],
      subTabs: [
        { label: "Performance", href: `${base}/performance` },
        { label: "AI Tutor", href: `${base}/content/intelligence` },
        { label: "AI Usage", href: `${base}/ai-usage` },
      ],
    },
    { label: "Course Settings", href: `${base}/settings` },
  ];

  return (
    <>
      <CourseContextBar
        backHref="/instructor"
        backLabel="Your courses"
        courseCode={membership.course.code}
        courseTitle={membership.course.title}
        sections={sections}
      />
      {children}
    </>
  );
}
