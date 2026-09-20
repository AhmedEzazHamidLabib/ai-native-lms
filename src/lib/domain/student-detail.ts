import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getLearningObjectives, type ObjectiveEvidence } from "@/lib/tutor/evidence";
import { trendLabel } from "@/lib/tutor/learning-profile";
import { getCourseGradebook, getCourseProjectGrades } from "./assessments";
import type { GradebookRow, StudentProjectGrade } from "./assessment-types";

export interface StudentMisconceptionRow {
  learningObjectiveId: string;
  description: string;
  resolved: boolean;
  updatedAt: string;
}

export interface StudentObjectiveSummary {
  learningObjectiveId: string;
  title: string;
  assessment: ObjectiveEvidence | null;
  practice: ObjectiveEvidence | null;
  trend: string;
  misconception: StudentMisconceptionRow | null;
}

export interface StudentDetail {
  userId: string;
  email: string;
  fullName: string | null;
  enrolledAt: string;
  projectGroupName: string | null;
  projectGrade: StudentProjectGrade | null;
  grades: GradebookRow[];
  objectives: StudentObjectiveSummary[];
}

export async function getStudentDetail(courseId: string, userId: string): Promise<StudentDetail | null> {
  const supabase = await createClient();

  const { data: roster } = await supabase.rpc("list_course_roster", { p_course_id: courseId });
  const entry = (roster ?? []).find((r) => r.user_id === userId);
  if (!entry) return null;

  const [gradebook, objectives, assessmentEvidenceRaw, practiceEvidenceRaw, misconceptionsRaw, projectGrades] = await Promise.all([
    getCourseGradebook(courseId),
    getLearningObjectives(supabase, courseId),
    supabase.rpc("get_student_objective_evidence_for_instructor", { p_course_id: courseId, p_user_id: userId }),
    supabase.rpc("get_student_practice_evidence_for_instructor", { p_course_id: courseId, p_user_id: userId }),
    supabase
      .from("student_misconceptions")
      .select("learning_objective_id, description, resolved, updated_at")
      .eq("course_id", courseId)
      .eq("user_id", userId),
    getCourseProjectGrades(courseId),
  ]);

  const assessmentEvidence: ObjectiveEvidence[] = (assessmentEvidenceRaw.data ?? []).map((r) => ({
    learningObjectiveId: r.learning_objective_id,
    title: r.title,
    position: r.position,
    correct: r.correct,
    attempted: r.attempted,
  }));
  const practiceEvidence: ObjectiveEvidence[] = (practiceEvidenceRaw.data ?? []).map((r) => ({
    learningObjectiveId: r.learning_objective_id,
    title: r.title,
    position: r.position,
    correct: r.correct,
    attempted: r.attempted,
  }));
  const misconceptions = misconceptionsRaw.data ?? [];

  const projectGrade = projectGrades.find((p) => p.userId === userId) ?? null;
  const projectGroupName = projectGrade?.groupName ?? null;

  const objectiveSummaries: StudentObjectiveSummary[] = objectives.map((o) => {
    const assessment = assessmentEvidence.find((e) => e.learningObjectiveId === o.id) ?? null;
    const practice = practiceEvidence.find((e) => e.learningObjectiveId === o.id) ?? null;
    const misconception = misconceptions.find((m) => m.learning_objective_id === o.id);
    return {
      learningObjectiveId: o.id,
      title: o.title,
      assessment,
      practice,
      trend: trendLabel(assessment ?? { learningObjectiveId: o.id, title: o.title, position: o.position, correct: 0, attempted: 0 }, practice ?? undefined),
      misconception: misconception
        ? {
            learningObjectiveId: misconception.learning_objective_id,
            description: misconception.description,
            resolved: misconception.resolved,
            updatedAt: misconception.updated_at,
          }
        : null,
    };
  });

  return {
    userId: entry.user_id,
    email: entry.email,
    fullName: entry.full_name,
    enrolledAt: entry.enrolled_at,
    projectGroupName,
    projectGrade,
    grades: gradebook.filter((g) => g.userId === userId),
    objectives: objectiveSummaries,
  };
}
