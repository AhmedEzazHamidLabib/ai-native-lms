import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { listPracticeQuestions } from "@/lib/practice/actions";
import { PracticeSession } from "@/components/practice/practice-session";

export default async function PracticeSessionPage({
  params,
  searchParams,
}: PageProps<"/student/courses/[courseId]/practice/session">) {
  const { courseId } = await params;
  const sp = await searchParams;
  const lectureParam = typeof sp.lecture === "string" ? sp.lecture : "mixed";
  const lectureId = lectureParam === "mixed" ? null : lectureParam;

  const questions = await listPracticeQuestions(courseId, lectureId);

  if (questions.length === 0) {
    return (
      <>
        <PageHeader title="Practice" />
        <EmptyState title="No questions here" description="Nothing to practice for this selection yet." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={lectureId ? "Practice" : "Mixed Practice"}
        description="Ungraded. Never affects your official grade."
      />
      <PracticeSession
        courseId={courseId}
        questionIds={questions.map((q) => q.questionId)}
      />
    </>
  );
}
