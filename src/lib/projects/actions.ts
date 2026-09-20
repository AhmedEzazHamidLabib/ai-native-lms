"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface ProjectInfo {
  id: string;
  description: string;
  pointsPossible: number | null;
  groupMode: "instructor_assigned" | "self_enrollment";
  groupsLocked: boolean;
}

export async function getProjectForCourse(courseId: string): Promise<ProjectInfo | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id, description, assessment_id, group_mode, groups_locked, assessments(points_possible)")
    .eq("course_id", courseId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    description: data.description,
    pointsPossible: (data.assessments as unknown as { points_possible: number | null } | null)?.points_possible ?? null,
    groupMode: data.group_mode,
    groupsLocked: data.groups_locked,
  };
}

/** Groups available for the student to browse/join in self-enrollment mode — name/capacity/member count only. */
export interface JoinableGroup {
  groupId: string;
  name: string;
  capacity: number | null;
  memberCount: number;
  isMine: boolean;
}

export async function getJoinableGroups(projectId: string): Promise<JoinableGroup[]> {
  const supabase = await createClient();
  const { data: groups, error } = await supabase
    .from("project_groups")
    .select("id, name, capacity")
    .eq("project_id", projectId);
  if (error || !groups) return [];

  const { data: user } = await supabase.auth.getUser();
  const myId = user?.user?.id ?? null;

  const result: JoinableGroup[] = [];
  for (const g of groups) {
    const { count } = await supabase
      .from("project_group_members")
      .select("id", { count: "exact", head: true })
      .eq("group_id", g.id);
    const { data: mine } = myId
      ? await supabase.from("project_group_members").select("id").eq("group_id", g.id).eq("user_id", myId).maybeSingle()
      : { data: null };
    result.push({ groupId: g.id, name: g.name, capacity: g.capacity, memberCount: count ?? 0, isMine: Boolean(mine) });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

export async function joinGroup(courseId: string, groupId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("join_project_group", { p_group_id: groupId });
  if (error) throw new Error(error.message);
  revalidatePath(`/student/courses/${courseId}/project`);
}

export async function leaveGroup(courseId: string, groupId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("leave_project_group", { p_group_id: groupId });
  if (error) throw new Error(error.message);
  revalidatePath(`/student/courses/${courseId}/project`);
}

export interface ProjectGroupDirectoryEntry {
  groupId: string;
  groupName: string;
  memberUserId: string;
  memberFullName: string;
  isMe: boolean;
}

export async function getProjectGroups(projectId: string): Promise<ProjectGroupDirectoryEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_project_groups", { p_project_id: projectId });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    groupId: r.group_id,
    groupName: r.group_name,
    memberUserId: r.member_user_id,
    memberFullName: r.member_full_name,
    isMe: r.is_me,
  }));
}

export interface MyProjectDeliverable {
  deliverableId: string;
  title: string;
  description: string;
  dueAt: string | null;
  position: number;
  submissionEnabled: boolean;
  allowedType: string | null;
  submitted: boolean;
  submittedAt: string | null;
  submittedByName: string | null;
  note: string | null;
}

export interface MyProjectGroup {
  groupId: string | null;
  deliverables: MyProjectDeliverable[];
}

export async function getMyProjectGroup(projectId: string): Promise<MyProjectGroup> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_project_group", { p_project_id: projectId });
  if (error || !data) return { groupId: null, deliverables: [] };

  if ("group" in data) return { groupId: null, deliverables: [] };

  return {
    groupId: data.groupId,
    deliverables: data.deliverables.map((d) => ({
      deliverableId: d.deliverableId,
      title: d.title,
      description: d.description,
      dueAt: d.dueAt,
      position: d.position,
      submissionEnabled: d.submissionEnabled,
      allowedType: d.allowedType,
      submitted: d.submitted,
      submittedAt: d.submittedAt,
      submittedByName: d.submittedByName,
      note: d.note,
    })),
  };
}
