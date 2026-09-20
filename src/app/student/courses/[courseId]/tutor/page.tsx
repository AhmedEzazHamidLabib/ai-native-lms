import { PageHeader } from "@/components/ui/page-header";
import { startTutorSession, getTutorEntryData } from "@/lib/tutor/actions";
import type { TutorEntrySource } from "@/lib/tutor/orchestrator";
import { TutorChat } from "@/components/tutor/tutor-chat";

export default async function TutorPage({
  params,
  searchParams,
}: PageProps<"/student/courses/[courseId]/tutor">) {
  const { courseId } = await params;
  const sp = await searchParams;

  const objectiveId = typeof sp.objective === "string" ? sp.objective : null;
  const attemptId = typeof sp.attempt === "string" ? sp.attempt : null;
  const lectureId = typeof sp.lecture === "string" ? sp.lecture : null;
  const slideId = typeof sp.slide === "string" ? sp.slide : null;
  const practiceAttemptId = typeof sp.practiceAttempt === "string" ? sp.practiceAttempt : null;
  const entryParam = typeof sp.entry === "string" ? sp.entry : null;

  const entrySource: TutorEntrySource =
    entryParam === "performance" && objectiveId
      ? "performance"
      : entryParam === "assessment_review" && attemptId
        ? "assessment_review"
        : entryParam === "slide" && lectureId && slideId
          ? "slide"
          : entryParam === "question_bank_practice" && practiceAttemptId
            ? "question_bank_practice"
            : "direct";

  const { objectives, providerConfigured } = await getTutorEntryData(courseId);
  const objective = objectiveId ? objectives.find((o) => o.id === objectiveId) : null;

  const { sessionId, messages, error } = await startTutorSession({
    courseId,
    entrySource,
    learningObjectiveId: entrySource === "performance" ? (objective?.id ?? null) : null,
    sourceAttemptId: entrySource === "assessment_review" ? attemptId : null,
    sourceLectureId: entrySource === "slide" ? lectureId : null,
    sourceSlideId: entrySource === "slide" ? slideId : null,
    sourcePracticeAttemptId: entrySource === "question_bank_practice" ? practiceAttemptId : null,
  });

  const kickoff =
    entrySource === "performance"
      ? `I struggled with ${objective?.title ?? "this topic"} on my assessment — can you help me practice it?`
      : entrySource === "assessment_review"
        ? "Can you help me understand what I got wrong on that assessment?"
        : entrySource === "slide"
          ? "What does this slide mean?"
          : entrySource === "question_bank_practice"
            ? "Can you explain that practice question?"
            : null;

  return (
    <>
      <PageHeader
        title="AI Tutor"
        description={
          objective
            ? `Focused on ${objective.title}.`
            : entrySource === "assessment_review"
              ? "Reviewing your submitted assessment."
              : entrySource === "slide"
                ? "About the slide you're viewing."
                : entrySource === "question_bank_practice"
                  ? "Explaining that practice question."
                  : "Ask about anything covered in this course."
        }
      />

      {!providerConfigured || error || !sessionId ? (
        <div className="border border-dashed border-border rounded-md px-6 py-10 text-center max-w-lg">
          <p className="font-display text-lg text-text mb-1.5">AI Tutor unavailable</p>
          <p className="text-sm text-muted">
            {error ?? "The AI Tutor isn't configured yet. Please check back later."}
          </p>
        </div>
      ) : (
        <TutorChat
          sessionId={sessionId}
          courseId={courseId}
          initialMessages={messages}
          kickoffMessage={messages.length === 0 ? kickoff : null}
        />
      )}
    </>
  );
}
