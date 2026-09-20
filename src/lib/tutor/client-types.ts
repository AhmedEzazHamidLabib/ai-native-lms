/**
 * Shared types/constants for tutor Server Actions. Kept out of
 * actions.ts because a "use server" file may only export async
 * functions — no plain objects or constants.
 */

export interface TutorActionState {
  reply: string | null;
  sources: string[];
  practiceQuestion: { id: string; prompt: string; expectedAnswerKind: string } | null;
  error: string | null;
}

export const initialTutorActionState: TutorActionState = {
  reply: null,
  sources: [],
  practiceQuestion: null,
  error: null,
};

export interface PracticeAnswerState {
  status: "idle" | "graded";
  correct: boolean | null;
  evaluationReason: string | null;
  error: string | null;
}

export const initialPracticeAnswerState: PracticeAnswerState = {
  status: "idle",
  correct: null,
  evaluationReason: null,
  error: null,
};
