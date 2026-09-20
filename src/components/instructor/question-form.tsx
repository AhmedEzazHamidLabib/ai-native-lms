"use client";

import { useActionState, useState } from "react";
import { createQuestionAction } from "@/lib/domain/question-bank-actions";
import { initialQuestionFormState } from "@/lib/domain/question-bank-client-types";

export function QuestionForm({
  courseId,
  banks,
  lectures,
  objectives,
}: {
  courseId: string;
  banks: { id: string; title: string }[];
  lectures: { id: string; title: string }[];
  objectives: { id: string; title: string }[];
}) {
  const action = createQuestionAction.bind(null, courseId);
  const [state, formAction, pending] = useActionState(action, initialQuestionFormState);
  const [questionType, setQuestionType] = useState<"single_choice" | "written">("single_choice");

  return (
    <form action={formAction} className="border border-border rounded-md px-5 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium tracking-wide uppercase text-muted">New question</p>
        <div className="flex gap-1 rounded-md bg-black/[0.03] p-0.5">
          {(["single_choice", "written"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setQuestionType(t)}
              className={
                "px-3 py-1 rounded text-xs font-medium transition-colors duration-[180ms] " +
                (questionType === t ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-text")
              }
            >
              {t === "single_choice" ? "MCQ" : "Written Q&A"}
            </button>
          ))}
        </div>
      </div>
      <input type="hidden" name="questionType" value={questionType} />

      <div className="flex flex-col sm:flex-row gap-2">
        <select name="bankId" className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface flex-1">
          <option value="">— choose a bank —</option>
          {banks.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}
            </option>
          ))}
        </select>
        <input
          type="text"
          name="newBankTitle"
          placeholder="or create new bank titled…"
          className="flex-1 border border-border rounded-md px-3 py-1.5 text-sm bg-surface focus-visible:border-azure"
        />
      </div>

      <textarea
        name="prompt"
        required
        placeholder="Question prompt"
        rows={2}
        className="w-full border border-border rounded-md px-3 py-2 text-sm bg-surface focus-visible:border-azure"
      />

      {questionType === "single_choice" ? (
        <div className="space-y-1.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="radio" name="correct" value={String(i)} required={i === 0} className="shrink-0" />
              <input
                type="text"
                name={`option${i}`}
                placeholder={`Option ${i + 1}${i < 2 ? " (required)" : " (optional)"}`}
                required={i < 2}
                className="flex-1 border border-border rounded-md px-3 py-1.5 text-sm bg-surface focus-visible:border-azure"
              />
            </div>
          ))}
          <p className="text-xs text-muted">Select the radio button next to the correct option.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <textarea
            name="answerGuide"
            required
            placeholder="Answer guide — what a correct answer should cover. Used for grading reference, never shown to students as a model answer."
            rows={2}
            className="w-full border border-border rounded-md px-3 py-2 text-sm bg-surface focus-visible:border-azure"
          />
          <p className="text-xs text-muted">
            Written answers are graded manually by an instructor — this is grading guidance, not automated grading.
          </p>
        </div>
      )}

      <textarea
        name="explanation"
        placeholder="Explanation shown to the student after grading (optional)"
        rows={2}
        className="w-full border border-border rounded-md px-3 py-2 text-sm bg-surface focus-visible:border-azure"
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input
          type="text"
          name="topic"
          placeholder="Topic (e.g. Binary)"
          className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface"
        />
        <select name="sourceLectureId" className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface">
          <option value="">No lecture</option>
          {lectures.map((l) => (
            <option key={l.id} value={l.id}>
              {l.title}
            </option>
          ))}
        </select>
        <select name="learningObjectiveId" className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface">
          <option value="">No objective</option>
          {objectives.map((o) => (
            <option key={o.id} value={o.id}>
              {o.title}
            </option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2 text-sm text-text">
        <select name="visibility" defaultValue="hidden" className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface">
          <option value="hidden">Hidden (for graded Class Tests)</option>
          <option value="practice">Practice (students can practice it)</option>
        </select>
      </label>

      {state.error && <p className="text-xs text-danger">{state.error}</p>}
      {state.success && <p className="text-xs text-success">Question created.</p>}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center rounded-md bg-ink text-warm-paper px-4 py-2 text-sm font-medium hover:bg-azure transition-colors duration-[180ms] disabled:opacity-40"
      >
        {pending ? "Saving…" : "Create question"}
      </button>
    </form>
  );
}
