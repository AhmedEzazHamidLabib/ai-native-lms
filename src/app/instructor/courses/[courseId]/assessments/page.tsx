import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { AssessmentBuilder } from "@/components/instructor/assessment-builder";
import { getInstructorAssessments } from "@/lib/domain/assessments";
import { getQuestionBanksForCourse, getQuestionsForCourse } from "@/lib/domain/question-bank";
import { getCourseContent } from "@/lib/domain/queries";

export default async function InstructorAssessmentsPage({
  params,
}: PageProps<"/instructor/courses/[courseId]/assessments">) {
  const { courseId } = await params;
  const [assessments, banks, questions, content] = await Promise.all([
    getInstructorAssessments(courseId),
    getQuestionBanksForCourse(courseId),
    getQuestionsForCourse(courseId),
    getCourseContent(courseId),
  ]);
  const lectures = content.lectures.map((l) => ({ id: l.id, title: l.title }));

  return (
    <>
      <PageHeader
        title="Assessments"
        description="Mock Tests and Class Tests draw from the Question Bank. Publishing makes a test visible to students; unlocking is what actually lets them start it."
      />

      <div className="mb-8">
        {banks.length === 0 ? (
          <p className="text-xs text-muted border border-border rounded-md px-4 py-3">
            Add questions in the Question Bank first — an assessment needs a bank to draw from.
          </p>
        ) : (
          <AssessmentBuilder courseId={courseId} banks={banks} lectures={lectures} questions={questions} />
        )}
      </div>

      {assessments.length === 0 ? (
        <EmptyState
          title="No assessments yet"
          description="Assessments are created from a reviewed question bank — none have been ingested yet."
        />
      ) : (
        <ul className="divide-y divide-border border-t border-b border-border">
          {assessments.map((a) => (
            <li key={a.id}>
              <Link
                href={`/instructor/courses/${courseId}/assessments/${a.id}`}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-1 py-4 hover:bg-black/[0.02] transition-colors duration-[180ms]"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text">{a.title}</p>
                  <p className="text-xs text-muted mt-1">
                    {a.questionCount} questions ·{" "}
                    {a.selectionMode === "fixed"
                      ? `fixed selection, ${a.questionOrderMode} order`
                      : a.ruleBreakdown.map((r) => `${r.count} from ${r.lectureTitle ?? "any"}`).join(" + ")}{" "}
                    · {a.submittedCount}/{a.attemptCount} submitted
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide uppercase " +
                      (a.kind === "class_test"
                        ? "text-danger border-danger/30 bg-danger-soft"
                        : "text-muted border-border")
                    }
                  >
                    {a.kind === "class_test" ? "Class Test" : "Mock Test"}
                  </span>
                  <StatusPill status={a.publishedAt ? "PUBLISHED" : "DRAFT"} />
                  <span
                    className={
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide uppercase " +
                      (a.locked
                        ? "text-muted border-border"
                        : "text-azure border-azure/30 bg-azure-soft/40")
                    }
                  >
                    {a.locked ? "Locked" : "Unlocked"}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
