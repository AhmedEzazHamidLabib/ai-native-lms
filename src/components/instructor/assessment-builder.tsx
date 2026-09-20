"use client";

import { useActionState, useMemo, useState } from "react";
import { createAssessmentAction } from "@/lib/domain/assessment-builder-actions";
import { initialCreateAssessmentState } from "@/lib/domain/assessment-builder-client-types";
import { cn } from "@/lib/utils/cn";

interface QuestionOption {
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
}

type RandomRule = {
  key: string;
  sourceLectureId: string;
  topic: string;
  difficulty: string;
  questionType: "" | "single_choice" | "written";
  count: number;
};

export function AssessmentBuilder({
  courseId,
  banks,
  lectures,
  questions,
}: {
  courseId: string;
  banks: { id: string; title: string }[];
  lectures: { id: string; title: string }[];
  questions: QuestionOption[];
}) {
  const action = createAssessmentAction.bind(null, courseId);
  const [state, formAction, pending] = useActionState(action, initialCreateAssessmentState);

  const [bankId, setBankId] = useState(banks[0]?.id ?? "");
  const [kind, setKind] = useState<"mock_test" | "class_test">("mock_test");
  const [selectionMode, setSelectionMode] = useState<"random" | "fixed">("random");
  const [questionOrderMode, setQuestionOrderMode] = useState<"fixed" | "shuffled">("shuffled");
  const [optionOrderMode, setOptionOrderMode] = useState<"fixed" | "shuffled">("shuffled");

  const [randomRules, setRandomRules] = useState<RandomRule[]>([
    { key: crypto.randomUUID(), sourceLectureId: "", topic: "", difficulty: "", questionType: "", count: 5 },
  ]);
  const [fixedIds, setFixedIds] = useState<string[]>([]);
  const [pickerFilter, setPickerFilter] = useState("");

  const bankQuestions = useMemo(
    () => questions.filter((q) => q.bankId === bankId && q.active),
    [questions, bankId],
  );
  const filteredPicker = useMemo(
    () =>
      bankQuestions.filter(
        (q) => !fixedIds.includes(q.id) && q.prompt.toLowerCase().includes(pickerFilter.toLowerCase()),
      ),
    [bankQuestions, fixedIds, pickerFilter],
  );
  const fixedSelected = useMemo(
    () => fixedIds.map((id) => bankQuestions.find((q) => q.id === id)).filter((q): q is QuestionOption => !!q),
    [fixedIds, bankQuestions],
  );
  const practiceLeakCount = fixedSelected.filter((q) => q.visibility === "practice").length;

  const rulesJson = useMemo(() => {
    if (selectionMode === "fixed") {
      return JSON.stringify(
        fixedIds.map((id, i) => ({ position: i + 1, fixedQuestionId: id })),
      );
    }
    return JSON.stringify(
      randomRules.map((r, i) => ({
        position: i + 1,
        sourceLectureId: r.sourceLectureId || null,
        topic: r.topic || null,
        difficulty: r.difficulty || null,
        questionType: r.questionType || null,
        count: r.count,
      })),
    );
  }, [selectionMode, fixedIds, randomRules]);

  function addRandomRule() {
    setRandomRules((rs) => [
      ...rs,
      { key: crypto.randomUUID(), sourceLectureId: "", topic: "", difficulty: "", questionType: "", count: 5 },
    ]);
  }
  function removeRandomRule(key: string) {
    setRandomRules((rs) => rs.filter((r) => r.key !== key));
  }
  function updateRandomRule(key: string, patch: Partial<RandomRule>) {
    setRandomRules((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function moveFixed(index: number, dir: -1 | 1) {
    setFixedIds((ids) => {
      const next = [...ids];
      const target = index + dir;
      if (target < 0 || target >= next.length) return next;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  return (
    <details className="border border-border rounded-md px-5 py-4">
      <summary className="text-xs font-medium tracking-wide uppercase text-muted cursor-pointer">
        New Mock Test / Class Test
      </summary>

      <form action={formAction} className="mt-4 space-y-5">
        <input type="hidden" name="bankId" value={bankId} />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="selectionMode" value={selectionMode} />
        <input type="hidden" name="questionOrderMode" value={questionOrderMode} />
        <input type="hidden" name="optionOrderMode" value={optionOrderMode} />
        <input type="hidden" name="rules" value={rulesJson} />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            type="text"
            name="title"
            required
            placeholder="Title (e.g. Mock Test 1)"
            className="border border-border rounded-md px-3 py-1.5 text-sm bg-surface focus-visible:border-azure"
          />
          <input
            type="number"
            name="pointsPossible"
            placeholder="Points possible (optional)"
            min={0}
            className="border border-border rounded-md px-3 py-1.5 text-sm bg-surface focus-visible:border-azure"
          />
        </div>
        <textarea
          name="instructions"
          rows={2}
          placeholder="Instructions shown to students"
          className="w-full border border-border rounded-md px-3 py-2 text-sm bg-surface focus-visible:border-azure"
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <select value={bankId} onChange={(e) => setBankId(e.target.value)} className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface">
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as "mock_test" | "class_test")}
            className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface"
          >
            <option value="mock_test">Mock Test (ungraded practice run)</option>
            <option value="class_test">Class Test (graded)</option>
          </select>
          <select
            value={selectionMode}
            onChange={(e) => setSelectionMode(e.target.value as "random" | "fixed")}
            className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface"
          >
            <option value="random">Random selection (rules)</option>
            <option value="fixed">Fixed selection (exact questions)</option>
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="flex items-center justify-between gap-2 text-xs text-muted border border-border rounded-md px-3 py-2">
            Question order
            <select
              value={questionOrderMode}
              onChange={(e) => setQuestionOrderMode(e.target.value as "fixed" | "shuffled")}
              className="border border-border rounded-md px-2 py-1 text-xs bg-surface"
            >
              <option value="shuffled">Shuffled per student</option>
              <option value="fixed">Fixed (as ordered here)</option>
            </select>
          </label>
          <label className="flex items-center justify-between gap-2 text-xs text-muted border border-border rounded-md px-3 py-2">
            Answer option order
            <select
              value={optionOrderMode}
              onChange={(e) => setOptionOrderMode(e.target.value as "fixed" | "shuffled")}
              className="border border-border rounded-md px-2 py-1 text-xs bg-surface"
            >
              <option value="shuffled">Shuffled per student</option>
              <option value="fixed">Fixed (author order)</option>
            </select>
          </label>
        </div>

        {selectionMode === "random" ? (
          <div className="space-y-2">
            <p className="text-xs font-medium tracking-wide uppercase text-muted">Selection rules</p>
            {randomRules.map((r) => (
              <div key={r.key} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_1fr_70px_32px] gap-2 items-center">
                <select
                  value={r.sourceLectureId}
                  onChange={(e) => updateRandomRule(r.key, { sourceLectureId: e.target.value })}
                  className="border border-border rounded-md px-2 py-1.5 text-xs bg-surface"
                >
                  <option value="">Any lecture</option>
                  {lectures.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.title}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={r.topic}
                  onChange={(e) => updateRandomRule(r.key, { topic: e.target.value })}
                  placeholder="Any topic"
                  className="border border-border rounded-md px-2 py-1.5 text-xs bg-surface"
                />
                <select
                  value={r.difficulty}
                  onChange={(e) => updateRandomRule(r.key, { difficulty: e.target.value })}
                  className="border border-border rounded-md px-2 py-1.5 text-xs bg-surface"
                >
                  <option value="">Any difficulty</option>
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
                <select
                  value={r.questionType}
                  onChange={(e) => updateRandomRule(r.key, { questionType: e.target.value as RandomRule["questionType"] })}
                  className="border border-border rounded-md px-2 py-1.5 text-xs bg-surface"
                >
                  <option value="">MCQ + Written</option>
                  <option value="single_choice">MCQ only</option>
                  <option value="written">Written only</option>
                </select>
                <input
                  type="number"
                  min={1}
                  value={r.count}
                  onChange={(e) => updateRandomRule(r.key, { count: Number(e.target.value) || 1 })}
                  className="border border-border rounded-md px-2 py-1.5 text-xs bg-surface"
                />
                <button
                  type="button"
                  onClick={() => removeRandomRule(r.key)}
                  disabled={randomRules.length === 1}
                  className="text-xs text-danger disabled:opacity-30"
                >
                  ✕
                </button>
              </div>
            ))}
            <button type="button" onClick={addRandomRule} className="text-xs text-azure hover:underline">
              + Add rule
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs font-medium tracking-wide uppercase text-muted">
              Pick exact questions ({fixedSelected.length} selected)
            </p>

            {kind === "class_test" && practiceLeakCount > 0 && (
              <p className="text-xs text-danger border border-danger/40 bg-danger-soft rounded-md px-3 py-2">
                {practiceLeakCount} selected question{practiceLeakCount === 1 ? " is" : "s are"} still
                Practice-visible. A Class Test cannot use them — switch them to Hidden in the Question Bank
                first, or remove them below. Saving will be blocked until this is resolved.
              </p>
            )}

            {fixedSelected.length > 0 && (
              <ol className="space-y-1.5 border border-border rounded-md p-2">
                {fixedSelected.map((q, i) => (
                  <li key={q.id} className="flex items-center gap-2 text-xs">
                    <span className="text-muted w-5 shrink-0">{i + 1}.</span>
                    <span className="shrink-0 text-[10px] font-medium uppercase px-1.5 py-0.5 rounded bg-black/[0.05] text-muted">
                      {q.questionType === "written" ? "Written" : "MCQ"}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-[10px] font-medium uppercase px-1.5 py-0.5 rounded",
                        q.visibility === "hidden" ? "bg-danger-soft text-danger" : "bg-success-soft text-success",
                      )}
                    >
                      {q.visibility}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-text">{q.prompt}</span>
                    <button type="button" onClick={() => moveFixed(i, -1)} disabled={i === 0} className="text-muted disabled:opacity-20">
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveFixed(i, 1)}
                      disabled={i === fixedSelected.length - 1}
                      className="text-muted disabled:opacity-20"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => setFixedIds((ids) => ids.filter((id) => id !== q.id))}
                      className="text-danger"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ol>
            )}

            <input
              type="text"
              value={pickerFilter}
              onChange={(e) => setPickerFilter(e.target.value)}
              placeholder="Search questions to add…"
              className="w-full border border-border rounded-md px-3 py-1.5 text-xs bg-surface"
            />
            <ul className="max-h-56 overflow-y-auto divide-y divide-border border border-border rounded-md">
              {filteredPicker.map((q) => (
                <li key={q.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                  <span className="shrink-0 text-[10px] font-medium uppercase px-1.5 py-0.5 rounded bg-black/[0.05] text-muted">
                    {q.questionType === "written" ? "Written" : "MCQ"}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-[10px] font-medium uppercase px-1.5 py-0.5 rounded",
                      q.visibility === "hidden" ? "bg-danger-soft text-danger" : "bg-success-soft text-success",
                    )}
                  >
                    {q.visibility}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-text">{q.prompt}</span>
                  <button
                    type="button"
                    onClick={() => setFixedIds((ids) => [...ids, q.id])}
                    className="text-azure shrink-0"
                  >
                    + Add
                  </button>
                </li>
              ))}
              {filteredPicker.length === 0 && (
                <li className="px-3 py-2 text-xs text-muted">No matching questions in this bank.</li>
              )}
            </ul>
          </div>
        )}

        {state.error && <p className="text-xs text-danger">{state.error}</p>}
        {state.createdId && <p className="text-xs text-success">Assessment created — draft, unpublished.</p>}

        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-md bg-ink text-warm-paper px-4 py-2 text-sm font-medium hover:bg-azure transition-colors duration-[180ms] disabled:opacity-40"
        >
          {pending ? "Creating…" : "Create assessment"}
        </button>
      </form>
    </details>
  );
}
