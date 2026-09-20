import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCourseGradebook, getCourseProjectGrades } from "./assessments";
import type { GradebookStudentSummary } from "./assessment-types";

export interface RosterEntry {
  userId: string;
  email: string;
  fullName: string | null;
  enrolledAt: string;
}

export interface RosterSummaryEntry extends RosterEntry {
  projectGroupName: string | null;
  assessmentsSubmitted: number;
  assessmentsTotal: number;
}

/** Enrollment roster enriched with project group + assessment completion — powers the instructor Students table. */
export async function getCourseRosterSummary(courseId: string): Promise<RosterSummaryEntry[]> {
  const supabase = await createClient();
  const roster = await getCourseRoster(courseId);
  if (roster.length === 0) return [];

  const [gradebook, { data: project }] = await Promise.all([
    getCourseGradebook(courseId),
    supabase.from("projects").select("id").eq("course_id", courseId).maybeSingle(),
  ]);

  let groupByUser = new Map<string, string>();
  if (project) {
    const { data: groups } = await supabase.from("project_groups").select("id, name").eq("project_id", project.id);
    const { data: members } = await supabase
      .from("project_group_members")
      .select("group_id, user_id")
      .in("group_id", (groups ?? []).map((g) => g.id));
    const groupName = new Map((groups ?? []).map((g) => [g.id, g.name]));
    groupByUser = new Map(
      (members ?? []).filter((m) => m.user_id).map((m) => [m.user_id as string, groupName.get(m.group_id) ?? "Group"]),
    );
  }

  return roster.map((r) => {
    const rows = gradebook.filter((g) => g.userId === r.userId);
    return {
      ...r,
      projectGroupName: groupByUser.get(r.userId) ?? null,
      assessmentsSubmitted: rows.filter((g) => g.status === "submitted").length,
      assessmentsTotal: rows.length,
    };
  });
}

export interface PendingRequestEntry {
  requestId: string;
  userId: string;
  email: string;
  fullName: string | null;
  requestedAt: string;
}

export async function getCourseRoster(courseId: string): Promise<RosterEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_course_roster", {
    p_course_id: courseId,
  });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    userId: r.user_id,
    email: r.email,
    fullName: r.full_name,
    enrolledAt: r.enrolled_at,
  }));
}

export async function getPendingRequests(courseId: string): Promise<PendingRequestEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_pending_requests", {
    p_course_id: courseId,
  });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    requestId: r.request_id,
    userId: r.user_id,
    email: r.email,
    fullName: r.full_name,
    requestedAt: r.requested_at,
  }));
}

/**
 * Student-centric gradebook (Part 9 of the instructor product pass):
 * one summary per enrolled student, never a raw (student, assessment)
 * row count as a headline metric — that shape is what produced the
 * "26 not started" nonsense (10 students x 3 assessments, one of which
 * — Project — never gets an attempts row for anyone, minus however
 * many actually started something).
 */
export async function getGradebookSummary(courseId: string): Promise<GradebookStudentSummary[]> {
  const [roster, gradeRows, projectGrades] = await Promise.all([
    getCourseRoster(courseId),
    getCourseGradebook(courseId),
    getCourseProjectGrades(courseId),
  ]);

  return roster.map((r) => {
    const rows = gradeRows.filter((g) => g.userId === r.userId);
    const project = projectGrades.find((p) => p.userId === r.userId) ?? null;
    return {
      userId: r.userId,
      email: r.email,
      fullName: r.fullName,
      assessments: rows.map((row) => ({
        assessmentId: row.assessmentId,
        title: row.assessmentTitle,
        kind: row.assessmentKind,
        pointsPossible: row.pointsPossible,
        contributesToGrade: row.contributesToGrade,
        status: row.status,
        score: row.score,
        maxScore: row.maxScore,
        submittedAt: row.submittedAt,
        attemptId: row.attemptId,
      })),
      project,
    };
  });
}
