import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getTutorProvider, TutorProviderError } from "./provider";
import { searchCourseMaterial, formatRetrievedMaterial, citationsFor } from "./retrieval";
import { getAssessmentEvidence, getPracticeEvidence, formatEvidenceSummary } from "./evidence";
import { getIntelligenceForObjective, findBestMatchingObjective, formatCourseIntelligence } from "./intelligence";
import {
  buildTutorBasePolicy,
  ASSESSMENT_REVIEW_ADDENDUM,
  GENERAL_TUTORING_NOTE,
  SLIDE_CONTEXT_NOTE,
  QUESTION_EXPLAIN_NOTE,
} from "./policy";
import { logTutorFailure, logTutorLatency } from "./log";
import { reserveGeneration, completeGeneration, type AiEntryContext } from "./governor";
import { getActiveMisconception, recordMisconception } from "./learning-profile";
import { formatTutorPreferenceSummary, type TutorPreferences } from "./preferences";

/**
 * The only module that assembles a tutor turn end to end
 * (docs/COURSEWORK_LEARNING_ARCHITECTURE.md "CONTEXT ROUTING").
 * Authorization happens here, before anything reaches the model —
 * identity and course membership are re-derived from the authenticated
 * Supabase client on every call, never accepted as trusted client
 * input. Context is assembled DIFFERENTLY per entry point — this is
 * deliberately not one shared "send everything" path.
 */

export type TutorEntrySource = "direct" | "performance" | "assessment_review" | "slide" | "question_bank_practice";

const HISTORY_LIMIT = 6; // small recent-message window, not the full transcript
const RATE_LIMIT_WINDOW_MINUTES = 5;
const RATE_LIMIT_MAX_MESSAGES = 15;
const SESSION_CREATION_WINDOW_HOURS = 24;
const SESSION_CREATION_MAX = 30;

export class TutorAuthorizationError extends Error {}
export class TutorRateLimitError extends Error {}

export interface TutorSessionInfo {
  id: string;
  courseId: string;
  learningObjectiveId: string | null;
  entrySource: TutorEntrySource;
  sourceAttemptId: string | null;
  sourceLectureId: string | null;
  sourceSlideId: string | null;
  sourcePracticeAttemptId: string | null;
}

export interface CreateSessionInput {
  courseId: string;
  entrySource: TutorEntrySource;
  learningObjectiveId?: string | null;
  sourceAttemptId?: string | null;
  sourceLectureId?: string | null;
  sourceSlideId?: string | null;
  sourcePracticeAttemptId?: string | null;
}

const SESSION_COLUMNS =
  "id, course_id, learning_objective_id, entry_source, source_attempt_id, source_lecture_id, source_slide_id, source_practice_attempt_id";

function rowToSession(data: {
  id: string;
  course_id: string;
  learning_objective_id: string | null;
  entry_source: TutorEntrySource;
  source_attempt_id: string | null;
  source_lecture_id: string | null;
  source_slide_id: string | null;
  source_practice_attempt_id: string | null;
}): TutorSessionInfo {
  return {
    id: data.id,
    courseId: data.course_id,
    learningObjectiveId: data.learning_objective_id,
    entrySource: data.entry_source,
    sourceAttemptId: data.source_attempt_id,
    sourceLectureId: data.source_lecture_id,
    sourceSlideId: data.source_slide_id,
    sourcePracticeAttemptId: data.source_practice_attempt_id,
  };
}

