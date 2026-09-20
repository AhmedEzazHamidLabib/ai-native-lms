import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  AssessmentSummary,
  AttemptSummary,
  AttemptView,
  CoursePerformance,
  GradebookRow,
  StudentAssessmentStatus,
  StudentPerformance,
  StudentProjectGrade,
} from "./assessment-types";

export async function getInstructorAssessments(
  courseId: string,
): Promise<AssessmentSummary[]> {
  const supabase = await createClient();

  const { data: assessments, error } = await supabase
    .from("assessments")
    .select(
      "id, title, instructions, question_count, published_at, locked, kind, points_possible, contributes_to_grade, selection_mode, question_order_mode, option_order_mode",
    )
    .eq("course_id", courseId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  if (!assessments) return [];

  const summaries: AssessmentSummary[] = [];
  for (const a of assessments) {
    const { data: rules } = await supabase
      .from("assessment_rules")
      .select("count, lectures(title), fixed_question_id, questions(prompt)")
      .eq("assessment_id", a.id)
      .order("position");

    const { data: attempts } = await supabase
      .from("attempts")
      .select("submitted_at")
      .eq("assessment_id", a.id);

    summaries.push({
      id: a.id,
      title: a.title,
      instructions: a.instructions,
      questionCount: a.question_count,
      publishedAt: a.published_at,
      locked: a.locked,
      kind: a.kind,
      pointsPossible: a.points_possible,
      contributesToGrade: a.contributes_to_grade,
      selectionMode: a.selection_mode,
      questionOrderMode: a.question_order_mode,
      optionOrderMode: a.option_order_mode,
      ruleBreakdown: (rules ?? []).map((r) => ({
        lectureTitle:
          (r as unknown as { lectures: { title: string } | null }).lectures?.title ?? null,
        count: r.count,
        fixedQuestionPrompt:
          (r as unknown as { questions: { prompt: string } | null }).questions?.prompt ?? null,
      })),
      attemptCount: attempts?.length ?? 0,
      submittedCount: (attempts ?? []).filter((a) => a.submitted_at !== null).length,
    });
  }
  return summaries;
}

export interface CreateAssessmentRule {
  position: number;
  sourceLectureId?: string | null;
  topic?: string | null;
  difficulty?: string | null;
  count?: number;
  fixedQuestionId?: string | null;
  questionType?: "single_choice" | "written" | null;
}

export interface CreateAssessmentInput {
  courseId: string;
  bankId: string;
  title: string;
  instructions: string;
  kind: "mock_test" | "class_test";
  pointsPossible: number | null;
  selectionMode: "random" | "fixed";
  questionOrderMode: "fixed" | "shuffled";
  optionOrderMode: "fixed" | "shuffled";
  rules: CreateAssessmentRule[];
}

/**
 * The one instructor entry point for Mock/Class Test creation. All
 * authorization and the Class-Test/Practice-visibility integrity check
 * live in the create_assessment() SQL function — never trust a UI-only
 * warning for that rule.
 */
export async function createAssessment(input: CreateAssessmentInput): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_assessment", {
    p_course_id: input.courseId,
    p_bank_id: input.bankId,
    p_title: input.title,
    p_instructions: input.instructions,
    p_kind: input.kind,
    p_points_possible: input.pointsPossible,
    p_selection_mode: input.selectionMode,
    p_question_order_mode: input.questionOrderMode,
    p_option_order_mode: input.optionOrderMode,
    p_rules: input.rules,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function getAssessmentAttempts(
  assessmentId: string,
): Promise<AttemptSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_assessment_attempts", {
    p_assessment_id: assessmentId,
  });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.attempt_id,
    userId: r.user_id,
    userEmail: r.user_email,
    startedAt: r.started_at,
    submittedAt: r.submitted_at,
    score: r.score,
    maxScore: r.max_score,
  }));
}

export async function getStudentAssessments(
  courseId: string,
): Promise<StudentAssessmentStatus[]> {
  const supabase = await createClient();

  const { data: assessments, error } = await supabase
    .from("assessments")
    .select("id, title, instructions, question_count, locked, kind, points_possible, contributes_to_grade, is_diagnostic")
    .eq("course_id", courseId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  if (!assessments) return [];

  const { data: attempts } = await supabase
    .from("attempts")
    .select("id, assessment_id, submitted_at, score, max_score");

  return assessments.map((a) => {
    const attempt = attempts?.find((at) => at.assessment_id === a.id) ?? null;
    return {
      id: a.id,
      title: a.title,
      instructions: a.instructions,
      questionCount: a.question_count,
      locked: a.locked,
      kind: a.kind,
      pointsPossible: a.points_possible,
      contributesToGrade: a.contributes_to_grade,
      isDiagnostic: a.is_diagnostic,
      attemptId: attempt?.id ?? null,
      submittedAt: attempt?.submitted_at ?? null,
      score: attempt?.score ?? null,
      maxScore: attempt?.max_score ?? null,
    };
  });
}

export async function getAttemptView(attemptId: string): Promise<AttemptView | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_attempt_view", {
    p_attempt_id: attemptId,
  });
  if (error) return null;
  return data as unknown as AttemptView;
}

