import type { ImportedQuestion } from "./question-bank";

export interface QuestionFormState {
  error: string | null;
  success: boolean;
}
export const initialQuestionFormState: QuestionFormState = { error: null, success: false };

export interface ImportPreviewState {
  error: string | null;
  validationErrors: string[];
  preview: ImportedQuestion[] | null;
  raw: string;
}
export const initialImportPreviewState: ImportPreviewState = {
  error: null,
  validationErrors: [],
  preview: null,
  raw: "",
};
