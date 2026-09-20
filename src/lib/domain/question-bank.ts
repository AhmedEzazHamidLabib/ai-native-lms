import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Instructor Question Bank management (Part 3). Instructors already
 * have full RLS access to question_banks/questions/question_options
 * for courses they teach (0006_assessments_rls.sql) — this is a thin
 * domain layer over that, not a new authorization surface.
 *
 * Safety: a question already used in an attempt is never hard-deleted
 * — see canDeleteQuestion()/archiveQuestion(). Deleting it would
 * cascade-delete attempt_questions/responses rows via their FKs,
 * silently corrupting a student's historical result.
 */

export interface QuestionOptionInput {
  text: string;
  correct: boolean;
}

export interface QuestionRow {
  id: string;
  bankId: string;
  bankTitle: string;
  questionType: "single_choice" | "written";
  prompt: string;
  topic: string;
  difficulty: string;
  visibility: "practice" | "hidden";
  active: boolean;
  sourceLectureId: string | null;
  learningObjectiveId: string | null;
  options: { id: string; text: string; isCorrect: boolean }[];
  answerGuide: string | null;
  explanation: string | null;
  usedInAttempts: boolean;
}

export async function getQuestionBanksForCourse(courseId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("question_banks")
    .select("id, title, version, created_at")
    .eq("course_id", courseId)
    .order("created_at");
  if (error) throw error;
  return data ?? [];
}

export async function getQuestionsForCourse(courseId: string): Promise<QuestionRow[]> {
  const supabase = await createClient();

  const { data: banks } = await supabase.from("question_banks").select("id, title").eq("course_id", courseId);
  const bankIds = (banks ?? []).map((b) => b.id);
  if (bankIds.length === 0) return [];

  const { data: questions, error } = await supabase
    .from("questions")
    .select(
      "id, bank_id, question_type, prompt, topic, difficulty, visibility, active, source_lecture_id, learning_objective_id, source_position, answer_guide, explanation, question_options(id, text, is_correct)",
    )
    .in("bank_id", bankIds)
    .order("source_position", { ascending: true, nullsFirst: false });
  if (error) throw error;

  // A question is "used" if any attempt_questions row references it —
  // instructors have RLS visibility into attempt_questions only via
  // their course's attempts, which we check with a single IN query.
  const questionIds = (questions ?? []).map((q) => q.id);
  const usedIds = new Set<string>();
  if (questionIds.length > 0) {
    const { data: used } = await supabase
      .from("attempt_questions")
      .select("question_id")
      .in("question_id", questionIds);
    for (const row of used ?? []) usedIds.add(row.question_id);
  }

  const bankTitleById = new Map((banks ?? []).map((b) => [b.id, b.title]));

  return (questions ?? []).map((q) => ({
    id: q.id,
    bankId: q.bank_id,
    bankTitle: bankTitleById.get(q.bank_id) ?? "",
    questionType: (q.question_type as "single_choice" | "written") ?? "single_choice",
    prompt: q.prompt,
    topic: q.topic,
    difficulty: q.difficulty,
    visibility: q.visibility as "practice" | "hidden",
    active: q.active,
    sourceLectureId: q.source_lecture_id,
    learningObjectiveId: q.learning_objective_id,
    options: (q.question_options as unknown as { id: string; text: string; is_correct: boolean }[]).map((o) => ({
      id: o.id,
      text: o.text,
      isCorrect: o.is_correct,
    })),
    answerGuide: q.answer_guide,
    explanation: q.explanation,
    usedInAttempts: usedIds.has(q.id),
  }));
}

export async function createQuestionBank(courseId: string, title: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("question_banks")
    .insert({ course_id: courseId, title, version: 1 })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create bank.");
  return data.id;
}

export interface CreateQuestionInput {
  bankId: string;
  questionType: "single_choice" | "written";
  prompt: string;
  topic: string;
  visibility: "practice" | "hidden";
  sourceLectureId: string | null;
  learningObjectiveId: string | null;
  explanation: string | null;
  /** single_choice only. */
  options: QuestionOptionInput[];
  /** written only — grading reference, never shown to a student as "the correct answer." */
  answerGuide: string | null;
}

/**
 * Malformed-question guard shared by manual authoring and structured
 * import: never allow a single_choice question with zero/one options,
 * zero or multiple correct answers, or a correct flag pointing at
 * nothing — and never allow a written question to reach publication
 * with no answer guide at all (Part 3/17: "do not allow a malformed
 * MCQ", "flag it for instructor correction").
 */
function validateQuestionShape(input: Pick<CreateQuestionInput, "questionType" | "options" | "answerGuide">) {
  if (input.questionType === "single_choice") {
    if (input.options.length < 2) throw new Error("At least two options are required.");
    if (input.options.filter((o) => o.correct).length !== 1) {
      throw new Error("Exactly one option must be marked correct.");
    }
    if (input.options.some((o) => !o.text.trim())) {
      throw new Error("Every option needs text.");
    }
  } else if (input.questionType === "written") {
    if (!input.answerGuide || !input.answerGuide.trim()) {
      throw new Error("A written question needs an answer guide for grading reference.");
    }
  }
}

export async function createQuestion(input: CreateQuestionInput): Promise<string> {
  validateQuestionShape(input);

  const supabase = await createClient();
  const { data: question, error } = await supabase
    .from("questions")
    .insert({
      bank_id: input.bankId,
      prompt: input.prompt,
      topic: input.topic,
      difficulty: "easy",
      question_type: input.questionType,
      active: true,
      visibility: input.visibility,
      source_lecture_id: input.sourceLectureId,
      learning_objective_id: input.learningObjectiveId,
      answer_guide: input.questionType === "written" ? input.answerGuide : null,
      explanation: input.explanation,
    })
    .select("id")
    .single();
  if (error || !question) throw new Error(error?.message ?? "Could not create question.");

  if (input.questionType === "single_choice") {
    const { error: optError } = await supabase.from("question_options").insert(
      input.options.map((o, i) => ({ question_id: question.id, position: i, text: o.text, is_correct: o.correct })),
    );
    if (optError) throw new Error(optError.message);
  }

  return question.id;
}