export async function isAssessmentDiagnostic(assessmentId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.from("assessments").select("is_diagnostic").eq("id", assessmentId).maybeSingle();
  return data?.is_diagnostic ?? false;
}

/** This student's own accuracy in one course — powers the student Performance page. */
export async function getStudentPerformance(courseId: string): Promise<StudentPerformance | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_student_performance", {
    p_course_id: courseId,
  });
  if (error) return null;
  const raw = data as unknown as {
    assessmentsCompleted: number;
    questionsCorrect: number;
    questionsTotal: number;
    lectureBreakdown: { lecture_id: string; lecture_title: string; correct: number; total: number }[];
    topicBreakdown: { topic: string; correct: number; total: number }[];
  };
  return {
    assessmentsCompleted: raw.assessmentsCompleted,
    questionsCorrect: raw.questionsCorrect,
    questionsTotal: raw.questionsTotal,
    lectureBreakdown: raw.lectureBreakdown.map((l) => ({
      lectureId: l.lecture_id,
      lectureTitle: l.lecture_title,
      correct: l.correct,
      total: l.total,
    })),
    topicBreakdown: raw.topicBreakdown,
  };
}

/** One row per (enrolled student, assessment) in this course — instructor-only, powers the Gradebook. */
export async function getCourseGradebook(courseId: string): Promise<GradebookRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_course_gradebook", {
    p_course_id: courseId,
  });
  if (error || !data) return [];
  return data.map((r) => ({
    userId: r.user_id,
    userEmail: r.user_email,
    assessmentId: r.assessment_id,
    assessmentTitle: r.assessment_title,
    assessmentKind: r.assessment_kind,
    pointsPossible: r.points_possible,
    contributesToGrade: r.contributes_to_grade,
    attemptId: r.attempt_id,
    status: r.status,
    score: r.score,
    maxScore: r.max_score,
    submittedAt: r.submitted_at,
  }));
}

export async function getCourseProjectGrades(courseId: string): Promise<StudentProjectGrade[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_course_project_grades", { p_course_id: courseId });
  if (error || !data) return [];
  return data.map((r) => ({
    userId: r.user_id,
    projectId: r.project_id,
    groupId: r.group_id,
    groupName: r.group_name,
    score: r.score,
    maxScore: r.max_score,
    feedback: r.feedback,
  }));
}

/** Course-wide aggregate accuracy — instructor-only, powers the instructor Performance page. */
export async function getCoursePerformance(courseId: string): Promise<CoursePerformance | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_course_performance", {
    p_course_id: courseId,
  });
  if (error) return null;
  const raw = data as unknown as {
    studentsSubmitted: number;
    totalStudents: number;
    averagePercent: number | null;
    medianPercent: number | null;
    lectureBreakdown: { lecture_id: string; lecture_title: string; correct: number; total: number }[];
    topicBreakdown: { topic: string; correct: number; total: number }[];
    questionBreakdown: {
      question_id: string;
      prompt: string;
      topic: string;
      lecture_title: string | null;
      correct: number;
      total: number;
      correct_pct: number;
    }[];
  };
  return {
    studentsSubmitted: raw.studentsSubmitted,
    totalStudents: raw.totalStudents,
    averagePercent: raw.averagePercent,
    medianPercent: raw.medianPercent,
    lectureBreakdown: raw.lectureBreakdown.map((l) => ({
      lectureId: l.lecture_id,
      lectureTitle: l.lecture_title,
      correct: l.correct,
      total: l.total,
    })),
    topicBreakdown: raw.topicBreakdown,
    questionBreakdown: raw.questionBreakdown.map((q) => ({
      questionId: q.question_id,
      prompt: q.prompt,
      topic: q.topic,
      lectureTitle: q.lecture_title,
      correct: q.correct,
      total: q.total,
      correctPct: q.correct_pct,
    })),
  };
}
