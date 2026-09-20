"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getPracticeQuestion,
  submitPracticeQuestionAnswer,
  type PracticeQuestionDetail,
} from "@/lib/practice/actions";
import { cn } from "@/lib/utils/cn";
import { optionFeedbackClass, OptionBadge, ResultBanner } from "@/components/ui/answer-feedback";

export function PracticeSession({ courseId, questionIds }: { courseId: string; questionIds: string[] }) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [detail, setDetail] = useState<PracticeQuestionDetail | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<{ practiceAttemptId: string; correct: boolean; correctAnswerText: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const questionId = questionIds[index];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSelected(null);
    setResult(null);
    setError(null);
    getPracticeQuestion(questionId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load this question.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [questionId]);

  async function submit() {
    if (!selected) return;
    setLoading(true);
    try {
      const outcome = await submitPracticeQuestionAnswer(questionId, selected);
      setResult(outcome);
    } catch {
      setError("Could not submit your answer.");
    } finally {
      setLoading(false);
    }
  }

  function next() {
    if (index + 1 < questionIds.length) {
      setIndex(index + 1);
    } else {
      router.push(`/student/courses/${courseId}/practice`);
    }
  }

  function askAiToExplain() {
    if (!result) return;
    router.push(
      `/student/courses/${courseId}/tutor?practiceAttempt=${result.practiceAttemptId}&entry=question_bank_practice`,
    );
  }

  return (
    <div className="max-w-xl">
      <p className="text-xs text-muted mb-3">
        Question {index + 1} of {questionIds.length}
      </p>

      {loading && !detail && <p className="text-sm text-muted">Loading…</p>}
      {error && <p className="text-sm text-danger">{error}</p>}

      {detail && (
        <div className="border border-border rounded-md px-5 py-4">
          <p className="text-sm font-medium text-text mb-4">{detail.prompt}</p>
          <ul className="space-y-2 mb-4">
            {detail.options.map((o) => {
              const isSelected = selected === o.optionId;
              const isCorrectOption = result ? result.correctAnswerText === o.text : false;
              return (
                <li key={o.optionId}>
                  <button
                    type="button"
                    disabled={Boolean(result)}
                    onClick={() => setSelected(o.optionId)}
                    className={cn(
                      "w-full text-left text-sm px-3 py-2 rounded-md border transition-colors duration-[180ms] flex items-center flex-wrap",
                      optionFeedbackClass({ isCorrectOption, isSelected, isRevealed: Boolean(result) }),
                    )}
                  >
                    <span>{o.text}</span>
                    <OptionBadge isCorrectOption={isCorrectOption} isSelected={isSelected} isRevealed={Boolean(result)} />
                  </button>
                </li>
              );
            })}
          </ul>

          {!result ? (
            <button
              type="button"
              onClick={submit}
              disabled={!selected || loading}
              className="inline-flex items-center justify-center rounded-md bg-ink text-warm-paper px-4 py-2 text-sm font-medium hover:bg-azure transition-colors duration-[180ms] disabled:opacity-40 w-full sm:w-auto"
            >
              Check answer
            </button>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <ResultBanner correct={result.correct} />
              <div className="flex gap-2 sm:ml-auto">
                <button
                  type="button"
                  onClick={askAiToExplain}
                  className="inline-flex items-center justify-center rounded-md border border-azure text-azure px-3 py-1.5 text-xs font-medium hover:bg-azure hover:text-warm-paper transition-colors duration-[180ms]"
                >
                  Ask AI to Explain
                </button>
                <button
                  type="button"
                  onClick={next}
                  className="inline-flex items-center justify-center rounded-md bg-ink text-warm-paper px-3 py-1.5 text-xs font-medium hover:bg-azure transition-colors duration-[180ms]"
                >
                  {index + 1 < questionIds.length ? "Next" : "Finish"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
