"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function paths(courseId: string) {
  return [`/instructor/courses/${courseId}/announcements`, `/student/courses/${courseId}/announcements`, `/student/courses/${courseId}`];
}

export async function createAnnouncementAction(
  courseId: string,
  input: { title: string; body: string; pinned: boolean; expiresAt: string | null; publishNow: boolean },
): Promise<{ error: string | null }> {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title) return { error: "Title is required." };
  if (!body) return { error: "Body is required." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase.from("announcements").insert({
    course_id: courseId,
    title,
    body,
    pinned: input.pinned,
    expires_at: input.expiresAt,
    published_at: input.publishNow ? new Date().toISOString() : null,
    created_by: user.id,
  });
  if (error) return { error: error.message };

  for (const path of paths(courseId)) revalidatePath(path);
  return { error: null };
}

export async function updateAnnouncementAction(
  courseId: string,
  announcementId: string,
  input: { title: string; body: string; pinned: boolean; expiresAt: string | null },
): Promise<{ error: string | null }> {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title) return { error: "Title is required." };
  if (!body) return { error: "Body is required." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("announcements")
    .update({ title, body, pinned: input.pinned, expires_at: input.expiresAt, updated_at: new Date().toISOString() })
    .eq("id", announcementId);
  if (error) return { error: error.message };

  for (const path of paths(courseId)) revalidatePath(path);
  return { error: null };
}

export async function setAnnouncementPublished(courseId: string, announcementId: string, published: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("announcements")
    .update({ published_at: published ? new Date().toISOString() : null })
    .eq("id", announcementId);
  if (error) throw error;
  for (const path of paths(courseId)) revalidatePath(path);
}

export async function deleteAnnouncementAction(courseId: string, announcementId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("announcements").delete().eq("id", announcementId);
  if (error) throw error;
  for (const path of paths(courseId)) revalidatePath(path);
}
