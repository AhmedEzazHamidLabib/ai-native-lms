"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { analyzeLearningObjective, COURSE_INTELLIGENCE_MODEL } from "@/lib/intelligence/analyze";

function computeSourceHash(sourceMaterial: string): string {
  return createHash("sha256").update(sourceMaterial).digest("hex");
}

/**
 * Instructor-triggered rebuild of ONE objective's Course Intelligence —
 * the only interactive path that calls the strong model, gated entirely
 * behind instructor authorization re-derived in the RPCs it calls
 * (start/write/fail_..._intelligence). Never reachable from student
 * code, and never invoked by the runtime tutor.
 */
export async function reprocessLearningObjective(courseId: string, learningObjectiveId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const { data: started, error: startErr } = await supabase.rpc("start_intelligence_regeneration", {
    p_learning_objective_id: learningObjectiveId,
  });
  if (startErr || !started) {
    return { error: startErr?.message ?? "Could not start regeneration." };
  }

  const sourceHash = computeSourceHash(started.sourceMaterial);

  try {
    const result = await analyzeLearningObjective(started.title, started.description, started.sourceMaterial);
    const { error: writeErr } = await supabase.rpc("write_learning_objective_intelligence", {
      p_learning_objective_id: learningObjectiveId,
      p_canonical_explanation: result.canonicalExplanation,
      p_key_facts: result.keyFacts,
      p_common_misconceptions: result.commonMisconceptions,
      p_analogies: result.analogies,
      p_teaching_progression: result.teachingProgression,
      p_practice_generation_guidance: result.practiceGenerationGuidance,
      p_source_hash: sourceHash,
      p_model: COURSE_INTELLIGENCE_MODEL,
    });
    if (writeErr) return { error: writeErr.message };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed.";
    await supabase.rpc("fail_learning_objective_intelligence", { p_learning_objective_id: learningObjectiveId, p_error: message });
    return { error: message };
  }

  revalidatePath(`/instructor/courses/${courseId}/content`);
  return { error: null };
}