export async function setQuestionVisibility(questionId: string, visibility: "practice" | "hidden") {
  const supabase = await createClient();
  const { error } = await supabase.from("questions").update({ visibility }).eq("id", questionId);
  if (error) throw new Error(error.message);
}

export async function setQuestionActive(questionId: string, active: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.from("questions").update({ active }).eq("id", questionId);
  if (error) throw new Error(error.message);
}

export async function updateQuestionMapping(
  questionId: string,
  sourceLectureId: string | null,
  learningObjectiveId: string | null,
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("questions")
    .update({ source_lecture_id: sourceLectureId, learning_objective_id: learningObjectiveId })
    .eq("id", questionId);
  if (error) throw new Error(error.message);
}

/** Hard delete — only ever safe for a question never used in an attempt. */
export async function deleteUnusedQuestion(questionId: string) {
  const supabase = await createClient();
  const { count } = await supabase
    .from("attempt_questions")
    .select("id", { count: "exact", head: true })
    .eq("question_id", questionId);
  if ((count ?? 0) > 0) {
    throw new Error("This question has already been used in a student attempt — archive it instead of deleting.");
  }
  const { error } = await supabase.from("questions").delete().eq("id", questionId);
  if (error) throw new Error(error.message);
}

export interface ImportedQuestion {
  type: "mcq" | "written";
  prompt: string;
  topic: string;
  lecture: "L1" | "L2" | null;
  /** mcq only. */
  options: { text: string; correct: boolean }[];
  /** written only. */
  answerGuide: string | null;
}

/**
 * Validates a structured JSON question-import payload. Deliberately
 * strict (Part 4/17): a malformed item (no correct answer, wrong
 * option count, missing answer guide) is REJECTED with a specific
 * reason, never silently coerced or guessed into something importable.
 * Same shape scripts/ingest-question-bank.mjs already uses for mcq,
 * extended with an explicit "written" variant.
 */
export function validateImportPayload(raw: unknown): { questions: ImportedQuestion[]; errors: string[] } {
  const errors: string[] = [];
  const questions: ImportedQuestion[] = [];
  if (!Array.isArray(raw)) {
    return { questions: [], errors: ["Expected a JSON array of questions."] };
  }
  raw.forEach((q, i) => {
    if (typeof q !== "object" || q === null) {
      errors.push(`Item ${i + 1}: not an object.`);
      return;
    }
    const obj = q as Record<string, unknown>;
    if (typeof obj.prompt !== "string" || !obj.prompt.trim()) {
      errors.push(`Item ${i + 1}: missing prompt.`);
      return;
    }
    const type: "mcq" | "written" = obj.type === "written" ? "written" : "mcq";
    const topic = typeof obj.topic === "string" ? obj.topic : "General";
    const lecture = obj.lecture === "L1" || obj.lecture === "L2" ? obj.lecture : null;

    if (type === "written") {
      const answerGuide = typeof obj.answerGuide === "string" ? obj.answerGuide.trim() : "";
      if (!answerGuide) {
        errors.push(`Item ${i + 1} ("${obj.prompt}"): a written question needs an "answerGuide".`);
        return;
      }
      questions.push({ type, prompt: obj.prompt, topic, lecture, options: [], answerGuide });
      return;
    }

    if (!Array.isArray(obj.options) || obj.options.length < 2) {
      errors.push(`Item ${i + 1}: needs at least 2 options.`);
      return;
    }
    const options = (obj.options as unknown[]).map((o) => {
      const opt = o as Record<string, unknown>;
      return { text: String(opt.text ?? ""), correct: Boolean(opt.correct) };
    });
    if (options.filter((o) => o.correct).length !== 1) {
      errors.push(`Item ${i + 1} ("${obj.prompt}"): must have exactly one correct option.`);
      return;
    }
    if (options.some((o) => !o.text.trim())) {
      errors.push(`Item ${i + 1}: an option is missing text.`);
      return;
    }
    questions.push({ type, prompt: obj.prompt, topic, lecture, options, answerGuide: null });
  });
  return { questions, errors };
}

export async function importQuestions(
  bankId: string,
  visibility: "practice" | "hidden",
  lectureIdByCode: Record<"L1" | "L2", string | null>,
  questions: ImportedQuestion[],
): Promise<number> {
  const supabase = await createClient();
  let inserted = 0;
  for (const q of questions) {
    const { data: question, error } = await supabase
      .from("questions")
      .insert({
        bank_id: bankId,
        prompt: q.prompt,
        topic: q.topic,
        difficulty: "easy",
        question_type: q.type === "written" ? "written" : "single_choice",
        active: true,
        visibility,
        source_lecture_id: q.lecture ? lectureIdByCode[q.lecture] : null,
        answer_guide: q.type === "written" ? q.answerGuide : null,
      })
      .select("id")
      .single();
    if (error || !question) throw new Error(error?.message ?? "Import failed.");

    if (q.type !== "written") {
      const { error: optError } = await supabase
        .from("question_options")
        .insert(q.options.map((o, i) => ({ question_id: question.id, position: i, text: o.text, is_correct: o.correct })));
      if (optError) throw new Error(optError.message);
    }
    inserted++;
  }
  return inserted;
}
