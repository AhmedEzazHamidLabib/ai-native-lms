import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getTutorProvider, TutorProviderError } from "./provider";
import { reserveGeneration, completeGeneration } from "./governor";

/**
 * Practice-answer evaluation (docs/AI_TUTOR_ARCHITECTURE.md §6/§11).
 * Deterministic when possible (numeric/short_text — no model call);
 * only 'explanation' answers get a second, single-purpose, JSON-only
 * model call — gated by the same AI Usage Governor as every other
 * generation. Neither path can touch `attempts`/`score` — there is no
 * FK from practice_attempts into the graded assessment tables at all.
 */

export interface PracticeAnswerOutcome {
  status: "graded";
  correct: boolean;
  evaluationReason: string;
}

export async function submitPracticeAnswer(
  supabase: SupabaseClient<Database>,
  practiceAttemptId: string,
  studentAnswer: string,
): Promise<PracticeAnswerOutcome> {
  const trimmed = studentAnswer.trim();
  if (!trimmed) throw new Error("Answer cannot be empty.");
  if (trimmed.length > 1000) throw new Error("Answer is too long.");

  const { data, error } = await supabase.rpc("submit_practice_answer", {
    p_practice_attempt_id: practiceAttemptId,
    p_student_answer: trimmed,
  });
  if (error || !data) {
    throw new Error(error?.message ?? "Could not submit your answer.");
  }

  if (data.status === "graded") {
    return { status: "graded", correct: data.correct, evaluationReason: data.evaluationReason };
  }

  // 'explanation' kind: one bounded, single-purpose model call, then
  // persist via record_practice_evaluation — never callable twice
  // (enforced server-side, see 0016_learning_evidence.sql).
  const reservation = await reserveGeneration(supabase, data.courseId, "practice_evaluation");

  let evaluation;
  try {
    evaluation = await getTutorProvider().evaluateExplanation({
      practiceQuestion: data.prompt,
      rubricNotes: data.rubricNotes,
      studentAnswer: trimmed,
    });
  } catch (err) {
    await completeGeneration(supabase, reservation.eventId, { status: "failed" });
    if (err instanceof TutorProviderError) throw err;
    throw new TutorProviderError("Could not evaluate your answer.", err);
  }
  await completeGeneration(supabase, reservation.eventId, {
    status: "success",
    model: "claude-haiku-4-5-20251001",
    usage: evaluation.usage,
  });

  const { data: recorded, error: recordError } = await supabase.rpc("record_practice_evaluation", {
    p_practice_attempt_id: practiceAttemptId,
    p_correct: evaluation.correct,
    p_evaluation_reason: evaluation.reason,
  });
  if (recordError || !recorded) {
    throw new Error(recordError?.message ?? "Could not save your evaluation.");
  }

  return { status: "graded", correct: recorded.correct, evaluationReason: recorded.evaluationReason };
}
