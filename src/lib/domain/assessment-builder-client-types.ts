export interface CreateAssessmentState {
  error: string | null;
  createdId: string | null;
}

export const initialCreateAssessmentState: CreateAssessmentState = {
  error: null,
  createdId: null,
};
