import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionButton } from "@/components/ui/action-button";
import { QuestionForm } from "@/components/instructor/question-form";
import { QuestionImport } from "@/components/instructor/question-import";
import { getQuestionBanksForCourse, getQuestionsForCourse } from "@/lib/domain/question-bank";
import {
  toggleQuestionVisibility,
  toggleQuestionActive,
  deleteQuestionAction,
} from "@/lib/domain/question-bank-actions";
import { getCourseContent } from "@/lib/domain/queries";
import { createClient } from "@/lib/supabase/server";
import { getLearningObjectives } from "@/lib/tutor/evidence";
import { cn } from "@/lib/utils/cn";

export default async function InstructorQuestionBankPage({
  params,
}: PageProps<"/instructor/courses/[courseId]/question-bank">) {
  const { courseId } = await params;
  const supabase = await createClient();

  const [banks, questions, content, objectives] = await Promise.all([
    getQuestionBanksForCourse(courseId),
    getQuestionsForCourse(courseId),
    getCourseContent(courseId),
    getLearningObjectives(supabase, courseId),
  ]);

  const lectures = content.lectures.map((l) => ({ id: l.id, title: l.title }));
  const practiceCount = questions.filter((q) => q.visibility === "practice").length;
  const hiddenCount = questions.filter((q) => q.visibility === "hidden").length;

  return (
    <>
      <PageHeader
        title="Question Bank"
        description="Practice questions can reach students through Practice and Ask AI to Explain. Hidden questions are only ever usable in a Class Test — never exposed to Practice or the Tutor."
      />

      <section className="mb-8 grid grid-cols-2 gap-px bg-border border border-border rounded-md overflow-hidden max-w-sm">
        <div className="bg-warm-paper px-4 py-3">
          <p className="text-xl font-display text-ink">{practiceCount}</p>
          <p className="text-xs text-muted mt-0.5">Practice-visible</p>
        </div>
        <div className="bg-warm-paper px-4 py-3">
          <p className="text-xl font-display text-ink">{hiddenCount}</p>
          <p className="text-xs text-muted mt-0.5">Hidden (Class Test pool)</p>
        </div>
      </section>

      <div className="space-y-6 mb-10">
        <QuestionForm courseId={courseId} banks={banks} lectures={lectures} objectives={objectives} />
        <QuestionImport courseId={courseId} banks={banks} lectures={lectures} />
      </div>

      {questions.length === 0 ? (
        <EmptyState title="No questions yet" description="Create or import your first question above." />
      ) : (
        <ul className="divide-y divide-border border-t border-b border-border">
          {questions.map((q) => {
            const correctOption = q.options.find((o) => o.isCorrect);
            const lectureTitle = lectures.find((l) => l.id === q.sourceLectureId)?.title;
            const objectiveTitle = objectives.find((o) => o.id === q.learningObjectiveId)?.title;
            return (
              <li key={q.id} className={cn("px-1 py-4", !q.active && "opacity-50")}>
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-[10px] font-medium tracking-wide uppercase px-1.5 py-0.5 rounded bg-black/[0.05] text-muted">
                        {q.questionType === "written" ? "Written" : "MCQ"}
                      </span>
                      <span
                        className={cn(
                          "text-[10px] font-medium tracking-wide uppercase px-1.5 py-0.5 rounded",
                          q.visibility === "hidden" ? "bg-danger-soft text-danger" : "bg-success-soft text-success",
                        )}
                      >
                        {q.visibility === "hidden" ? "Hidden" : "Practice"}
                      </span>
                      {!q.active && <span className="text-[10px] text-muted uppercase">Archived</span>}
                      {q.usedInAttempts && (
                        <span className="text-[10px] text-muted">Used in a student attempt</span>
                      )}
                    </div>
                    <p className="text-sm text-text">{q.prompt}</p>
                    <p className="text-xs text-muted mt-1">
                      {q.bankTitle} · {q.topic}
                      {lectureTitle ? ` · ${lectureTitle}` : ""}
                      {objectiveTitle ? ` · ${objectiveTitle}` : ""}
                      {q.questionType === "written"
                        ? ` · Answer guide: ${q.answerGuide ?? "—"}`
                        : ` · Correct: ${correctOption?.text ?? "—"}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <ActionButton
                      action={toggleQuestionVisibility.bind(
                        null,
                        courseId,
                        q.id,
                        q.visibility === "hidden" ? "practice" : "hidden",
                      )}
                      variant="secondary"
                    >
                      Make {q.visibility === "hidden" ? "Practice" : "Hidden"}
                    </ActionButton>
                    <ActionButton
                      action={toggleQuestionActive.bind(null, courseId, q.id, !q.active)}
                      variant="secondary"
                    >
                      {q.active ? "Archive" : "Restore"}
                    </ActionButton>
                    {!q.usedInAttempts && (
                      <ActionButton action={deleteQuestionAction.bind(null, courseId, q.id)} variant="destructive">
                        Delete
                      </ActionButton>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
