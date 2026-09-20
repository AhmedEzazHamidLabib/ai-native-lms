import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";

/**
 * Integration tests need a real course member to act as "the student"
 * — but CSE 1203's real roster is now exactly the instructor's real
 * students (see the 2026-09-20 data cleanup in HANDOFF_NEXT_SESSION.md).
 * Tests must never assume a fixture account is permanently enrolled in
 * a real course. This ensures membership for the test's duration only,
 * via the service-role client, and reports whether it added the row so
 * the caller's `afterAll` can remove ONLY what it added (never touching
 * a real, pre-existing enrollment).
 */
export async function ensureCourseMembership(
  admin: SupabaseClient<Database>,
  userId: string,
  courseId: string,
  role: "student" | "instructor" = "student",
): Promise<{ added: boolean }> {
  const { data: existing } = await admin
    .from("course_members")
    .select("id")
    .eq("user_id", userId)
    .eq("course_id", courseId)
    .maybeSingle();
  if (existing) return { added: false };

  const { error } = await admin.from("course_members").insert({ user_id: userId, course_id: courseId, role });
  if (error) {
    // Vitest runs test files in parallel workers, and several suites
    // ensure membership for the same fixture account/course at once —
    // a concurrent insert winning the race is not a real failure here.
    if (error.code === "23505") return { added: false };
    throw new Error(`ensureCourseMembership failed: ${error.message}`);
  }
  return { added: true };
}

export async function removeCourseMembershipIfAdded(
  admin: SupabaseClient<Database>,
  userId: string,
  courseId: string,
  added: boolean,
): Promise<void> {
  if (!added) return;
  await admin.from("course_members").delete().eq("user_id", userId).eq("course_id", courseId);
}
