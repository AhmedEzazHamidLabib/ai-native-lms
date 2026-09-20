"use server";

import { revalidatePath } from "next/cache";
import { createAssessment, type CreateAssessmentRule } from "./assessments";
import type { CreateAssessmentState } from "./assessment-builder-client-types";

export async function createAssessmentAction(
  courseId: string,
  _prevState: CreateAssessmentState,
  formData: FormData,
): Promise<CreateAssessmentState> {
  try {
    const bankId = String(formData.get("bankId") ?? "");
    const title = String(formData.get("title") ?? "").trim();
    const instructions = String(formData.get("instructions") ?? "").trim();
    const kind = formData.get("kind") === "class_test" ? "class_test" : "mock_test";
    const pointsRaw = String(formData.get("pointsPossible") ?? "").trim();
    const pointsPossible = pointsRaw ? Number(pointsRaw) : null;
    const selectionMode = formData.get("selectionMode") === "fixed" ? "fixed" : "random";
    const questionOrderMode = formData.get("questionOrderMode") === "fixed" ? "fixed" : "shuffled";
    const optionOrderMode = formData.get("optionOrderMode") === "fixed" ? "fixed" : "shuffled";

    if (!bankId) throw new Error("Choose a question bank.");
    if (!title) throw new Error("Title is required.");

    const rulesRaw = String(formData.get("rules") ?? "[]");
    const parsed: unknown = JSON.parse(rulesRaw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error(
        selectionMode === "fixed"
          ? "Select at least one question."
          : "Add at least one selection rule.",
      );
    }
    const rules = parsed as CreateAssessmentRule[];

    if (selectionMode === "fixed") {
      if (rules.some((r) => !r.fixedQuestionId)) {
        throw new Error("Every row must be a specific selected question in Fixed mode.");
      }
    } else {
      if (rules.some((r) => !r.count || r.count < 1)) {
        throw new Error("Every rule needs a question count of at least 1.");
      }
    }

    const id = await createAssessment({
      courseId,
      bankId,
      title,
      instructions,
      kind,
      pointsPossible: Number.isFinite(pointsPossible) ? pointsPossible : null,
      selectionMode,
      questionOrderMode,
      optionOrderMode,
      rules,
    });

    revalidatePath(`/instructor/courses/${courseId}/assessments`);
    return { error: null, createdId: id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create assessment.", createdId: null };
  }
}
