"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "./server";

/**
 * Every mutation here either runs through RLS directly (publish/lock
 * toggles, reset) or through the SECURITY DEFINER RPCs in
 * supabase/migrations/0006_assessments_rls.sql (start/save/submit) —
 * this file adds no authorization of its own. See docs/ARCHITECTURE.md.
 */

export async function togglePublishAssessment(
  courseId: string,
  id: string,
  publish: boolean,
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("assessments")
    .update({ published_at: publish ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw error;

  revalidatePath(`/instructor/courses/${courseId}/assessments`);
  revalidatePath(`/instructor/courses/${courseId}/assessments/${id}`);
  revalidatePath(`/student/courses/${courseId}/assessments`);
}

export async function toggleLockAssessment(
  courseId: string,
  id: string,
  locked: boolean,
) {
  const supabase = await createClient();
  const { error } = await supabase.from("assessments").update({ locked }).eq("id", id);
  if (error) throw error;

  revalidatePath(`/instructor/courses/${courseId}/assessments`);
  revalidatePath(`/instructor/courses/${courseId}/assessments/${id}`);
  revalidatePath(`/student/courses/${courseId}/assessments`);
}

/** Deletes the attempt entirely (cascades to attempt_questions/responses) — the student starts completely fresh next time. */
export async function resetAttempt(
  courseId: string,
  attemptId: string,
  assessmentId: string,
) {
  const supabase = await createClient();
  const { error } = await supabase.from("attempts").delete().eq("id", attemptId);
  if (error) throw error;

  revalidatePath(`/instructor/courses/${courseId}/assessments/${assessmentId}`);
}

export interface StartAttemptState {
  error: string | null;
}

/**
 * Takes courseId/assessmentId from FormData rather than bound arguments
 * deliberately — a `.bind()`-wrapped action combined with `redirect()`
 * did not survive a plain (no-JS) form submission in this Next.js
 * version (see docs/DECISIONS.md). Reading from FormData through
 * useActionState is the same shape as the login actions, which do
 * redirect reliably.
 */
export async function startAttempt(
  _prevState: StartAttemptState,
  formData: FormData,
): Promise<StartAttemptState> {
  const courseId = String(formData.get("courseId") ?? "");
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const supabase = await createClient();
  const { data: attemptId, error } = await supabase.rpc("start_attempt", {
    p_assessment_id: assessmentId,
  });
  if (error) {
    return { error: error.message };
  }
  redirect(
    `/student/courses/${courseId}/assessments/${assessmentId}/attempt/${attemptId}`,
  );
}

export interface SaveResponseResult {
  ok: boolean;
  error: string | null;
}

export async function saveResponse(
  attemptId: string,
  questionId: string,
  selectedOptionId: string | null,
  textResponse: string | null = null,
): Promise<SaveResponseResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_response", {
    p_attempt_id: attemptId,
    p_question_id: questionId,
    p_selected_option_id: selectedOptionId,
    p_text_response: textResponse,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, error: null };
}

export async function gradeWrittenResponse(
  courseId: string,
  assessmentId: string,
  attemptId: string,
  questionId: string,
  isCorrect: boolean,
  gradingNote: string | null,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("grade_written_response", {
    p_attempt_id: attemptId,
    p_question_id: questionId,
    p_is_correct: isCorrect,
    p_grading_note: gradingNote,
  });
  if (error) return { error: error.message };
  revalidatePath(`/instructor/courses/${courseId}/assessments/${assessmentId}/attempts/${attemptId}`);
  revalidatePath(`/instructor/courses/${courseId}/gradebook`);
  return { error: null };
}

export async function submitAttempt(
  courseId: string,
  assessmentId: string,
  attemptId: string,
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_attempt", { p_attempt_id: attemptId });
  if (error) {
    return { error: error.message };
  }
  const path = `/student/courses/${courseId}/assessments/${assessmentId}/attempt/${attemptId}`;
  revalidatePath(path);
  redirect(path);
}
