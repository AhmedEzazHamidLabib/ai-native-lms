"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function setCourseScheduleAction(
  courseId: string,
  input: {
    startDate: string | null;
    endDate: string | null;
    meetingDays: string[];
    meetingStartTime: string | null;
    meetingEndTime: string | null;
    timezone: string;
  },
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_course_schedule", {
    p_course_id: courseId,
    p_start_date: input.startDate,
    p_end_date: input.endDate,
    p_meeting_days: input.meetingDays,
    p_meeting_start_time: input.meetingStartTime,
    p_meeting_end_time: input.meetingEndTime,
    p_timezone: input.timezone,
  });
  if (error) return { error: error.message };
  revalidatePath(`/instructor/courses/${courseId}/settings`);
  revalidatePath(`/instructor/courses/${courseId}/calendar`);
  revalidatePath(`/student/courses/${courseId}/calendar`);
  return { error: null };
}

export async function setCourseRosterVisibilityAction(courseId: string, visible: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_course_roster_visibility", { p_course_id: courseId, p_visible: visible });
  if (error) throw new Error(error.message);
  revalidatePath(`/instructor/courses/${courseId}/settings`);
}
