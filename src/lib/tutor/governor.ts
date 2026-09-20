import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { TokenUsage } from "./provider";

/**
 * AI Usage Governor (docs/COURSEWORK_LEARNING_ARCHITECTURE.md +
 * this milestone's Part 11). The ONLY gate before a provider call —
 * if a student exceeds policy, `reserveGeneration` returns
 * `{allowed: false}` and the caller must not call the provider at all.
 * Atomicity lives entirely in `reserve_ai_generation()` (a single
 * advisory-locked Postgres function) — this module is a thin,
 * friendly-message wrapper around it, never a second source of truth.
 */

export type AiEntryContext =
  | "tutor_direct"
  | "tutor_performance"
  | "tutor_assessment_review"
  | "tutor_slide"
  | "tutor_question_explain"
  | "practice_evaluation";

export class AiUsageLimitError extends Error {
  constructor(public readonly reason: string) {
    super(friendlyReasonMessage(reason));
    this.name = "AiUsageLimitError";
  }
}

function friendlyReasonMessage(reason: string): string {
  switch (reason) {
    case "paused":
      return "AI Tutor is temporarily paused while the course is in pilot. Everything else in Coursework is still available.";
    case "cooldown":
      return "Give it a few seconds between messages — the Tutor is still catching up.";
    case "concurrent":
      return "The Tutor is still working on your last message.";
    case "student_daily":
      return "You've reached today's AI Tutor pilot limit. You can still use course materials and Practice. Tutor access resets tomorrow.";
    case "course_daily":
    case "global_daily":
      return "The AI Tutor has reached its usage limit for today across the class. Please try again tomorrow — course materials and Practice remain available.";
    default:
      return "AI Tutor isn't available right now. Please try again shortly.";
  }
}

export interface ReservedGeneration {
  eventId: string;
}

/** Call BEFORE any provider request. Throws AiUsageLimitError if disallowed — the caller must not proceed to call the provider. */
export async function reserveGeneration(
  supabase: SupabaseClient<Database>,
  courseId: string,
  entryContext: AiEntryContext,
): Promise<ReservedGeneration> {
  const { data, error } = await supabase.rpc("reserve_ai_generation", {
    p_course_id: courseId,
    p_entry_context: entryContext,
  });
  if (error || !data) {
    throw new AiUsageLimitError("unavailable");
  }
  if (!data.allowed) {
    throw new AiUsageLimitError(data.reason);
  }
  return { eventId: data.eventId };
}

/** Call AFTER the provider request, success or failure — records outcome and (on failure) refunds the quota slot for future checks. */
export async function completeGeneration(
  supabase: SupabaseClient<Database>,
  eventId: string,
  outcome: { status: "success" | "failed"; model?: string; usage?: TokenUsage },
): Promise<void> {
  await supabase.rpc("complete_ai_generation", {
    p_event_id: eventId,
    p_status: outcome.status,
    p_model: outcome.model ?? null,
    p_input_tokens: outcome.usage?.inputTokens ?? null,
    p_output_tokens: outcome.usage?.outputTokens ?? null,
  });
}