async function verifyEntryPreconditions(
  supabase: SupabaseClient<Database>,
  input: CreateSessionInput,
): Promise<void> {
  if (input.entrySource === "assessment_review") {
    if (!input.sourceAttemptId) {
      throw new TutorAuthorizationError("Assessment review requires an attempt.");
    }
    const { data: attempt, error } = await supabase
      .from("attempts")
      .select("id, submitted_at")
      .eq("id", input.sourceAttemptId)
      .maybeSingle();
    if (error || !attempt || !attempt.submitted_at) {
      throw new TutorAuthorizationError(
        "This assessment hasn't been submitted yet, so it can't be reviewed with the tutor.",
      );
    }
  }

  if (input.entrySource === "slide") {
    if (!input.sourceLectureId || !input.sourceSlideId) {
      throw new TutorAuthorizationError("Slide context requires a lecture and slide.");
    }
    // RLS already restricts this select to published slides the
    // caller's course role can see — a draft/unpublished slide or a
    // slide from a course the caller doesn't belong to simply won't
    // be found, which is the correct "not authorized" signal.
    const { data: slide, error } = await supabase
      .from("slides")
      .select("id")
      .eq("id", input.sourceSlideId)
      .maybeSingle();
    if (error || !slide) {
      throw new TutorAuthorizationError("That slide isn't available.");
    }
  }

  if (input.entrySource === "question_bank_practice") {
    if (!input.sourcePracticeAttemptId) {
      throw new TutorAuthorizationError("Explain requires an answered practice question.");
    }
    const { error } = await supabase.rpc("get_practice_attempt_for_tutor", {
      p_practice_attempt_id: input.sourcePracticeAttemptId,
    });
    if (error) {
      throw new TutorAuthorizationError("That practice question isn't available to explain.");
    }
  }
}

export async function createTutorSession(
  supabase: SupabaseClient<Database>,
  input: CreateSessionInput,
): Promise<TutorSessionInfo> {
  await verifyEntryPreconditions(supabase, input);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new TutorAuthorizationError("Not signed in.");
  }

  const windowStart = new Date(Date.now() - SESSION_CREATION_WINDOW_HOURS * 3_600_000).toISOString();
  const { count } = await supabase
    .from("tutor_sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", windowStart);
  if ((count ?? 0) >= SESSION_CREATION_MAX) {
    throw new TutorRateLimitError(
      "You've started a lot of tutor sessions today — try continuing an existing one, or check back tomorrow.",
    );
  }

  const { data, error } = await supabase
    .from("tutor_sessions")
    .insert({
      user_id: user.id,
      course_id: input.courseId,
      entry_source: input.entrySource,
      learning_objective_id: input.learningObjectiveId ?? null,
      source_attempt_id: input.sourceAttemptId ?? null,
      source_lecture_id: input.sourceLectureId ?? null,
      source_slide_id: input.sourceSlideId ?? null,
      source_practice_attempt_id: input.sourcePracticeAttemptId ?? null,
    } as Database["public"]["Tables"]["tutor_sessions"]["Insert"])
    .select(SESSION_COLUMNS)
    .single();

  if (error || !data) {
    throw new TutorAuthorizationError(error?.message ?? "Could not start a tutor session.");
  }

  return rowToSession(data);
}

/**
 * Continuity: reuse the most recent matching session instead of always
 * starting fresh. "slide" and "question_bank_practice" sessions are
 * scoped tightly enough (one exact slide / one exact practice attempt)
 * that reuse naturally means "the student re-opened the same thing."
 */
export async function findOrCreateTutorSession(
  supabase: SupabaseClient<Database>,
  input: CreateSessionInput,
): Promise<TutorSessionInfo> {
  let query = supabase
    .from("tutor_sessions")
    .select(SESSION_COLUMNS)
    .eq("course_id", input.courseId)
    .eq("entry_source", input.entrySource)
    .order("last_message_at", { ascending: false })
    .limit(1);

  if (input.learningObjectiveId) query = query.eq("learning_objective_id", input.learningObjectiveId);
  if (input.sourceAttemptId) query = query.eq("source_attempt_id", input.sourceAttemptId);
  if (input.sourceSlideId) query = query.eq("source_slide_id", input.sourceSlideId);
  if (input.sourcePracticeAttemptId) {
    query = query.eq("source_practice_attempt_id", input.sourcePracticeAttemptId);
  }

  const { data } = await query.maybeSingle();
  if (data) return rowToSession(data);

  return createTutorSession(supabase, input);
}

