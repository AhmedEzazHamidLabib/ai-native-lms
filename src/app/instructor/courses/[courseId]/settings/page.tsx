import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { ActionButton } from "@/components/ui/action-button";
import { getCourseMembership } from "@/lib/supabase/course";
import { setCourseAutoEnroll } from "@/lib/supabase/enrollment-actions";
import { getCourseSchedule } from "@/lib/domain/course-schedule";
import { setCourseRosterVisibilityAction } from "@/lib/domain/course-schedule-actions";
import { CourseScheduleForm } from "@/components/instructor/course-schedule-form";
import { getCourseAiUsageSummary, setCourseAiPaused } from "@/lib/tutor/ai-usage-actions";

export default async function InstructorCourseSettingsPage({
  params,
}: PageProps<"/instructor/courses/[courseId]/settings">) {
  const { courseId } = await params;
  const [membership, schedule, aiUsage] = await Promise.all([
    getCourseMembership(courseId),
    getCourseSchedule(courseId),
    getCourseAiUsageSummary(courseId),
  ]);
  if (!membership || !schedule) notFound();

  const { course } = membership;

  return (
    <>
      <PageHeader title="Settings" description="Course information, schedule, and classroom configuration." />

      <section className="mb-10 max-w-lg">
        <h2 className="text-xs font-medium tracking-wide uppercase text-muted mb-3">Course information</h2>
        <div className="border border-border rounded-md px-5 py-4">
          <p className="text-sm text-text font-medium">{course.code}</p>
          <p className="text-sm text-muted">{course.title}</p>
          <p className="text-xs text-muted mt-1">{course.term}</p>
        </div>
      </section>

      <section className="mb-10 max-w-lg">
        <h2 className="text-xs font-medium tracking-wide uppercase text-muted mb-3">Enrollment</h2>
        <div className="border border-border rounded-md px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-text font-medium">Automatically enroll new students</p>
            <p className="text-xs text-muted mt-1">
              {course.autoEnroll
                ? "On — students who choose this course get access immediately."
                : "Off — new students submit a request you approve or reject. Everyone already enrolled keeps their access either way."}
            </p>
          </div>
          <ActionButton action={setCourseAutoEnroll.bind(null, courseId, !course.autoEnroll)} variant={course.autoEnroll ? "secondary" : "primary"}>
            {course.autoEnroll ? "Turn off" : "Turn on"}
          </ActionButton>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-xs font-medium tracking-wide uppercase text-muted mb-3">Course schedule</h2>
        <CourseScheduleForm courseId={courseId} schedule={schedule} />
      </section>

      <section className="mb-10 max-w-lg">
        <h2 className="text-xs font-medium tracking-wide uppercase text-muted mb-3">Student directory</h2>
        <div className="border border-border rounded-md px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-text font-medium">Students can see classmates&apos; names</p>
            <p className="text-xs text-muted mt-1">
              {schedule.studentsCanSeeRoster
                ? "On — enrolled students can see each other's names on Classmates. Emails are never shown."
                : "Off — students only see themselves on Classmates."}
            </p>
          </div>
          <ActionButton
            action={setCourseRosterVisibilityAction.bind(null, courseId, !schedule.studentsCanSeeRoster)}
            variant={schedule.studentsCanSeeRoster ? "secondary" : "primary"}
          >
            {schedule.studentsCanSeeRoster ? "Turn off" : "Turn on"}
          </ActionButton>
        </div>
      </section>

      <section className="max-w-lg">
        <h2 className="text-xs font-medium tracking-wide uppercase text-muted mb-3">AI Tutor</h2>
        <div className="border border-border rounded-md px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-text font-medium">
              AI Tutor for this course: {aiUsage.coursePaused || aiUsage.globalPaused ? "Paused" : "On"}
            </p>
            <p className="text-xs text-muted mt-1">
              <Link href={`/instructor/courses/${courseId}/ai-usage`} className="text-azure hover:underline">
                View usage and detailed controls →
              </Link>
            </p>
          </div>
          <ActionButton action={setCourseAiPaused.bind(null, courseId, !aiUsage.coursePaused)} variant={aiUsage.coursePaused ? "primary" : "secondary"}>
            {aiUsage.coursePaused ? "Resume" : "Pause"}
          </ActionButton>
        </div>
      </section>
    </>
  );
}
