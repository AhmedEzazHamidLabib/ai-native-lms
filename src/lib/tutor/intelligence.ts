import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Course Intelligence read path (docs/COURSEWORK_LEARNING_ARCHITECTURE.md
 * "COURSE INTELLIGENCE" / "RUNTIME TUTOR"). Read-only from the runtime
 * tutor's perspective — writing is exclusively
 * scripts/compile-course-intelligence.mjs, via the service role.
 */

export interface ObjectiveIntelligence {
  learningObjectiveId: string;
  title: string;
  canonicalExplanation: string | null;
  keyFacts: string[];
  commonMisconceptions: { misconception: string; diagnosticCue: string }[];
  analogies: string[];
  teachingProgression: string[];
  practiceGenerationGuidance: string | null;
  status: "ready" | "stale" | "missing" | "generating" | "failed";
}

export async function getIntelligenceForObjective(
  supabase: SupabaseClient<Database>,
  learningObjectiveId: string,
): Promise<ObjectiveIntelligence | null> {
  const { data, error } = await supabase
    .from("learning_objective_intelligence")
    .select(
      "learning_objective_id, canonical_explanation, key_facts, common_misconceptions, analogies, teaching_progression, practice_generation_guidance, status, learning_objectives(title)",
    )
    .eq("learning_objective_id", learningObjectiveId)
    .maybeSingle();

  if (error || !data || data.status !== "ready") return null;

  const objectiveTitle = (data.learning_objectives as unknown as { title: string } | null)?.title ?? "";

  return {
    learningObjectiveId: data.learning_objective_id,
    title: objectiveTitle,
    canonicalExplanation: data.canonical_explanation,
    keyFacts: Array.isArray(data.key_facts) ? (data.key_facts as string[]) : [],
    commonMisconceptions: Array.isArray(data.common_misconceptions)
      ? (data.common_misconceptions as { misconception: string; diagnosticCue: string }[])
      : [],
    analogies: Array.isArray(data.analogies) ? (data.analogies as string[]) : [],
    teachingProgression: Array.isArray(data.teaching_progression)
      ? (data.teaching_progression as string[])
      : [],
    practiceGenerationGuidance: data.practice_generation_guidance,
    status: data.status,
  };
}

/**
 * For generic/'direct' entry with no fixed objective: cheap in-process
 * keyword-overlap match against the small, fixed set of ready
 * intelligence rows for a course (currently ≤7) — not worth a new
 * tsvector index for a handful of rows. Returns null (falls back to
 * raw retrieval) when nothing matches reasonably.
 */
export async function findBestMatchingObjective(
  supabase: SupabaseClient<Database>,
  courseId: string,
  query: string,
): Promise<ObjectiveIntelligence | null> {
  const { data } = await supabase
    .from("learning_objective_intelligence")
    .select(
      "learning_objective_id, canonical_explanation, key_facts, common_misconceptions, analogies, teaching_progression, practice_generation_guidance, status, learning_objectives(title)",
    )
    .eq("course_id", courseId)
    .eq("status", "ready");

  if (!data || data.length === 0) return null;

  const words = query
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 3);
  if (words.length === 0) return null;

  let best: (typeof data)[number] | null = null;
  let bestScore = 0;
  for (const row of data) {
    const title = (row.learning_objectives as unknown as { title: string } | null)?.title ?? "";
    const haystack = `${title} ${row.canonical_explanation ?? ""} ${(row.key_facts as string[] | null)?.join(" ") ?? ""}`.toLowerCase();
    const score = words.reduce((acc, w) => acc + (haystack.includes(w) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }

  if (!best || bestScore === 0) return null;

  const objectiveTitle = (best.learning_objectives as unknown as { title: string } | null)?.title ?? "";
  return {
    learningObjectiveId: best.learning_objective_id,
    title: objectiveTitle,
    canonicalExplanation: best.canonical_explanation,
    keyFacts: Array.isArray(best.key_facts) ? (best.key_facts as string[]) : [],
    commonMisconceptions: Array.isArray(best.common_misconceptions)
      ? (best.common_misconceptions as { misconception: string; diagnosticCue: string }[])
      : [],
    analogies: Array.isArray(best.analogies) ? (best.analogies as string[]) : [],
    teachingProgression: Array.isArray(best.teaching_progression) ? (best.teaching_progression as string[]) : [],
    practiceGenerationGuidance: best.practice_generation_guidance,
    status: best.status,
  };
}

/** Formats intelligence as the compact labeled block the provider expects. */
export function formatCourseIntelligence(intel: ObjectiveIntelligence | null): string {
  if (!intel) return "";
  const lines = [`Objective: ${intel.title}`];
  if (intel.canonicalExplanation) lines.push(`Canonical explanation: ${intel.canonicalExplanation}`);
  if (intel.keyFacts.length) lines.push(`Key facts: ${intel.keyFacts.join("; ")}`);
  if (intel.analogies.length) lines.push(`Analogies: ${intel.analogies.join(" | ")}`);
  if (intel.teachingProgression.length) {
    lines.push(`Teaching progression: ${intel.teachingProgression.join(" -> ")}`);
  }
  if (intel.commonMisconceptions.length) {
    lines.push(
      "Common misconceptions: " +
        intel.commonMisconceptions
          .map((m) => `"${m.misconception}" (check via: ${m.diagnosticCue})`)
          .join("; "),
    );
  }
  if (intel.practiceGenerationGuidance) {
    lines.push(`Practice generation guidance: ${intel.practiceGenerationGuidance}`);
  }
  return lines.join("\n");
}
