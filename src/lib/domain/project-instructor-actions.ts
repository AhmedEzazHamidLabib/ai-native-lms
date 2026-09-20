"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Same pattern as downloadMaterialVersion — storage RLS is the real authorization check, this just requests the signed URL. */
export async function downloadProjectSubmission(storagePath: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("project-submissions").createSignedUrl(storagePath, 60);
  if (error || !data) throw error ?? new Error("Could not create download link.");
  redirect(data.signedUrl);
}

function projectPaths(courseId: string) {
  return [
    `/instructor/courses/${courseId}/project`,
    `/instructor/courses/${courseId}/project/groups`,
    `/instructor/courses/${courseId}/project/deliverables`,
    `/instructor/courses/${courseId}/project/submissions`,
    `/instructor/courses/${courseId}/project/grades`,
    `/student/courses/${courseId}/project`,
  ];
}

async function revalidateProject(courseId: string) {
  for (const path of projectPaths(courseId)) revalidatePath(path);
}

export async function setGroupModeAction(courseId: string, projectId: string, mode: "instructor_assigned" | "self_enrollment") {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_project_group_mode", { p_project_id: projectId, p_mode: mode });
  if (error) throw new Error(error.message);
  await revalidateProject(courseId);
}

export async function setGroupsLockedAction(courseId: string, projectId: string, locked: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_project_groups_locked", { p_project_id: projectId, p_locked: locked });
  if (error) throw new Error(error.message);
  await revalidateProject(courseId);
}

export async function createGroupAction(courseId: string, projectId: string, name: string, capacity: number | null) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_project_group", { p_project_id: projectId, p_name: name, p_capacity: capacity });
  if (error) throw new Error(error.message);
  await revalidateProject(courseId);
}

export async function updateGroupAction(courseId: string, groupId: string, name: string, capacity: number | null) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_project_group", { p_group_id: groupId, p_name: name, p_capacity: capacity });
  if (error) throw new Error(error.message);
  await revalidateProject(courseId);
}

export async function deleteGroupAction(courseId: string, groupId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_project_group", { p_group_id: groupId });
  if (error) throw new Error(error.message);
  await revalidateProject(courseId);
}

export async function assignStudentAction(courseId: string, groupId: string, userId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_student_to_group", { p_group_id: groupId, p_user_id: userId });
  if (error) throw new Error(error.message);
  await revalidateProject(courseId);
}

export async function removeStudentAction(courseId: string, groupId: string, userId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_student_from_group", { p_group_id: groupId, p_user_id: userId });
  if (error) throw new Error(error.message);
  await revalidateProject(courseId);
}

export async function createDeliverableAction(
  courseId: string,
  projectId: string,
  input: {
    title: string;
    description: string;
    dueAt: string | null;
    submissionEnabled: boolean;
    allowedType: string | null;
    published: boolean;
  },
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_project_deliverable", {
    p_project_id: projectId,
    p_title: input.title,
    p_description: input.description,
    p_due_at: input.dueAt,
    p_submission_enabled: input.submissionEnabled,
    p_allowed_type: input.allowedType,
    p_published: input.published,
  });
  if (error) throw new Error(error.message);
  await revalidateProject(courseId);
}

export async function updateDeliverableAction(
  courseId: string,
  deliverableId: string,
  input: {
    title: string;
    description: string;
    dueAt: string | null;
    submissionEnabled: boolean;
    allowedType: string | null;
    published: boolean;
  },
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_project_deliverable", {
    p_deliverable_id: deliverableId,
    p_title: input.title,
    p_description: input.description,
    p_due_at: input.dueAt,
    p_submission_enabled: input.submissionEnabled,
    p_allowed_type: input.allowedType,
    p_published: input.published,
  });
  if (error) throw new Error(error.message);
  await revalidateProject(courseId);
}

export async function deleteDeliverableAction(courseId: string, deliverableId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_project_deliverable", { p_deliverable_id: deliverableId });
  if (error) throw new Error(error.message);
  await revalidateProject(courseId);
}

export async function setGroupGradeAction(
  courseId: string,
  projectId: string,
  groupId: string,
  score: number,
  maxScore: number,
  feedback: string | null,
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_project_group_grade", {
    p_project_id: projectId,
    p_group_id: groupId,
    p_score: score,
    p_max_score: maxScore,
    p_feedback: feedback,
  });
  if (error) throw new Error(error.message);
  await revalidateProject(courseId);
}
