"use server";

import { revalidatePath } from "next/cache";
import {
  createQuestionBank,
  createQuestion,
  setQuestionVisibility,
  setQuestionActive,
  updateQuestionMapping,
  deleteUnusedQuestion,
  validateImportPayload,
  importQuestions,
} from "./question-bank";
import type { QuestionFormState, ImportPreviewState } from "./question-bank-client-types";

export async function createQuestionAction(
  courseId: string,
  _prevState: QuestionFormState,
  formData: FormData,
): Promise<QuestionFormState> {
  try {
    let bankId = String(formData.get("bankId") ?? "");
    const newBankTitle = String(formData.get("newBankTitle") ?? "").trim();
    if (!bankId && newBankTitle) {
      bankId = await createQuestionBank(courseId, newBankTitle);
    }
    if (!bankId) throw new Error("Choose or create a question bank.");

    const questionType = formData.get("questionType") === "written" ? "written" : "single_choice";
    const options = [0, 1, 2, 3]
      .map((i) => ({
        text: String(formData.get(`option${i}`) ?? "").trim(),
        correct: formData.get("correct") === String(i),
      }))
      .filter((o) => o.text.length > 0);

    await createQuestion({
      bankId,
      questionType,
      prompt: String(formData.get("prompt") ?? "").trim(),
      topic: String(formData.get("topic") ?? "General").trim() || "General",
      visibility: formData.get("visibility") === "hidden" ? "hidden" : "practice",
      sourceLectureId: String(formData.get("sourceLectureId") ?? "") || null,
      learningObjectiveId: String(formData.get("learningObjectiveId") ?? "") || null,
      explanation: String(formData.get("explanation") ?? "").trim() || null,
      options: questionType === "single_choice" ? options : [],
      answerGuide: questionType === "written" ? String(formData.get("answerGuide") ?? "").trim() || null : null,
    });

    revalidatePath(`/instructor/courses/${courseId}/question-bank`);
    return { error: null, success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create question.", success: false };
  }
}

export async function toggleQuestionVisibility(courseId: string, questionId: string, next: "practice" | "hidden") {
  await setQuestionVisibility(questionId, next);
  revalidatePath(`/instructor/courses/${courseId}/question-bank`);
}

export async function toggleQuestionActive(courseId: string, questionId: string, active: boolean) {
  await setQuestionActive(questionId, active);
  revalidatePath(`/instructor/courses/${courseId}/question-bank`);
}

export async function updateMappingAction(
  courseId: string,
  questionId: string,
  formData: FormData,
) {
  await updateQuestionMapping(
    questionId,
    String(formData.get("sourceLectureId") ?? "") || null,
    String(formData.get("learningObjectiveId") ?? "") || null,
  );
  revalidatePath(`/instructor/courses/${courseId}/question-bank`);
}

export async function deleteQuestionAction(courseId: string, questionId: string) {
  await deleteUnusedQuestion(questionId);
  revalidatePath(`/instructor/courses/${courseId}/question-bank`);
}

export async function previewImportAction(
  _prevState: ImportPreviewState,
  formData: FormData,
): Promise<ImportPreviewState> {
  const raw = String(formData.get("payload") ?? "");
  try {
    const parsed = JSON.parse(raw);
    const { questions, errors } = validateImportPayload(parsed);
    return { error: null, validationErrors: errors, preview: questions, raw };
  } catch {
    return { error: "That isn't valid JSON.", validationErrors: [], preview: null, raw };
  }
}

export async function commitImportAction(
  courseId: string,
  bankId: string,
  visibility: "practice" | "hidden",
  lecture1Id: string | null,
  lecture2Id: string | null,
  raw: string,
): Promise<{ error: string | null; imported: number }> {
  try {
    const parsed = JSON.parse(raw);
    const { questions, errors } = validateImportPayload(parsed);
    if (errors.length > 0) return { error: errors[0], imported: 0 };
    const imported = await importQuestions(bankId, visibility, { L1: lecture1Id, L2: lecture2Id }, questions);
    revalidatePath(`/instructor/courses/${courseId}/question-bank`);
    return { error: null, imported };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Import failed.", imported: 0 };
  }
}
