import { PageHeader } from "@/components/ui/page-header";
import { ActionButton } from "@/components/ui/action-button";
import { getCourseAiUsageSummary, setCourseAiPaused, setGlobalAiPaused } from "@/lib/tutor/ai-usage-actions";

export default async function InstructorAiUsagePage({
  params,
}: PageProps<"/instructor/courses/[courseId]/ai-usage">) {
  const { courseId } = await params;
  const summary = await getCourseAiUsageSummary(courseId);

  const effectivelyPaused = summary.coursePaused || summary.globalPaused;

  return (
    <>
      <PageHeader
        title="AI Tutor"
        description="Pilot usage limits and controls. Pausing only affects new AI generations — materials, Practice, Assessments, Projects, and Grades keep working."
      />

      <section className="mb-10 border border-border rounded-md px-5 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-medium text-text">
              Course AI Tutor: {effectivelyPaused ? "Paused" : "On"}
            </p>
            {summary.globalPaused && !summary.coursePaused && (
              <p className="text-xs text-muted mt-1">Paused globally by the owner, not by this course&apos;s setting.</p>
            )}
          </div>
          <ActionButton
            action={setCourseAiPaused.bind(null, courseId, !summary.coursePaused)}
            variant={summary.coursePaused ? "primary" : "secondary"}
          >
            {summary.coursePaused ? "Resume for this course" : "Pause for this course"}
          </ActionButton>
        </div>

        {summary.isOwner && (
          <div className="flex items-center justify-between pt-4 border-t border-border">
            <p className="text-sm font-medium text-text">
              Global AI Tutor (all courses): {summary.globalPaused ? "Paused" : "On"}
            </p>
            <ActionButton
              action={setGlobalAiPaused.bind(null, courseId, !summary.globalPaused)}
              variant={summary.globalPaused ? "primary" : "secondary"}
            >
              {summary.globalPaused ? "Resume globally" : "Pause globally"}
            </ActionButton>
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-border border border-border rounded-md overflow-hidden mb-10">
        <div className="bg-warm-paper px-5 py-4">
          <p className="text-2xl font-display text-ink">
            {summary.studentGenerationsToday} / {summary.courseDailyLimit}
          </p>
          <p className="text-xs text-muted mt-1">Student AI generations today (this course)</p>
        </div>
        <div className="bg-warm-paper px-5 py-4">
          <p className="text-2xl font-display text-ink">
            {summary.inputTokensToday.toLocaleString()} / {summary.outputTokensToday.toLocaleString()}
          </p>
          <p className="text-xs text-muted mt-1">Input / output tokens today</p>
        </div>
        <div className="bg-warm-paper px-5 py-4">
          <p className="text-2xl font-display text-ink">{summary.failedToday}</p>
          <p className="text-xs text-muted mt-1">Failed generations today</p>
        </div>
      </section>

      <section>
        <h2 className="text-xs font-medium tracking-wide uppercase text-muted mb-3">Pilot limits</h2>
        <ul className="text-sm text-text space-y-1.5">
          <li>{summary.studentDailyLimit} generations per student per day</li>
          <li>{summary.courseDailyLimit} student generations per course per day</li>
          <li>{summary.globalDailyLimit} student generations across all courses per day</li>
        </ul>
        <p className="text-xs text-muted mt-3">
          These limits apply to students only — instructor and owner use is tracked separately and is never
          limited or paused by these controls.
        </p>
      </section>
    </>
  );
}
