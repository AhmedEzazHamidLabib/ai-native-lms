"use server";

import { createClient } from "@/lib/supabase/server";
import {
  findOrCreateTutorSession,
  getSessionMessages,
  runTutorTurn,
  TutorAuthorizationError,
  TutorRateLimitError,
  type TutorEntrySource,
} from "./orchestrator";
import { submitPracticeAnswer as submitPracticeAnswerImpl } from "./practice";
import { TutorProviderError, isTutorProviderConfigured } from "./provider";
import { AiUsageLimitError } from "./governor";
import { getLearningObjectives, getAssessmentEvidence, getPracticeEvidence } from "./evidence";
import { logTutorFailure } from "./log";
import {
  initialTutorActionState,
  initialPracticeAnswerState,
  type TutorActionState,
  type PracticeAnswerState,
} from "./client-types";

export async function startTutorSession(input: {
  courseId: string;
  entrySource: TutorEntrySource;
  learningObjectiveId?: string | null;
  sourceAttemptId?: string | null;
  sourceLectureId?: string | null;
  sourceSlideId?: string | null;
  sourcePracticeAttemptId?: string | null;
}): Promise<{
  sessionId: string | null;
  messages: { role: "user" | "assistant"; content: string; createdAt: string }[];
  error: string | null;
}> {
  if (!isTutorProviderConfigured()) {
    return {
      sessionId: null,
      messages: [],
      error: "The AI Tutor isn't configured yet. Please check back later.",
    };
  }
  const supabase = await createClient();
  try {
    const session = await findOrCreateTutorSession(supabase, input);
    const messages = await getSessionMessages(supabase, session.id);
    return { sessionId: session.id, messages, error: null };
  } catch (err) {
    logTutorFailure("tutor_session_start_failure", { courseId: input.courseId, error: err });
    if (err instanceof TutorAuthorizationError || err instanceof TutorRateLimitError) {
      return { sessionId: null, messages: [], error: err.message };
    }
    return { sessionId: null, messages: [], error: "Could not start a tutor session. Please try again." };
  }
}

export async function sendTutorMessage(
  _prevState: TutorActionState,
  formData: FormData,
): Promise<TutorActionState> {
  const sessionId = String(formData.get("sessionId") ?? "");
  const message = String(formData.get("message") ?? "");

  if (!sessionId) {
    return { ...initialTutorActionState, error: "No active tutor session." };
  }

  const supabase = await createClient();
  try {
    const outcome = await runTutorTurn(supabase, sessionId, message);
    return {
      reply: outcome.reply,
      sources: outcome.sources,
      practiceQuestion: outcome.practiceQuestion,
      error: null,
    };
  } catch (err) {
    if (err instanceof AiUsageLimitError) {
      logTutorFailure("tutor_rate_limited", { sessionId, error: err });
      return { ...initialTutorActionState, error: err.message };
    }
    if (err instanceof TutorRateLimitError) {
      logTutorFailure("tutor_rate_limited", { sessionId, error: err });
      return { ...initialTutorActionState, error: err.message };
    }
    if (err instanceof TutorAuthorizationError) {
      logTutorFailure("tutor_turn_failure", { sessionId, error: err });
      return { ...initialTutorActionState, error: err.message };
    }
    if (err instanceof TutorProviderError) {
      logTutorFailure("tutor_provider_failure", { sessionId, error: err });
      return {
        ...initialTutorActionState,
        error: "The tutor is temporarily unavailable. Please try again in a moment.",
      };
    }
    logTutorFailure("tutor_turn_failure", { sessionId, error: err });
    return { ...initialTutorActionState, error: "Something went wrong. Please try again." };
  }
}

export async function submitPracticeAnswer(
  _prevState: PracticeAnswerState,
  formData: FormData,
): Promise<PracticeAnswerState> {
  const practiceAttemptId = String(formData.get("practiceAttemptId") ?? "");
  const answer = String(formData.get("answer") ?? "");

  if (!practiceAttemptId) {
    return { ...initialPracticeAnswerState, error: "No practice question to answer." };
  }

  const supabase = await createClient();
  try {
    const result = await submitPracticeAnswerImpl(supabase, practiceAttemptId, answer);
    return {
      status: "graded",
      correct: result.correct,
      evaluationReason: result.evaluationReason,
      error: null,
    };
  } catch (err) {
    if (err instanceof AiUsageLimitError) {
      logTutorFailure("practice_evaluation_failure", { error: err });
      return { ...initialPracticeAnswerState, error: err.message };
    }
    if (err instanceof TutorProviderError) {
      logTutorFailure("practice_evaluation_failure", { error: err });
      return { ...initialPracticeAnswerState, error: "Could not evaluate your answer right now." };
    }
    logTutorFailure("practice_save_failure", { error: err });
    const message = err instanceof Error ? err.message : "Could not submit your answer.";
    return { ...initialPracticeAnswerState, error: message };
  }
}

export async function getTutorEntryData(courseId: string) {
  const supabase = await createClient();
  const [objectives, assessmentEvidence, practiceEvidence] = await Promise.all([
    getLearningObjectives(supabase, courseId),
    getAssessmentEvidence(supabase, courseId),
    getPracticeEvidence(supabase, courseId),
  ]);
  return { objectives, assessmentEvidence, practiceEvidence, providerConfigured: isTutorProviderConfigured() };
}
