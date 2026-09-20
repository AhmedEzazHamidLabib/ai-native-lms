"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { CreateCourseActionState } from "./course-client-types";

/**
 * The one client-reachable path that can create a `courses` row (see
 * create_course() in 0049_instructor_lifecycle_and_course_creation.sql).
 * Ownership is derived entirely from the authenticated session inside
 * that SECURITY DEFINER function — this action never passes an
 * identity, only the course metadata, so there is no way for a client
 * to spoof who the creator is.
 */
export async function createCourseAction(
  _prevState: CreateCourseActionState,
  formData: FormData,
): Promise<CreateCourseActionState> {
  const code = String(formData.get("code") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const term = String(formData.get("term") ?? "").trim();

  if (!code || !title || !term) {
    return { error: "Course code, title, and term are all required." };
  }

  const supabase = await createClient();
  const { data: courseId, error } = await supabase.rpc("create_course", {
    p_code: code,
    p_title: title,
    p_term: term,
  });
  if (error || !courseId) {
    return {
      error: error?.message.includes("Not authorized")
        ? "You don't currently have instructor access."
        : "Could not create the course. Please try again.",
    };
  }

  revalidatePath("/instructor");
  redirect(`/instructor/courses/${courseId}`);
}
