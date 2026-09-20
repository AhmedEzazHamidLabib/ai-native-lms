"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { TutorPreferencesActionState } from "./preferences-client-types";

/**
 * The one write path for a student's own explicit Tutor preferences —
 * four small enums, never a personality label (see
 * 0047_diagnostic_and_tutor_preferences.sql for the full rationale).
 */
export async function updateMyTutorPreferences(
  _prevState: TutorPreferencesActionState,
  formData: FormData,
): Promise<TutorPreferencesActionState> {
  const explanationStyle = String(formData.get("explanationStyle") ?? "") || null;
  const correctionStyle = String(formData.get("correctionStyle") ?? "") || null;
  const detailLevel = String(formData.get("detailLevel") ?? "") || null;
  const practicePacing = String(formData.get("practicePacing") ?? "") || null;

  const supabase = await createClient();
  const { error } = await supabase.rpc("upsert_my_tutor_preferences", {
    p_explanation_style: explanationStyle,
    p_correction_style: correctionStyle,
    p_detail_level: detailLevel,
    p_practice_pacing: practicePacing,
  });
  if (error) {
    return { error: "Could not save your preferences. Please try again.", saved: false };
  }

  revalidatePath("/student", "layout");
  return { error: null, saved: true };
}
