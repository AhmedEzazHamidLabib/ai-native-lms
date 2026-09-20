import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface ProjectGroupMember {
  userId: string;
  fullName: string;
}

export interface ProjectGroupOverview {
  groupId: string;
  name: string;
  capacity: number | null;
  members: ProjectGroupMember[];
  grade: { score: number; maxScore: number; feedback: string | null } | null;
}

export interface ProjectInstructorOverview {
  groupMode: "instructor_assigned" | "self_enrollment";
  groupsLocked: boolean;
  groups: ProjectGroupOverview[];
  unassignedStudents: ProjectGroupMember[];
}

export async function getProjectInstructorOverview(projectId: string): Promise<ProjectInstructorOverview> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_project_instructor_overview", { p_project_id: projectId });
  if (error) throw new Error(error.message);
  return data as unknown as ProjectInstructorOverview;
}

export interface DeliverableRow {
  id: string;
  title: string;
  description: string;
  dueAt: string | null;
  position: number;
  submissionEnabled: boolean;
  allowedType: string | null;
  published: boolean;
}

export async function getProjectDeliverables(projectId: string): Promise<DeliverableRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_deliverables")
    .select("id, title, description, due_at, position, submission_enabled, allowed_type, published")
    .eq("project_id", projectId)
    .order("position");
  if (error) throw error;
  return (data ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    description: d.description,
    dueAt: d.due_at,
    position: d.position,
    submissionEnabled: d.submission_enabled,
    allowedType: d.allowed_type,
    published: d.published,
  }));
}

export interface SubmissionRow {
  id: string;
  deliverableId: string;
  deliverableTitle: string;
  groupId: string;
  groupName: string;
  submittedByUserId: string;
  submittedByName: string;
  storagePath: string;
  note: string | null;
  submittedAt: string;
  superseded: boolean;
}

/** Every submission (current + superseded) across this project — instructor-only, powers the Submissions tab. */
export async function getProjectSubmissions(projectId: string): Promise<SubmissionRow[]> {
  const supabase = await createClient();

  const { data: deliverables } = await supabase
    .from("project_deliverables")
    .select("id, title")
    .eq("project_id", projectId);
  const deliverableIds = (deliverables ?? []).map((d) => d.id);
  if (deliverableIds.length === 0) return [];

  const { data: submissions, error } = await supabase
    .from("project_submissions")
    .select("id, deliverable_id, group_id, submitted_by_user_id, storage_path, note, submitted_at, superseded_at")
    .in("deliverable_id", deliverableIds)
    .order("submitted_at", { ascending: false });
  if (error) throw error;
  if (!submissions || submissions.length === 0) return [];

  const groupIds = [...new Set(submissions.map((s) => s.group_id))];
  const userIds = [...new Set(submissions.map((s) => s.submitted_by_user_id))];

  const [{ data: groups }, { data: profiles }] = await Promise.all([
    supabase.from("project_groups").select("id, name").in("id", groupIds),
    supabase.from("profiles").select("user_id, full_name").in("user_id", userIds),
  ]);

  const deliverableTitle = new Map((deliverables ?? []).map((d) => [d.id, d.title]));
  const groupName = new Map((groups ?? []).map((g) => [g.id, g.name]));
  const profileName = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));

  return submissions.map((s) => ({
    id: s.id,
    deliverableId: s.deliverable_id,
    deliverableTitle: deliverableTitle.get(s.deliverable_id) ?? "Deliverable",
    groupId: s.group_id,
    groupName: groupName.get(s.group_id) ?? "Group",
    submittedByUserId: s.submitted_by_user_id,
    submittedByName: profileName.get(s.submitted_by_user_id) ?? "Unnamed student",
    storagePath: s.storage_path,
    note: s.note,
    submittedAt: s.submitted_at,
    superseded: s.superseded_at !== null,
  }));
}
