import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface CalendarSessionNote {
  id: string;
  title: string | null;
  agenda: string | null;
  cancelled: boolean;
  relatedLectureId: string | null;
  relatedAssessmentId: string | null;
  announcementId: string | null;
}

export interface CalendarSession {
  date: string;
  dayName: string;
  note: CalendarSessionNote | null;
}

export type CourseEventCategory = "exam" | "project_deadline" | "special_class" | "holiday" | "other";

export interface CalendarEvent {
  id: string;
  date: string;
  category: CourseEventCategory;
  title: string;
  details: string | null;
  announcementId: string | null;
}

export interface CourseCalendar {
  startDate: string | null;
  endDate: string | null;
  meetingDays: string[];
  meetingStartTime: string | null;
  meetingEndTime: string | null;
  timezone: string;
  sessions: CalendarSession[];
  events: CalendarEvent[];
}

export async function getCourseCalendar(courseId: string, from: string, to: string): Promise<CourseCalendar> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_course_calendar", { p_course_id: courseId, p_from: from, p_to: to });
  if (error || !data) {
    return { startDate: null, endDate: null, meetingDays: [], meetingStartTime: null, meetingEndTime: null, timezone: "UTC", sessions: [], events: [] };
  }
  return data;
}
