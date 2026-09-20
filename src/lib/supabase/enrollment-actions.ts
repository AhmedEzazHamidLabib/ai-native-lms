"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "./server";

/**
 * Every function here calls a SECURITY DEFINER Postgres function
 * (supabase/migrations/0009_multi_course_enrollment.sql) that derives
 * identity from auth.uid() and re-checks authorization inside Postgres.
 * There is no parameter anywhere in this file — or the RPCs it calls —
 * that lets a client request a role other than 'student' for itself.
 */

export interface EnrollState {
  status: "idle" | "enrolled" | "pending";
  error: string | null;
}

/**
 * Reads courseId from FormData (via useActionState) rather than a bound
 * argument — matches the pattern already proven reliable for actions
 * that need to work over a real form submission (see
 * src/lib/supabase/actions.ts and docs/DECISIONS.md).
 */
export async function enrollInCourse(
  _prevState: EnrollState,
  formData: FormData,
): Promise<EnrollState> {
  const courseId = String(formData.get("courseId") ?? "");
  if (!courseId) {
    return { status: "idle", error: "Course unavailable. Please refresh and try again." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("enroll_in_course", {
    p_course_id: courseId,
  });
  if (error) {
    // Never surface the raw Postgres/PostgREST message to the student —
    // "Course not found." is the one case worth naming specifically
    // (stale page, course removed); everything else collapses to a
    // generic, retry-safe message instead of leaking internals.
    const friendly = error.message.includes("Course not found")
      ? "This course is no longer available."
      : "Couldn't complete enrollment. Please try again.";
    return { status: "idle", error: friendly };
  }

  revalidatePath("/student");
  revalidatePath("/student/courses");
  revalidatePath(`/student/courses/${courseId}`);

  return { status: data.status, error: null };
}

export async function approveEnrollmentRequest(requestId: string, courseId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_enrollment_request", {
    p_request_id: requestId,
  });
  if (error) throw error;

  revalidatePath(`/instructor/courses/${courseId}/students`);
}

export async function rejectEnrollmentRequest(requestId: string, courseId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_enrollment_request", {
    p_request_id: requestId,
  });
  if (error) throw error;

  revalidatePath(`/instructor/courses/${courseId}/students`);
}

export async function removeCourseMember(courseId: string, userId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_course_member", {
    p_course_id: courseId,
    p_user_id: userId,
  });
  if (error) throw error;

  revalidatePath(`/instructor/courses/${courseId}/students`);
}

export async function setCourseAutoEnroll(courseId: string, autoEnroll: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("courses")
    .update({ auto_enroll: autoEnroll })
    .eq("id", courseId);
  if (error) throw error;

  revalidatePath(`/instructor/courses/${courseId}/settings`);
  revalidatePath("/student/courses");
}
