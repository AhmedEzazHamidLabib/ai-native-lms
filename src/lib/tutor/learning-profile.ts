import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { ObjectiveEvidence } from "./evidence";

/**
 * Evidence-based Learning Profile (Part 8) — transparent, traceable to
 * actual assessment/practice data, never a personality trait or an
 * opaque score. The tutor's own SAME call optionally returns a bounded
 * `misconception` observation (no second evaluator model); this module
 * just persists/reads it and folds it into the compact evidence
 * summary sent to the next turn.
 */

export interface ActiveMisconception {
  learningObjectiveId: string;
  description: string;
}

export async function getActiveMisconception(
  supabase: SupabaseClient<Database>,
  learningObjectiveId: string,
): Promise<ActiveMisconception | null> {
  const { data } = await supabase
    .from("student_misconceptions")
    .select("learning_objective_id, description")
    .eq("learning_objective_id", learningObjectiveId)
    .eq("resolved", false)
    .maybeSingle();
  if (!data) return null;
  return { learningObjectiveId: data.learning_objective_id, description: data.description };
}

export async function recordMisconception(
  supabase: SupabaseClient<Database>,
  courseId: string,
  learningObjectiveId: string,
  description: string,
  resolved: boolean,
): Promise<void> {
  await supabase.rpc("record_misconception", {
    p_course_id: courseId,
    p_learning_objective_id: learningObjectiveId,
    p_description: description,
    p_resolved: resolved,
  });
}

/**
 * Instructor-facing trend label — transparent evidence, not a score.
 * "Improving": practice accuracy meaningfully exceeds assessment
 * accuracy on the same objective. "Needs more evidence": too little
 * data either way. Otherwise reflects raw accuracy.
 */
export function trendLabel(assessment: ObjectiveEvidence, practice: ObjectiveEvidence | undefined): string {
  const aTotal = assessment.attempted;
  const pTotal = practice?.attempted ?? 0;
  if (aTotal === 0 && pTotal === 0) return "No evidence yet";
  if (aTotal < 2 && pTotal < 2) return "Needs more evidence";

  const aRate = aTotal > 0 ? assessment.correct / aTotal : null;
  const pRate = pTotal > 0 ? (practice!.correct / pTotal) : null;

  if (aRate !== null && pRate !== null && pRate - aRate >= 0.25) return "Improving";
  if (aRate !== null && aRate >= 0.8) return "Strong evidence";
  if (aRate !== null && aRate < 0.5) return "Needs review";
  return "Developing";
}
