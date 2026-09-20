import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAssessmentEvidence, getPracticeEvidence } from "@/lib/tutor/evidence";
import { getMyTutorPreferencesServer } from "@/lib/tutor/preferences";
import { TutorPreferenceForm } from "@/components/tutor/tutor-preference-form";

/**
 * Shown only on a submitted Learning Diagnostic attempt, ABOVE the
 * normal <AttemptResults /> (which is left untouched — every other
 * assessment kind must render exactly as before). Strongest/weakest
 * areas come from the same evidence RPCs Learn with AI uses — the
 * Diagnostic's own submitted attempt already counts toward that
 * evidence automatically (get_student_objective_evidence aggregates
 * over any submitted attempt in the course, regardless of kind).
 */
export async function DiagnosticSummary({
  courseId,
  score,
  maxScore,
}: {
  courseId: string;
  score: number | null;
  maxScore: number | null;
}) {
  const supabase = await createClient();
  const [assessmentEvidence, practiceEvidence, preferences] = await Promise.all([
    getAssessmentEvidence(supabase, courseId),
    getPracticeEvidence(supabase, courseId),
    getMyTutorPreferencesServer(),
  ]);

  const combined = new Map<string, { title: string; correct: number; attempted: number }>();
  for (const e of assessmentEvidence) {
    combined.set(e.learningObjectiveId, { title: e.title, correct: e.correct, attempted: e.attempted });
  }
  for (const e of practiceEvidence) {
    const existing = combined.get(e.learningObjectiveId);
    if (existing) {
      existing.correct += e.correct;
      existing.attempted += e.attempted;
    } else {
      combined.set(e.learningObjectiveId, { title: e.title, correct: e.correct, attempted: e.attempted });
    }
  }

  const ranked = [...combined.entries()]
    .map(([id, v]) => ({ id, title: v.title, ratio: v.attempted > 0 ? v.correct / v.attempted : 0, attempted: v.attempted }))
    .filter((v) => v.attempted > 0)
    .sort((a, b) => b.ratio - a.ratio);

  const strongest = ranked.filter((r) => r.ratio >= 0.7).slice(0, 3);
  const worthReviewing = [...ranked].reverse().filter((r) => r.ratio < 0.7).slice(0, 3);
  const weakestId = worthReviewing[0]?.id ?? ranked[ranked.length - 1]?.id ?? null;

  return (
    <div className="max-w-xl mb-8 space-y-6">
      <div className="border border-border rounded-md px-6 py-5">
        <p className="font-display text-xl text-ink mb-1">Practice Test Complete</p>
        <p className="font-display text-3xl text-ink mb-3">
          {score ?? "—"} <span className="text-muted text-xl">/ {maxScore ?? "—"}</span>
        </p>

        {strongest.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-medium tracking-wide uppercase text-muted mb-1">Strongest areas</p>
            <p className="text-sm text-text">{strongest.map((s) => s.title).join(", ")}</p>
          </div>
        )}
        {worthReviewing.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-medium tracking-wide uppercase text-muted mb-1">Worth reviewing</p>
            <p className="text-sm text-text">{worthReviewing.map((s) => s.title).join(", ")}</p>
          </div>
        )}
        {weakestId && (
          <Link
            href={`/student/courses/${courseId}/tutor?entry=performance&objective=${weakestId}`}
            className="inline-flex items-center justify-center rounded-md bg-ink text-warm-paper px-4 py-2 text-sm font-medium hover:bg-azure transition-colors duration-[180ms] mt-2"
          >
            Review with AI
          </Link>
        )}
        <p className="text-xs text-muted mt-4">Practice only — this does not affect your grade.</p>
      </div>

      <TutorPreferenceForm current={preferences} />
    </div>
  );
}
