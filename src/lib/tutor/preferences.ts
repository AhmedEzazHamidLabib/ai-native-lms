import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

/**
 * Explicit Tutor preferences — never an inferred personality or
 * "learning style" label (see 0047_diagnostic_and_tutor_preferences.sql).
 * These four fields are the entire model: what kind of explanation,
 * what kind of correction, how much detail, how fast to move during
 * practice. Kept structurally separate from learning EVIDENCE
 * (src/lib/tutor/evidence.ts) — a preference is something the student
 * said, not something observed.
 */
export type ExplanationStyle = "example_first" | "explain_first" | "guided_discovery";
export type CorrectionStyle = "hint_first" | "step_by_step" | "tell_and_explain";
export type DetailLevel = "short" | "balanced" | "detailed";
export type PracticePacing = "one_at_a_time" | "more_explanation" | "move_quickly";

export interface TutorPreferences {
  explanationStyle: ExplanationStyle | null;
  correctionStyle: CorrectionStyle | null;
  detailLevel: DetailLevel | null;
  practicePacing: PracticePacing | null;
}

const EXPLANATION_LABEL: Record<ExplanationStyle, string> = {
  example_first: "example-first explanations",
  explain_first: "the idea explained before an example",
  guided_discovery: "being asked questions to figure it out",
};
const CORRECTION_LABEL: Record<CorrectionStyle, string> = {
  hint_first: "a hint before the answer",
  step_by_step: "a step-by-step walkthrough when wrong",
  tell_and_explain: "being told the answer with an explanation",
};
const DETAIL_LABEL: Record<DetailLevel, string> = {
  short: "short answers",
  balanced: "balanced-length answers",
  detailed: "detailed answers",
};
const PACING_LABEL: Record<PracticePacing, string> = {
  one_at_a_time: "one practice problem at a time",
  more_explanation: "more explanation between practice questions",
  move_quickly: "moving quickly once they're getting things right",
};

export async function getMyTutorPreferences(
  supabase: SupabaseClient<Database>,
): Promise<TutorPreferences | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("tutor_preferences")
    .select("explanation_style, correction_style, detail_level, practice_pacing")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) return null;
  return {
    explanationStyle: data.explanation_style,
    correctionStyle: data.correction_style,
    detailLevel: data.detail_level,
    practicePacing: data.practice_pacing,
  };
}

export async function getMyTutorPreferencesServer(): Promise<TutorPreferences | null> {
  return getMyTutorPreferences(await createClient());
}

/**
 * A short, normalized sentence for the model's context — never the raw
 * enum values, never every field forced in when nothing was set.
 */
export function formatTutorPreferenceSummary(prefs: TutorPreferences | null): string | null {
  if (!prefs) return null;
  const parts: string[] = [];
  if (prefs.explanationStyle) parts.push(EXPLANATION_LABEL[prefs.explanationStyle]);
  if (prefs.correctionStyle) parts.push(CORRECTION_LABEL[prefs.correctionStyle]);
  if (prefs.detailLevel) parts.push(DETAIL_LABEL[prefs.detailLevel]);
  if (prefs.practicePacing) parts.push(PACING_LABEL[prefs.practicePacing]);
  if (parts.length === 0) return null;
  return `Student prefers: ${parts.join("; ")}.`;
}
