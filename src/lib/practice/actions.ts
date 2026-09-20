"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Question-bank Practice (docs/COURSEWORK_LEARNING_ARCHITECTURE.md
 * "PRACTICE MODEL"). Grading is deterministic SQL, never an LLM call —
 * see submit_question_bank_practice_answer() (0022_practice_visibility.sql).
 */

export interface PracticeCatalogItem {
  questionId: string;
  prompt: string;
  topic: string;
  sourceLectureId: string | null;
  learningObjectiveId: string | null;
}

export async function listPracticeQuestions(
  courseId: string,
  lectureId?: string | null,
): Promise<PracticeCatalogItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_practice_questions", {
    p_course_id: courseId,
    p_lecture_id: lectureId ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    questionId: r.question_id,
    prompt: r.prompt,
    topic: r.topic,
    sourceLectureId: r.source_lecture_id,
    learningObjectiveId: r.learning_objective_id,
  }));
}

export interface PracticeQuestionDetail {
  questionId: string;
  prompt: string;
  learningObjectiveId: string | null;
  options: { optionId: string; text: string }[];
}

export async function getPracticeQuestion(questionId: string): Promise<PracticeQuestionDetail> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_practice_question", { p_question_id: questionId });
  if (error || !data) throw new Error(error?.message ?? "Question not found.");
  return {
    questionId: data.questionId,
    prompt: data.prompt,
    learningObjectiveId: data.learningObjectiveId,
    options: data.options,
  };
}

export interface PracticeAnswerResult {
  practiceAttemptId: string;
  correct: boolean;
  correctAnswerText: string | null;
}

export async function submitPracticeQuestionAnswer(
  questionId: string,
  selectedOptionId: string,
): Promise<PracticeAnswerResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_question_bank_practice_answer", {
    p_question_id: questionId,
    p_selected_option_id: selectedOptionId,
  });
  if (error || !data) throw new Error(error?.message ?? "Could not submit your answer.");

  // Reuse the existing tutor-context RPC to reveal the correct answer
  // now that this specific attempt is graded — same "reveal after
  // answering, never before" rule as the assessment engine.
  const { data: detail } = await supabase.rpc("get_practice_attempt_for_tutor", {
    p_practice_attempt_id: data.practiceAttemptId,
  });

  return {
    practiceAttemptId: data.practiceAttemptId,
    correct: data.correct,
    correctAnswerText: detail?.correctAnswer ?? null,
  };
}
