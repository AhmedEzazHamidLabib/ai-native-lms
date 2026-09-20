import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { getCourseContent } from "@/lib/domain/queries";
import { listPracticeQuestions } from "@/lib/practice/actions";

export default async function PracticeCatalogPage({
  params,
}: PageProps<"/student/courses/[courseId]/practice">) {
  const { courseId } = await params;
  const [content, allQuestions] = await Promise.all([
    getCourseContent(courseId),
    listPracticeQuestions(courseId),
  ]);

  const publishedLectures = content.lectures.filter((l) => l.publishedAt);
  const countsByLecture = new Map<string, number>();
  for (const q of allQuestions) {
    if (!q.sourceLectureId) continue;
    countsByLecture.set(q.sourceLectureId, (countsByLecture.get(q.sourceLectureId) ?? 0) + 1);
  }

  if (allQuestions.length === 0) {
    return (
      <>
        <PageHeader
          title="Practice"
          description="Ungraded practice questions. Never affects your official grade."
        />
        <EmptyState title="No practice questions yet" description="Check back once your instructor adds some." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Practice"
        description="Ungraded practice questions, generated from the course question bank. Never affects your official grade — see Performance for separate practice evidence."
      />

      <ul className="divide-y divide-border border-t border-b border-border">
        {publishedLectures.map((l) => {
          const count = countsByLecture.get(l.id) ?? 0;
          if (count === 0) return null;
          return (
            <li key={l.id}>
              <Link
                href={`/student/courses/${courseId}/practice/session?lecture=${l.id}`}
                className="flex items-center justify-between gap-3 px-1 py-4 hover:bg-black/[0.02] transition-colors duration-[180ms]"
              >
                <span className="text-sm font-medium text-text">Practice {l.title}</span>
                <span className="text-xs text-muted shrink-0">{count} questions</span>
              </Link>
            </li>
          );
        })}
        <li>
          <Link
            href={`/student/courses/${courseId}/practice/session?lecture=mixed`}
            className="flex items-center justify-between gap-3 px-1 py-4 hover:bg-black/[0.02] transition-colors duration-[180ms]"
          >
            <span className="text-sm font-medium text-text">Mixed Practice</span>
            <span className="text-xs text-muted shrink-0">{allQuestions.length} questions</span>
          </Link>
        </li>
      </ul>
    </>
  );
}
