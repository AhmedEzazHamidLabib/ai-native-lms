"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Instructor/owner AI Usage Governor controls (Part 11). Course-scoped pause is instructor-authorized; global pause is owner-only — both re-checked server-side by the RPCs themselves. */

export interface CourseAiUsageSummary {
  coursePaused: boolean;
  globalPaused: boolean;
  isOwner: boolean;
  studentDailyLimit: number;
  courseDailyLimit: number;
  globalDailyLimit: number;
  studentGenerationsToday: number;
  inputTokensToday: number;
  outputTokensToday: number;
  failedToday: number;
}

export async function getCourseAiUsageSummary(courseId: string): Promise<CourseAiUsageSummary> {
  const supabase = await createClient();

  const [configRes, courseSettingsRes, usageRes, ownerRes] = await Promise.all([
    supabase.from("ai_usage_config").select("*").eq("id", true).maybeSingle(),
    supabase.from("course_ai_settings").select("ai_paused").eq("course_id", courseId).maybeSingle(),
    supabase.rpc("get_course_ai_usage_today", { p_course_id: courseId }),
    supabase.rpc("current_user_is_owner"),
  ]);

  const config = configRes.data;
  return {
    coursePaused: courseSettingsRes.data?.ai_paused ?? false,
    globalPaused: config?.ai_paused ?? false,
    isOwner: Boolean(ownerRes.data),
    studentDailyLimit: config?.student_daily_limit ?? 8,
    courseDailyLimit: config?.course_daily_limit ?? 75,
    globalDailyLimit: config?.global_daily_limit ?? 100,
    studentGenerationsToday: usageRes.data?.studentGenerationsToday ?? 0,
    inputTokensToday: usageRes.data?.inputTokensToday ?? 0,
    outputTokensToday: usageRes.data?.outputTokensToday ?? 0,
    failedToday: usageRes.data?.failedToday ?? 0,
  };
}

export async function setCourseAiPaused(courseId: string, paused: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_course_ai_paused", { p_course_id: courseId, p_paused: paused });
  if (error) throw new Error(error.message);
  revalidatePath(`/instructor/courses/${courseId}/ai-usage`);
}

export async function setGlobalAiPaused(courseId: string, paused: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_global_ai_paused", { p_paused: paused });
  if (error) throw new Error(error.message);
  revalidatePath(`/instructor/courses/${courseId}/ai-usage`);
}
