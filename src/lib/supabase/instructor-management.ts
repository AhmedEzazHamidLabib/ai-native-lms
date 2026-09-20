"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "./server";

/**
 * Every function here calls a SECURITY DEFINER Postgres function
 * (supabase/migrations/0004_instructor_authorization.sql) that
 * re-checks `current_user_is_owner()` from auth.uid() itself. Nothing
 * in this file is the authorization boundary — it's a thin wrapper. A
 * direct RPC call from devtools or curl hits exactly the same database
 * check and is refused exactly the same way.
 */

export interface InstructorStatusRow {
  email: string;
  isOwner: boolean;
  authorizedAt: string;
  userRegistered: boolean;
  emailVerified: boolean;
  isActiveInstructor: boolean;
}

export async function listInstructorStatus(): Promise<{
  rows: InstructorStatusRow[];
  error: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_instructor_status");
  if (error) return { rows: [], error: error.message };

  return {
    rows: (data ?? []).map((r) => ({
      email: r.email,
      isOwner: r.is_owner,
      authorizedAt: r.authorized_at,
      userRegistered: r.user_registered,
      emailVerified: r.email_verified,
      isActiveInstructor: r.is_active_instructor,
    })),
    error: null,
  };
}

const emailSchema = z.string().email();

export interface ManageInstructorState {
  error: string | null;
  success: boolean;
}

export async function addInstructorEmail(
  _prevState: ManageInstructorState,
  formData: FormData,
): Promise<ManageInstructorState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) {
    return { error: "Enter a valid email address.", success: false };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_instructor_email", {
    p_email: parsed.data,
  });

  if (error) {
    return { error: error.message, success: false };
  }

  revalidatePath("/instructor/manage-instructors");
  return { error: null, success: true };
}

export async function removeInstructorEmail(email: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_instructor_email", {
    p_email: email,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/instructor/manage-instructors");
}
