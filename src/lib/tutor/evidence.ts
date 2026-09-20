import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Student learning evidence (docs/AI_TUTOR_ARCHITECTURE.md §4).
 * Assessment evidence and practice evidence are always kept as two
 * separate numbers, never merged into one score — practice is
 * educational evidence, not a grade.
 */

export interface ObjectiveEvidence {
  learningObjectiveId: string;
  title: string;
  position: number;
  correct: number;
  attempted: number;
}

export interface LearningObjective {
  id: string;
  title: string;
  description: string;
  position: number;
}

export async function getLearningObjectives(
  supabase: SupabaseClient<Database>,
  courseId: string,
): Promise<LearningObjective[]> {
  const { data, error } = await supabase
    .from("learning_objectives")
    .select("id, title, description, position")
    .eq("course_id", courseId)
    .order("position");
  if (error) throw new Error(`Could not load learning objectives: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    position: r.position,
  }));
}

export async function getAssessmentEvidence(
  supabase: SupabaseClient<Database>,
  courseId: string,
): Promise<ObjectiveEvidence[]> {
  const { data, error } = await supabase.rpc("get_student_objective_evidence", {
    p_course_id: courseId,
  });
  if (error) throw new Error(`Could not load assessment evidence: ${error.message}`);
  return (data ?? []).map((r) => ({
    learningObjectiveId: r.learning_objective_id,
    title: r.title,
    position: r.position,
    correct: r.correct,
    attempted: r.attempted,
  }));
}

export async function getPracticeEvidence(
  supabase: SupabaseClient<Database>,
  courseId: string,
): Promise<ObjectiveEvidence[]> {
  const { data, error } = await supabase.rpc("get_student_practice_evidence", {
    p_course_id: courseId,
  });
  if (error) throw new Error(`Could not load practice evidence: ${error.message}`);
  return (data ?? []).map((r) => ({
    learningObjectiveId: r.learning_objective_id,
    title: r.title,
    position: r.position,
    correct: r.correct,
    attempted: r.attempted,
  }));
}

/** Formats the labeled evidence-summary block the provider expects. */
export function formatEvidenceSummary(
  objectiveTitle: string | null,
  assessment: ObjectiveEvidence[],
  practice: ObjectiveEvidence[],
): string {
  const lines: string[] = [];
  const relevant = objectiveTitle
    ? assessment.filter((e) => e.title === objectiveTitle)
    : assessment;

  for (const a of relevant) {
    const p = practice.find((x) => x.learningObjectiveId === a.learningObjectiveId);
    lines.push(
      `${a.title}: assessment evidence ${a.correct}/${a.attempted} correct` +
        (p ? `; practice evidence ${p.correct}/${p.attempted} correct` : `; practice evidence 0/0`),
    );
  }
  return lines.join("\n");
}
