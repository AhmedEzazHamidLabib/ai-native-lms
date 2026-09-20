export interface AssessmentSummary {
  id: string;
  title: string;
  instructions: string;
  questionCount: number;
  publishedAt: string | null;
  locked: boolean;
  kind: "mock_test" | "class_test" | "project";
  pointsPossible: number | null;
  contributesToGrade: boolean;
  selectionMode: "random" | "fixed";
  questionOrderMode: "fixed" | "shuffled";
  optionOrderMode: "fixed" | "shuffled";
  ruleBreakdown: { lectureTitle: string | null; count: number; fixedQuestionPrompt: string | null }[];
  attemptCount: number;
  submittedCount: number;
}

export interface AttemptSummary {
  id: string;
  userId: string;
  userEmail: string;
  startedAt: string;
  submittedAt: string | null;
  score: number | null;
  maxScore: number | null;
}

export type AssessmentKind = "mock_test" | "class_test" | "project";

export interface StudentAssessmentStatus {
  id: string;
  title: string;
  instructions: string;
  questionCount: number;
  locked: boolean;
  kind: AssessmentKind;
  pointsPossible: number | null;
  contributesToGrade: boolean;
  isDiagnostic: boolean;
  attemptId: string | null;
  submittedAt: string | null;
  score: number | null;
  maxScore: number | null;
}

export interface TopicStat {
  topic: string;
  correct: number;
  total: number;
}

export interface LectureStat {
  lectureId: string;
  lectureTitle: string;
  correct: number;
  total: number;
}

/** Mirrors get_student_performance()'s JSON shape — see 0010_grades_performance.sql. */
export interface StudentPerformance {
  assessmentsCompleted: number;
  questionsCorrect: number;
  questionsTotal: number;
  lectureBreakdown: LectureStat[];
  topicBreakdown: TopicStat[];
}

export type GradebookStatus = "not_started" | "in_progress" | "submitted";

/**
 * One (student, assessment) row from get_course_gradebook() — see
 * 0039_gradebook_redesign.sql. Covers assessment-engine-backed kinds
 * only (mock_test/class_test); Project completion is tracked
 * separately via get_course_project_grades() since it has no
 * `attempts` row concept at all.
 */
export interface GradebookRow {
  userId: string;
  userEmail: string;
  assessmentId: string;
  assessmentTitle: string;
  assessmentKind: "mock_test" | "class_test" | "project";
  pointsPossible: number | null;
  contributesToGrade: boolean;
  attemptId: string | null;
  status: GradebookStatus;
  score: number | null;
  maxScore: number | null;
  submittedAt: string | null;
}

export interface StudentProjectGrade {
  userId: string;
  projectId: string;
  groupId: string | null;
  groupName: string | null;
  score: number | null;
  maxScore: number | null;
  feedback: string | null;
}

export interface GradebookStudentSummary {
  userId: string;
  email: string;
  fullName: string | null;
  assessments: {
    assessmentId: string;
    title: string;
    kind: "mock_test" | "class_test" | "project";
    pointsPossible: number | null;
    contributesToGrade: boolean;
    status: GradebookStatus;
    score: number | null;
    maxScore: number | null;
    submittedAt: string | null;
    attemptId: string | null;
  }[];
  project: StudentProjectGrade | null;
}

export interface QuestionStat {
  questionId: string;
  prompt: string;
  topic: string;
  lectureTitle: string | null;
  correct: number;
  total: number;
  correctPct: number;
}

/** Mirrors get_course_performance()'s JSON shape — see 0010_grades_performance.sql. */
export interface CoursePerformance {
  studentsSubmitted: number;
  totalStudents: number;
  averagePercent: number | null;
  medianPercent: number | null;
  lectureBreakdown: LectureStat[];
  topicBreakdown: TopicStat[];
  questionBreakdown: QuestionStat[];
}

/** Mirrors get_attempt_view()'s JSON shape — see 0006_assessments_rls.sql. */
export interface AttemptView {
  attemptId: string;
  assessmentId: string;
  assessmentTitle: string;
  startedAt: string;
  submittedAt: string | null;
  score: number | null;
  maxScore: number | null;
  pendingGradingCount: number;
  questions: {
    position: number;
    questionId: string;
    questionType: "single_choice" | "written";
    prompt: string;
    selectedOptionId: string | null;
    textResponse: string | null;
    isCorrectManual: boolean | null;
    gradingNote: string | null;
    answerGuide: string | null;
    explanation: string | null;
    options: { optionId: string; text: string; isCorrect?: boolean }[];
  }[];
}
