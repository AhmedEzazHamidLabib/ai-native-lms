import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  publishedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Instructor view — every announcement (draft + published + expired), newest/pinned first. */
export async function getInstructorAnnouncements(courseId: string): Promise<AnnouncementRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("announcements")
    .select("id, title, body, pinned, published_at, expires_at, created_at, updated_at")
    .eq("course_id", courseId)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToAnnouncement);
}

/** Student view — RLS already restricts to published + unexpired; pinned first, then newest. */
export async function getStudentAnnouncements(courseId: string): Promise<AnnouncementRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("announcements")
    .select("id, title, body, pinned, published_at, expires_at, created_at, updated_at")
    .eq("course_id", courseId)
    .order("pinned", { ascending: false })
    .order("published_at", { ascending: false });
  if (error) return [];
  return (data ?? []).map(rowToAnnouncement);
}

function rowToAnnouncement(r: {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  published_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}): AnnouncementRow {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    pinned: r.pinned,
    publishedAt: r.published_at,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
