import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface CourseMemberEntry {
  userId: string;
  fullName: string;
  isMe: boolean;
}

/** Names only, never emails — course-membership-checked server-side via list_course_members_directory(). */
export async function getCourseMembersDirectory(courseId: string): Promise<CourseMemberEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_course_members_directory", { p_course_id: courseId });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ userId: r.user_id, fullName: r.full_name, isMe: r.is_me }));
}
