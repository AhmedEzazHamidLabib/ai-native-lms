"use client";

import { useActionState } from "react";
import { updateMyTutorPreferences } from "@/lib/tutor/preferences-actions";
import { initialTutorPreferencesActionState } from "@/lib/tutor/preferences-client-types";
import type { TutorPreferences } from "@/lib/tutor/preferences";

interface Choice {
  value: string;
  label: string;
}

const QUESTIONS: { name: keyof TutorPreferences; question: string; choices: Choice[] }[] = [
  {
    name: "explanationStyle",
    question: "When learning something new, what usually helps you most?",
    choices: [
      { value: "example_first", label: "Show me an example first" },
      { value: "explain_first", label: "Explain the idea first" },
      { value: "guided_discovery", label: "Ask me questions and let me figure it out" },
      { value: "", label: "No strong preference" },
    ],
  },
  {
    name: "correctionStyle",
    question: "When I get something wrong, I prefer:",
    choices: [
      { value: "hint_first", label: "Give me a hint first" },
      { value: "step_by_step", label: "Walk me through it step by step" },
      { value: "tell_and_explain", label: "Tell me the answer and explain why" },
      { value: "", label: "No strong preference" },
    ],
  },
  {
    name: "detailLevel",
    question: "How detailed should Tutor answers usually be?",
    choices: [
      { value: "short", label: "Short" },
      { value: "balanced", label: "Balanced" },
      { value: "detailed", label: "Detailed" },
    ],
  },
  {
    name: "practicePacing",
    question: "When practicing:",
    choices: [
      { value: "one_at_a_time", label: "Give me one problem at a time" },
      { value: "more_explanation", label: "Explain more between questions" },
      { value: "move_quickly", label: "Move quickly when I'm getting things right" },
      { value: "", label: "No strong preference" },
    ],
  },
];

/**
 * Four explicit, practical questions — never an inferred personality
 * or "learning style" label (see 0047_diagnostic_and_tutor_preferences.sql).
 * Short by design: this is preference collection, not a survey.
 */
export function TutorPreferenceForm({ current }: { current: TutorPreferences | null }) {
  const [state, formAction, pending] = useActionState(updateMyTutorPreferences, initialTutorPreferencesActionState);

  return (
    <form action={formAction} className="border border-border rounded-md px-5 py-4 space-y-5">
      <div>
        <p className="text-sm font-medium text-text">Help your Tutor understand how you learn</p>
        <p className="text-xs text-muted mt-1">
          A few quick preferences, not a personality test — you can change these anytime.
        </p>
      </div>

      {QUESTIONS.map((q) => (
        <fieldset key={q.name}>
          <legend className="text-sm text-text mb-2">{q.question}</legend>
          <div className="flex flex-col gap-1.5">
            {q.choices.map((choice) => (
              <label
                key={choice.value || "none"}
                className="flex items-center gap-2 text-sm text-text cursor-pointer"
              >
                <input
                  type="radio"
                  name={q.name}
                  value={choice.value}
                  defaultChecked={(current?.[q.name] ?? "") === choice.value}
                  className="accent-ink"
                />
                {choice.label}
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-md bg-ink text-warm-paper px-4 py-2 text-sm font-medium hover:bg-azure transition-colors duration-[180ms] disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save preferences"}
        </button>
        {state.saved && <span className="text-xs text-success">Saved.</span>}
        {state.error && <span className="text-xs text-danger">{state.error}</span>}
      </div>
    </form>
  );
}
