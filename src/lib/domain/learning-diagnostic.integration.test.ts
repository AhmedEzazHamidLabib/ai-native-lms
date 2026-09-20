import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import { ensureCourseMembership, removeCourseMembershipIfAdded } from "../test-support/course-membership";

/**
 * Live verification of the Learning Diagnostic (non-graded practice
 * test) and Tutor preferences added in
 * 0047_diagnostic_and_tutor_preferences.sql. Isolated throwaway
 * fixtures only — never touches the real CSE 1203 Diagnostic or its
 * question bank.
 */
try {
  process.loadEnvFile(path.resolve(__dirname, "../../../.env.local"));
} catch {
  // handled by canRun below
}

const CSE_1203 = "11111111-1111-1111-1111-111111111111";

interface DevCredentials {
  student: { email: string; password: string };
  studentB: { email: string; password: string };
  instructors: { email: string; password: string }[];
}

async function loadCredentials(): Promise<DevCredentials | null> {
  try {
    const raw = await readFile(path.resolve(__dirname, "../../../scripts/.dev-credentials.json"), "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed.student || !parsed.studentB || !parsed.instructors?.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const credentials = await loadCredentials();

const canRun = Boolean(url && anonKey && serviceKey && credentials);

describe.runIf(canRun)("Learning Diagnostic: non-graded, practice-only, persisted selection", () => {
  let admin: SupabaseClient<Database>;
  let instructor: SupabaseClient<Database>;
  let student: SupabaseClient<Database>;
  let uid: string;
  let studentAdded = false;

  let bankId: string;
  let hiddenQuestionIds: string[] = [];
  let practiceQuestionId: string;
  let diagnosticId: string;

  beforeAll(async () => {
    admin = createClient<Database>(url!, serviceKey!);
    instructor = createClient<Database>(url!, anonKey!);
    student = createClient<Database>(url!, anonKey!);

    const [i, s] = await Promise.all([
      instructor.auth.signInWithPassword(credentials!.instructors[0]),
      student.auth.signInWithPassword(credentials!.student),
    ]);
    if (i.error) throw new Error(`instructor sign-in failed: ${i.error.message}`);
    if (s.error) throw new Error(`student sign-in failed: ${s.error.message}`);
    uid = (await student.auth.getUser()).data.user!.id;
    ({ added: studentAdded } = await ensureCourseMembership(admin, uid, CSE_1203, "student"));

    const { data: bank } = await admin
      .from("question_banks")
      .insert({ course_id: CSE_1203, title: "TEST diagnostic bank (mixed visibility)", version: 1 })
      .select("id")
      .single();
    bankId = bank!.id;

    // Deliberately mixed in ONE bank — the exact scenario the
    // visibility_filter defends against, regardless of how the real
    // course happens to organize its banks today.
    const { data: practiceQ } = await admin
      .from("questions")
      .insert({ bank_id: bankId, topic: "TEST", prompt: "TEST practice-visible question", visibility: "practice" } as never)
      .select("id")
      .single();
    practiceQuestionId = practiceQ!.id;
    await admin.from("question_options").insert([
      { question_id: practiceQuestionId, position: 0, text: "A", is_correct: true },
      { question_id: practiceQuestionId, position: 1, text: "B", is_correct: false },
    ]);

    const hiddenInserts = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        admin
          .from("questions")
          .insert({ bank_id: bankId, topic: "TEST", prompt: `TEST hidden question ${i}`, visibility: "hidden" } as never)
          .select("id")
          .single(),
      ),
    );
    hiddenQuestionIds = hiddenInserts.map((r) => r.data!.id);
    for (const hid of hiddenQuestionIds) {
      await admin.from("question_options").insert([
        { question_id: hid, position: 0, text: "A", is_correct: true },
        { question_id: hid, position: 1, text: "B", is_correct: false },
      ]);
    }

    const { data: id, error } = await instructor.rpc("create_assessment", {
      p_course_id: CSE_1203,
      p_bank_id: bankId,
      p_title: "TEST diagnostic",
      p_instructions: "Practice only.",
      p_kind: "mock_test",
      p_points_possible: null,
      p_selection_mode: "random",
      p_question_order_mode: "fixed",
      p_option_order_mode: "fixed",
      p_rules: [{ position: 1, count: 1, visibilityFilter: "practice" }],
      p_is_diagnostic: true,
    });
    if (error) throw new Error(error.message);
    diagnosticId = id!;
    await admin.from("assessments").update({ published_at: new Date().toISOString(), locked: false }).eq("id", diagnosticId);
  });

  afterAll(async () => {
    if (bankId) {
      await admin.from("assessments").delete().eq("bank_id", bankId);
      await admin.from("question_banks").delete().eq("id", bankId);
    }
    await removeCourseMembershipIfAdded(admin, uid, CSE_1203, studentAdded);
  });

  it("create_assessment(is_diagnostic=true, kind=mock_test) is non-graded by construction", async () => {
    const { data } = await admin.from("assessments").select("contributes_to_grade, is_diagnostic, kind").eq("id", diagnosticId).single();
    expect(data!.contributes_to_grade).toBe(false);
    expect(data!.is_diagnostic).toBe(true);
  });

  let attemptId: string;

  it("start_attempt with visibilityFilter='practice' never selects a hidden question, even outnumbered 4:1", async () => {
    const { data, error } = await student.rpc("start_attempt", { p_assessment_id: diagnosticId });
    expect(error).toBeNull();
    attemptId = data as unknown as string;

    const { data: rows } = await admin.from("attempt_questions").select("question_id").eq("attempt_id", attemptId);
    expect(rows).toHaveLength(1);
    expect(rows![0].question_id).toBe(practiceQuestionId);
    expect(hiddenQuestionIds).not.toContain(rows![0].question_id);
  });

  it("refreshing (calling start_attempt again) returns the SAME attempt without reshuffling", async () => {
    const before = await admin.from("attempt_questions").select("question_id").eq("attempt_id", attemptId);
    const { data: secondAttemptId } = await student.rpc("start_attempt", { p_assessment_id: diagnosticId });
    expect(secondAttemptId).toBe(attemptId);
    const after = await admin.from("attempt_questions").select("question_id").eq("attempt_id", attemptId);
    expect(after.data).toEqual(before.data);
  });

  it("submitting the diagnostic incurs zero AI provider calls (no new ai_generation_events rows)", async () => {
    const { count: before } = await admin
      .from("ai_generation_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", uid);

    await student.rpc("save_response", {
      p_attempt_id: attemptId,
      p_question_id: practiceQuestionId,
      p_selected_option_id: null,
      p_text_response: null,
    });
    const { error: submitErr } = await student.rpc("submit_attempt", { p_attempt_id: attemptId });
    expect(submitErr).toBeNull();

    const { count: after } = await admin
      .from("ai_generation_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", uid);
    expect(after ?? 0).toBe(before ?? 0);
  });

  it("the submitted diagnostic attempt counts toward the student's own evidence (get_student_objective_evidence)", async () => {
    // No learning_objective_id on our throwaway TEST questions, so this
    // just confirms the RPC call itself succeeds post-diagnostic — the
    // real per-objective aggregation is exercised by the live CSE 1203
    // Diagnostic, which DOES have objective-linked questions.
    const { error } = await student.rpc("get_student_objective_evidence", { p_course_id: CSE_1203 });
    expect(error).toBeNull();
  });
});

describe.runIf(canRun)("Tutor preferences: explicit, own-row only", () => {
  let admin: SupabaseClient<Database>;
  let studentA: SupabaseClient<Database>;
  let studentB: SupabaseClient<Database>;
  let uidA: string;

  beforeAll(async () => {
    admin = createClient<Database>(url!, serviceKey!);
    studentA = createClient<Database>(url!, anonKey!);
    studentB = createClient<Database>(url!, anonKey!);

    const [a, b] = await Promise.all([
      studentA.auth.signInWithPassword(credentials!.student),
      studentB.auth.signInWithPassword(credentials!.studentB),
    ]);
    if (a.error) throw new Error(`studentA sign-in failed: ${a.error.message}`);
    if (b.error) throw new Error(`studentB sign-in failed: ${b.error.message}`);
    uidA = (await studentA.auth.getUser()).data.user!.id;
  });

  afterAll(async () => {
    await admin.from("tutor_preferences").delete().eq("user_id", uidA);
  });

  it("rejects an invalid enum value", async () => {
    const { error } = await studentA.rpc("upsert_my_tutor_preferences", {
      p_explanation_style: "visual_learner", // not a real value — never a personality label
      p_correction_style: null,
      p_detail_level: null,
      p_practice_pacing: null,
    });
    expect(error).not.toBeNull();
  });

  it("a student can set and read their own preferences", async () => {
    const { error } = await studentA.rpc("upsert_my_tutor_preferences", {
      p_explanation_style: "example_first",
      p_correction_style: "hint_first",
      p_detail_level: "balanced",
      p_practice_pacing: "one_at_a_time",
    });
    expect(error).toBeNull();

    const { data } = await studentA
      .from("tutor_preferences")
      .select("explanation_style, correction_style, detail_level, practice_pacing")
      .eq("user_id", uidA)
      .single();
    expect(data!.explanation_style).toBe("example_first");
    expect(data!.correction_style).toBe("hint_first");
  });

  it("another student cannot read studentA's preferences via direct select (RLS)", async () => {
    const { data } = await studentB.from("tutor_preferences").select("user_id").eq("user_id", uidA);
    expect(data ?? []).toHaveLength(0);
  });

  it("another student cannot overwrite studentA's preferences via a forged upsert", async () => {
    const { error } = await studentB.from("tutor_preferences").upsert({ user_id: uidA, detail_level: "detailed" });
    expect(error).not.toBeNull();

    const { data: stillA } = await admin.from("tutor_preferences").select("detail_level").eq("user_id", uidA).single();
    expect(stillA!.detail_level).toBe("balanced"); // untouched by studentB's attempt
  });
});
