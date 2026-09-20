import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface CourseSchedule {
  startDate: string | null;
  endDate: string | null;
  meetingDays: string[];
  meetingStartTime: string | null;
  meetingEndTime: string | null;
  timezone: string;
  studentsCanSeeRoster: boolean;
}

export async function getCourseSchedule(courseId: string): Promise<CourseSchedule | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("courses")
    .select("start_date, end_date, meeting_days, meeting_start_time, meeting_end_time, timezone, students_can_see_roster")
    .eq("id", courseId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    startDate: data.start_date,
    endDate: data.end_date,
    meetingDays: data.meeting_days,
    meetingStartTime: data.meeting_start_time,
    meetingEndTime: data.meeting_end_time,
    timezone: data.timezone,
    studentsCanSeeRoster: data.students_can_see_roster,
  };
}
