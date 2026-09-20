import "server-only";

/**
 * Lightweight operational visibility (docs/AI_TUTOR_ARCHITECTURE.md,
 * and the classroom enrollment incident this project already lived
 * through — failures must never be silently swallowed into a generic
 * friendly message with no server-side trace). Plain console.error,
 * visible in `vercel logs` — no new logging platform.
 *
 * Never logs: message/reply text, answers, secrets. Only category +
 * ids + the error's own message, enough to triage without exposing
 * student conversation content.
 */

export type TutorFailureCategory =
  | "tutor_session_start_failure"
  | "tutor_turn_failure"
  | "tutor_retrieval_failure"
  | "tutor_provider_failure"
  | "tutor_rate_limited"
  | "practice_save_failure"
  | "practice_evaluation_failure";

export function logTutorFailure(
  category: TutorFailureCategory,
  detail: { courseId?: string; sessionId?: string; userId?: string; error: unknown },
) {
  const message = detail.error instanceof Error ? detail.error.message : String(detail.error);
  console.error(
    `[tutor] ${category}`,
    JSON.stringify({
      courseId: detail.courseId,
      sessionId: detail.sessionId,
      userId: detail.userId,
      message,
    }),
  );
}

/**
 * Latency instrumentation (Part 12) — stage durations only, never
 * exposed to the client/student. Measure-before-guessing: this is what
 * the streaming decision is based on, not a permanent product feature.
 * `console.log`, visible in `vercel logs`, same posture as failures above.
 */
export interface TutorTurnTiming {
  sessionId: string;
  entrySource: string;
  quotaMs: number;
  contextMs: number;
  providerMs: number;
  persistenceMs: number;
  totalMs: number;
}

export function logTutorLatency(timing: TutorTurnTiming) {
  console.log(`[tutor_latency]`, JSON.stringify(timing));
}
