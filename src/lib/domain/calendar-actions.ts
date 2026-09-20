"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { CourseEventCategory } from "./calendar";

function paths(courseId: string) {
  return [
    `/instructor/courses/${courseId}/calendar`,
    `/student/courses/${courseId}/calendar`,
    `/instructor/courses/${courseId}/announcements`,
    `/student/courses/${courseId}/announcements`,
  ];
}

/**
 * Creates a NEW linked announcement, or updates the existing one if
 * this session/event already has one — never a second, duplicate
 * announcement for the same calendar item (Part 12: "do not duplicate
 * uncontrollably if the event is subsequently edited").
 */
async function syncLinkedAnnouncement(
  courseId: string,
  existingAnnouncementId: string | null,
  title: string,
  body: string,
): Promise<{ announcementId: string | null; error: string | null }> {
  const supabase = await createClient();
  if (existingAnnouncementId) {
    const { error } = await supabase
      .from("announcements")
      .update({ title, body, updated_at: new Date().toISOString() })
      .eq("id", existingAnnouncementId);
    if (error) return { announcementId: null, error: error.message };
    return { announcementId: existingAnnouncementId, error: null };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { announcementId: null, error: "Not signed in." };

  const { data, error } = await supabase
    .from("announcements")
    .insert({ course_id: courseId, title, body, published_at: new Date().toISOString(), created_by: user.id })
    .select("id")
    .single();
  if (error || !data) return { announcementId: null, error: error?.message ?? "Could not create announcement." };
  return { announcementId: data.id, error: null };
}

export async function upsertSessionNoteAction(
  courseId: string,
  input: {
    sessionDate: string;
    title: string | null;
    agenda: string | null;
    relatedLectureId: string | null;
    relatedAssessmentId: string | null;
    cancelled: boolean;
    existingAnnouncementId: string | null;
    alsoAnnounce: boolean;
  },
): Promise<{ error: string | null }> {
  const supabase = await createClient();

  let announcementId = input.existingAnnouncementId;
  if (input.alsoAnnounce) {
    const displayTitle = input.title?.trim() || `Class session — ${input.sessionDate}`;
    const body = [input.agenda?.trim(), `Date: ${input.sessionDate}`].filter(Boolean).join("\n\n");
    const result = await syncLinkedAnnouncement(courseId, input.existingAnnouncementId, displayTitle, body);
    if (result.error) return { error: result.error };
    announcementId = result.announcementId;
  }

  const { error } = await supabase.rpc("upsert_session_note", {
    p_course_id: courseId,
    p_session_date: input.sessionDate,
    p_title: input.title,
    p_agenda: input.agenda,
    p_related_lecture_id: input.relatedLectureId,
    p_related_assessment_id: input.relatedAssessmentId,
    p_cancelled: input.cancelled,
    p_announcement_id: announcementId,
  });
  if (error) return { error: error.message };

  for (const path of paths(courseId)) revalidatePath(path);
  return { error: null };
}

export async function createCourseEventAction(
  courseId: string,
  input: {
    eventDate: string;
    category: CourseEventCategory;
    title: string;
    details: string | null;
    alsoAnnounce: boolean;
  },
): Promise<{ error: string | null }> {
  const title = input.title.trim();
  if (!title) return { error: "Title is required." };

  let announcementId: string | null = null;
  if (input.alsoAnnounce) {
    const body = [input.details?.trim(), `Date: ${input.eventDate}`].filter(Boolean).join("\n\n");
    const result = await syncLinkedAnnouncement(courseId, null, title, body);
    if (result.error) return { error: result.error };
    announcementId = result.announcementId;
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_course_event", {
    p_course_id: courseId,
    p_event_date: input.eventDate,
    p_category: input.category,
    p_title: title,
    p_details: input.details,
    p_announcement_id: announcementId,
  });
  if (error) return { error: error.message };

  for (const path of paths(courseId)) revalidatePath(path);
  return { error: null };
}

export async function deleteCourseEventAction(courseId: string, eventId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_course_event", { p_event_id: eventId });
  if (error) throw new Error(error.message);
  for (const path of paths(courseId)) revalidatePath(path);
}
