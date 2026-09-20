"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "./server";
import { type ProfileActionState } from "./profile-client-types";

/**
 * The one write path for a student's own display name
 * (docs/COURSEWORK_LEARNING_ARCHITECTURE.md "PROFILES"). Used both by
 * the profile-completion prompt for pre-existing accounts and by any
 * future "edit my profile" surface — same action either way.
 */
export async function updateMyFullName(
  _prevState: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const fullName = String(formData.get("fullName") ?? "").trim();
  if (!fullName) {
    return { error: "Enter your full name.", saved: false };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("upsert_my_full_name", { p_full_name: fullName });
  if (error) {
    return { error: "Could not save your name. Please try again.", saved: false };
  }

  revalidatePath("/student");
  revalidatePath("/instructor");
  return { error: null, saved: true };
}