export async function getSessionMessages(
  supabase: SupabaseClient<Database>,
  sessionId: string,
): Promise<{ role: "user" | "assistant"; content: string; createdAt: string }[]> {
  const { data } = await supabase
    .from("tutor_messages")
    .select("role, content, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(100);
  return (data ?? []).map((m) => ({ role: m.role, content: m.content, createdAt: m.created_at }));
}

async function loadSession(
  supabase: SupabaseClient<Database>,
  sessionId: string,
): Promise<TutorSessionInfo> {
  // RLS scopes this to the caller's own sessions already — a session
  // that exists but belongs to someone else comes back as "not found,"
  // not "forbidden," which is the correct signal to the caller either way.
  const { data, error } = await supabase
    .from("tutor_sessions")
    .select(SESSION_COLUMNS)
    .eq("id", sessionId)
    .maybeSingle();

  if (error || !data) {
    throw new TutorAuthorizationError("Tutor session not found.");
  }
  return rowToSession(data);
}

async function formatMistakesContext(
  supabase: SupabaseClient<Database>,
  attemptId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("get_attempt_mistakes", { p_attempt_id: attemptId });
  if (error || !data || data.length === 0) return "";
  return (
    "STUDENT'S MISTAKES ON THIS SUBMITTED ASSESSMENT (data):\n" +
    data
      .map(
        (m, i) =>
          `${i + 1}. [${m.learning_objective_title ?? "General"}] Q: ${m.question_prompt}\n   Student answered: ${m.student_answer_text}\n   Correct answer: ${m.correct_answer_text}`,
      )
      .join("\n")
  );
}

/**
 * Builds the (courseIntelligence, retrievedMaterial, extraEvidence)
 * triple for ONE turn, branching on entrySource — the actual "context
 * routing" (architecture doc). Raw retrieval is only ever touched when
 * intelligence doesn't cover the situation.
 */
async function buildContext(
  supabase: SupabaseClient<Database>,
  session: TutorSessionInfo,
  studentMessage: string,
): Promise<{ courseIntelligence: string; retrievedMaterial: string; extraEvidence: string; sources: string[] }> {
  switch (session.entrySource) {
    case "slide": {
      // Exactly one slide's structured text — never the whole lecture.
      const { data: slide } = await supabase
        .from("slides")
        .select("index, title, text, speaker_notes")
        .eq("id", session.sourceSlideId!)
        .maybeSingle();
      const slideText = slide
        ? [slide.title, slide.text, slide.speaker_notes].filter(Boolean).join("\n\n")
        : "";

      let intelligenceText = "";
      let sources: string[] = [];
      if (session.learningObjectiveId) {
        const intel = await getIntelligenceForObjective(supabase, session.learningObjectiveId);
        intelligenceText = formatCourseIntelligence(intel);
      }
      if (slide) sources = [`Slide ${slide.index}${slide.title ? ` · ${slide.title}` : ""}`];

      return {
        courseIntelligence: intelligenceText,
        retrievedMaterial: slideText ? `[Current slide]\n${slideText}` : "",
        extraEvidence: "",
        sources,
      };
    }

    case "question_bank_practice": {
      const { data, error } = await supabase.rpc("get_practice_attempt_for_tutor", {
        p_practice_attempt_id: session.sourcePracticeAttemptId!,
      });
      if (error || !data) {
        throw new TutorAuthorizationError("That practice question isn't available to explain.");
      }
      const intel = await getIntelligenceForObjective(supabase, data.learningObjectiveId);
      const extraEvidence = [
        `Question: ${data.prompt}`,
        `Student answered: ${data.studentAnswer}`,
        `Correct answer: ${data.correctAnswer}`,
        `Was correct: ${data.wasCorrect ? "yes" : "no"}`,
      ].join("\n");
      return {
        courseIntelligence: formatCourseIntelligence(intel),
        retrievedMaterial: "",
        extraEvidence,
        sources: [],
      };
    }

    case "performance":
    case "assessment_review": {
      let intelligenceText = "";
      if (session.learningObjectiveId) {
        const intel = await getIntelligenceForObjective(supabase, session.learningObjectiveId);
        intelligenceText = formatCourseIntelligence(intel);
      }
      let extraEvidence = "";
      if (session.entrySource === "assessment_review" && session.sourceAttemptId) {
        extraEvidence = await formatMistakesContext(supabase, session.sourceAttemptId);
      }
      // Only fall back to raw retrieval if there's no precomputed
      // intelligence for this objective at all.
      let retrievedMaterial = "";
      let sources: string[] = [];
      if (!intelligenceText) {
        const chunks = await safeRetrieve(supabase, session.courseId, studentMessage, session.learningObjectiveId);
        retrievedMaterial = formatRetrievedMaterial(chunks);
        sources = citationsFor(chunks);
      }
      return { courseIntelligence: intelligenceText, retrievedMaterial, extraEvidence, sources };
    }

    case "direct":
    default: {
      // Try to match a precomputed objective first; only touch raw
      // retrieval when nothing matches well.
      const intel = session.learningObjectiveId
        ? await getIntelligenceForObjective(supabase, session.learningObjectiveId)
        : await findBestMatchingObjective(supabase, session.courseId, studentMessage);
      const intelligenceText = formatCourseIntelligence(intel);

      let retrievedMaterial = "";
      let sources: string[] = [];
      if (!intelligenceText) {
        const chunks = await safeRetrieve(supabase, session.courseId, studentMessage, null);
        retrievedMaterial = formatRetrievedMaterial(chunks);
        sources = citationsFor(chunks);
      }
      return { courseIntelligence: intelligenceText, retrievedMaterial, extraEvidence: "", sources };
    }
  }
}

async function safeRetrieve(
  supabase: SupabaseClient<Database>,
  courseId: string,
  query: string,
  learningObjectiveId: string | null,
) {
  try {
    return await searchCourseMaterial(supabase, courseId, query, { learningObjectiveId, limit: 4 });
  } catch (err) {
    logTutorFailure("tutor_retrieval_failure", { courseId, error: err });
    return [];
  }
}

export interface TutorTurnOutcome {
  reply: string;
  sources: string[];
  practiceQuestion: { id: string; prompt: string; expectedAnswerKind: string } | null;
}

export async function runTutorTurn(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  studentMessage: string,
): Promise<TutorTurnOutcome> {
  const tStart = performance.now();
  const trimmed = studentMessage.trim();
  if (!trimmed) throw new TutorAuthorizationError("Message cannot be empty.");
  if (trimmed.length > 2000) throw new TutorAuthorizationError("Message is too long.");

  const session = await loadSession(supabase, sessionId);

  // Re-check on EVERY turn, not just at creation — an attempt
  // reset/unsubmitted mid-session must revoke access immediately.
  if (session.entrySource === "assessment_review") {
    if (!session.sourceAttemptId) throw new TutorAuthorizationError("This session has no associated assessment.");
    const { data: attempt, error } = await supabase
      .from("attempts")
      .select("id, submitted_at")
      .eq("id", session.sourceAttemptId)
      .maybeSingle();
    if (error || !attempt || !attempt.submitted_at) {
      throw new TutorAuthorizationError("This assessment is no longer available for review.");
    }
  }

  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60_000).toISOString();
  const { count } = await supabase
    .from("tutor_messages")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .eq("role", "user")
    .gte("created_at", windowStart);
  if ((count ?? 0) >= RATE_LIMIT_MAX_MESSAGES) {
    throw new TutorRateLimitError("You're sending messages quickly — take a short break and try again in a few minutes.");
  }

  // AI Usage Governor — the ONLY gate before a provider call. Reserved
  // BEFORE any context building/model work; if this throws, zero
  // Anthropic call has occurred (or ever will, for this turn).
  const entryContext = entrySourceToAiContext(session.entrySource);
  const reservation = await reserveGeneration(supabase, session.courseId, entryContext);
  const tAfterQuota = performance.now();

  // All of these are independent reads — none depends on another's
  // result — so they run concurrently instead of one round trip at a
  // time. This was the single biggest win from latency measurement:
  // context-building was taking as long as the model call itself,
  // almost entirely from avoidable sequential DB round trips.
  const [
    { courseIntelligence, retrievedMaterial, extraEvidence, sources },
    [assessmentEvidence, practiceEvidence],
    activeMisconception,
    { fullName, preferences },
    { data: historyRows },
    { data: course },
  ] = await Promise.all([
    buildContext(supabase, session, trimmed),
    Promise.all([getAssessmentEvidence(supabase, session.courseId), getPracticeEvidence(supabase, session.courseId)]),
    session.learningObjectiveId ? getActiveMisconception(supabase, session.learningObjectiveId) : Promise.resolve(null),
    // Must filter to the caller's own row: an instructor's profiles RLS
    // visibility also includes every student's profile in their courses
    // (0019_profiles.sql), so an unfiltered select can return multiple
    // rows and .maybeSingle() would error. Not currently reachable here
    // (the AI Tutor is student-only) but kept consistent with the same
    // fix in getMyFullName() (src/lib/supabase/course.ts).
    (async (): Promise<{ fullName: string | null; preferences: TutorPreferences | null }> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { fullName: null, preferences: null };
      const [{ data: profile }, { data: prefRow }] = await Promise.all([
        supabase.from("profiles").select("full_name").eq("user_id", user.id).maybeSingle(),
        supabase
          .from("tutor_preferences")
          .select("explanation_style, correction_style, detail_level, practice_pacing")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);
      return {
        fullName: profile?.full_name ?? null,
        preferences: prefRow
          ? {
              explanationStyle: prefRow.explanation_style,
              correctionStyle: prefRow.correction_style,
              detailLevel: prefRow.detail_level,
              practicePacing: prefRow.practice_pacing,
            }
          : null,
      };
    })(),
    supabase
      .from("tutor_messages")
      .select("role, content")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT),
    supabase.from("courses").select("code, title").eq("id", session.courseId).maybeSingle(),
  ]);

  const objectiveTitle = assessmentEvidence.find((e) => e.learningObjectiveId === session.learningObjectiveId)?.title;
  let evidenceSummary = formatEvidenceSummary(objectiveTitle ?? null, assessmentEvidence, practiceEvidence);
  if (extraEvidence) evidenceSummary = `${evidenceSummary}\n\n${extraEvidence}`.trim();
  // Bounded, evidence-based personalization (Part 8) — a small
  // structured summary, never the student's full history.
  if (activeMisconception) {
    evidenceSummary = `${evidenceSummary}\n\nKnown recent misconception: ${activeMisconception.description}`.trim();
  }
  // Explicit Tutor preferences, never inferred (see preferences.ts) —
  // a plain sentence, not the raw enum values.
  const preferenceSummary = formatTutorPreferenceSummary(preferences);
  if (preferenceSummary) {
    evidenceSummary = `${evidenceSummary}\n\n${preferenceSummary}`.trim();
  }

  const history = (historyRows ?? []).reverse().map((m) => ({ role: m.role, content: m.content }));

  const addendum =
    session.entrySource === "assessment_review"
      ? ASSESSMENT_REVIEW_ADDENDUM
      : session.entrySource === "slide"
        ? SLIDE_CONTEXT_NOTE
        : session.entrySource === "question_bank_practice"
          ? QUESTION_EXPLAIN_NOTE
          : GENERAL_TUTORING_NOTE;

  const systemPolicy = buildTutorBasePolicy(course?.code ?? "this course", course?.title ?? "") + "\n" + addendum;
  const tAfterContext = performance.now();

  let result;
  try {
    result = await getTutorProvider().generateTurn({
      systemPolicy,
      courseIntelligence,
      retrievedMaterial,
      evidenceSummary,
      history,
      studentMessage: trimmed,
      studentName: fullName,
    });
  } catch (err) {
    await completeGeneration(supabase, reservation.eventId, { status: "failed" });
    if (err instanceof TutorProviderError) throw err;
    throw new TutorProviderError("Tutor turn failed unexpectedly.", err);
  }
  const tAfterProvider = performance.now();
  await completeGeneration(supabase, reservation.eventId, {
    status: "success",
    model: "claude-haiku-4-5-20251001",
    usage: result.usage,
  });

  await Promise.all([
    supabase.from("tutor_messages").insert([
      { session_id: sessionId, role: "user", content: trimmed },
      { session_id: sessionId, role: "assistant", content: result.reply, teaching_move: result.teachingMove },
    ] as Database["public"]["Tables"]["tutor_messages"]["Insert"][]),
    supabase.from("tutor_sessions").update({ last_message_at: new Date().toISOString() }).eq("id", sessionId),
  ]);

  let persistedPractice: { id: string; prompt: string; expectedAnswerKind: string } | null = null;
  if (result.practiceQuestion) {
    const objectiveId = session.learningObjectiveId ?? (await resolveObjectiveFallback(supabase, session));
    if (objectiveId) {
      const { data: created, error } = await supabase.rpc("create_practice_attempt", {
        p_course_id: session.courseId,
        p_learning_objective_id: objectiveId,
        p_tutor_session_id: sessionId,
        p_prompt: result.practiceQuestion.prompt,
        p_expected_answer_kind: result.practiceQuestion.expectedAnswerKind,
        p_canonical_answer: result.practiceQuestion.canonicalAnswer,
      });
      if (!error && created) {
        persistedPractice = { id: created.id, prompt: created.prompt, expectedAnswerKind: created.expectedAnswerKind };
      }
      // Degrade gracefully on persistence failure — the practice
      // question still appears in `reply` as ordinary chat text.
    }
  }

  // Conservative, bounded personalization (Part 8) — only stored when
  // the model had real evidence THIS turn, only for the session's own
  // objective (never guessed for a generic/direct session).
  if (result.misconception && session.learningObjectiveId) {
    await recordMisconception(
      supabase,
      session.courseId,
      session.learningObjectiveId,
      result.misconception.description,
      result.misconception.resolved,
    );
  }

  const tEnd = performance.now();
  logTutorLatency({
    sessionId,
    entrySource: session.entrySource,
    quotaMs: Math.round(tAfterQuota - tStart),
    contextMs: Math.round(tAfterContext - tAfterQuota),
    providerMs: Math.round(tAfterProvider - tAfterContext),
    persistenceMs: Math.round(tEnd - tAfterProvider),
    totalMs: Math.round(tEnd - tStart),
  });

  return { reply: result.reply, sources, practiceQuestion: persistedPractice };
}

async function resolveObjectiveFallback(
  supabase: SupabaseClient<Database>,
  session: TutorSessionInfo,
): Promise<string | null> {
  const { data } = await supabase
    .from("learning_objectives")
    .select("id")
    .eq("course_id", session.courseId)
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

function entrySourceToAiContext(entrySource: TutorEntrySource): AiEntryContext {
  switch (entrySource) {
    case "performance":
      return "tutor_performance";
    case "assessment_review":
      return "tutor_assessment_review";
    case "slide":
      return "tutor_slide";
    case "question_bank_practice":
      return "tutor_question_explain";
    case "direct":
    default:
      return "tutor_direct";
  }
}
