import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import { ensureCourseMembership, removeCourseMembershipIfAdded } from "../test-support/course-membership";

/**
 * Live verification of the Assessment Builder's two selection modes
 * (Part 4) against the hosted dev project — same approach as the other
 * integration test files: real accounts, real RPCs/RLS, throwaway
 * fixtures cleaned up in afterAll. Skips (not fails) without credentials.
 */
try {
  process.loadEnvFile(path.resolve(__dirname, "../../../.env.local"));
} catch {
  // handled by canRun below
}

const CSE_1203 = "11111111-1111-1111-1111-111111111111";

interface DevCredentials {
  student: { email: string; password: string };
  instructors: { email: string; password: string }[];
}

async function loadCredentials(): Promise<DevCredentials | null> {
  try {
    const raw = await readFile(
      path.resolve(__dirname, "../../../scripts/.dev-credentials.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw);
    if (!parsed.student || !parsed.instructors?.length) return null;
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

describe.runIf(canRun)("Assessment Builder: create_assessment + start_attempt", () => {
  let admin: SupabaseClient<Database>;
  let instructor: SupabaseClient<Database>;
  let student: SupabaseClient<Database>;

  let bankId: string;
  let otherBankId: string;
  const hiddenIds: string[] = []; // 3 hidden questions, options inserted in a known order
  let practiceId: string;
  let foreignQuestionId: string;

  const assessmentIds: string[] = [];
  let studentAdded = false;

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

    // The real CSE 1203 roster is now exactly the instructor's real
    // students — ensure this fixture account for this suite only.
    const { data: studentUser } = await student.auth.getUser();
    ({ added: studentAdded } = await ensureCourseMembership(admin, studentUser.user!.id, CSE_1203, "student"));

    const { data: bank } = await admin
      .from("question_banks")
      .insert({ course_id: CSE_1203, title: "TEST assessment-builder bank", version: 1 })
      .select("id")
      .single();
    bankId = bank!.id;

    const { data: otherBank } = await admin
      .from("question_banks")
      .insert({ course_id: CSE_1203, title: "TEST assessment-builder other bank", version: 1 })
      .select("id")
      .single();
    otherBankId = otherBank!.id;

    for (let i = 0; i < 3; i++) {
      const { data: q } = await admin
        .from("questions")
        .insert({
          bank_id: bankId,
          topic: "TEST",
          prompt: `TEST fixed question ${i + 1}`,
          visibility: "hidden",
        } as never)
        .select("id")
        .single();
      hiddenIds.push(q!.id);
      await admin.from("question_options").insert([
        { question_id: q!.id, position: 0, text: "A", is_correct: true },
        { question_id: q!.id, position: 1, text: "B", is_correct: false },
      ]);
    }

    const { data: pq } = await admin
      .from("questions")
      .insert({ bank_id: bankId, topic: "TEST", prompt: "TEST practice question", visibility: "practice" } as never)
      .select("id")
      .single();
    practiceId = pq!.id;
    await admin.from("question_options").insert([
      { question_id: practiceId, position: 0, text: "A", is_correct: true },
      { question_id: practiceId, position: 1, text: "B", is_correct: false },
    ]);

    const { data: fq } = await admin
      .from("questions")
      .insert({ bank_id: otherBankId, topic: "TEST", prompt: "TEST foreign question", visibility: "hidden" } as never)
      .select("id")
      .single();
    foreignQuestionId = fq!.id;
    await admin.from("question_options").insert([{ question_id: foreignQuestionId, position: 0, text: "A", is_correct: true }]);
  });

  afterAll(async () => {
    // assessments.bank_id has NO cascade (only questions.bank_id does) —
    // assessments created against this bank must be deleted first, or
    // the bank delete fails on a foreign-key violation.
    if (bankId) {
      await admin.from("assessments").delete().eq("bank_id", bankId);
      await admin.from("question_banks").delete().eq("id", bankId);
    }
    if (otherBankId) {
      await admin.from("assessments").delete().eq("bank_id", otherBankId);
      await admin.from("question_banks").delete().eq("id", otherBankId);
    }
    const { data: studentUser } = await student.auth.getUser();
    await removeCourseMembershipIfAdded(admin, studentUser.user!.id, CSE_1203, studentAdded);
  });

  it("random mode: creates an assessment and start_attempt samples the configured count", async () => {
    const { data: id, error } = await instructor.rpc("create_assessment", {
      p_course_id: CSE_1203,
      p_bank_id: bankId,
      p_title: "TEST Mock Test (random)",
      p_instructions: "",
      p_kind: "mock_test",
      p_points_possible: null,
      p_selection_mode: "random",
      p_question_order_mode: "shuffled",
      p_option_order_mode: "shuffled",
      p_rules: [{ position: 1, count: 2 }],
    });
    expect(error).toBeNull();
    assessmentIds.push(id!);

    await admin.from("assessments").update({ published_at: new Date().toISOString(), locked: false }).eq("id", id!);

    const { data: attemptId, error: attemptErr } = await student.rpc("start_attempt", { p_assessment_id: id! });
    expect(attemptErr).toBeNull();

    const { data: aq } = await admin
      .from("attempt_questions")
      .select("question_id, position, option_order")
      .eq("attempt_id", attemptId!)
      .order("position");
    expect(aq).toHaveLength(2);
    expect(aq!.every((r) => (r.option_order as string[]).length === 2)).toBe(true);
  });

  it("fixed mode: start_attempt uses exactly the chosen questions in fixed order with fixed option order", async () => {
    const { data: id, error } = await instructor.rpc("create_assessment", {
      p_course_id: CSE_1203,
      p_bank_id: bankId,
      p_title: "TEST Mock Test (fixed)",
      p_instructions: "",
      p_kind: "mock_test",
      p_points_possible: null,
      p_selection_mode: "fixed",
      p_question_order_mode: "fixed",
      p_option_order_mode: "fixed",
      p_rules: hiddenIds.map((qid, i) => ({ position: i + 1, fixedQuestionId: qid })),
    });
    expect(error).toBeNull();
    assessmentIds.push(id!);

    await admin.from("assessments").update({ published_at: new Date().toISOString(), locked: false }).eq("id", id!);

    const { data: attemptId, error: attemptErr } = await student.rpc("start_attempt", { p_assessment_id: id! });
    expect(attemptErr).toBeNull();

    const { data: aq } = await admin
      .from("attempt_questions")
      .select("question_id, position, option_order")
      .eq("attempt_id", attemptId!)
      .order("position");
    expect(aq!.map((r) => r.question_id)).toEqual(hiddenIds);

    for (const row of aq!) {
      const { data: opts } = await admin
        .from("question_options")
        .select("id")
        .eq("question_id", row.question_id)
        .order("position");
      expect(row.option_order).toEqual(opts!.map((o) => o.id));
    }
  });

  it(
    "blocks a Class Test that includes a Practice-visible question",
    async () => {
      const { error } = await instructor.rpc("create_assessment", {
        p_course_id: CSE_1203,
        p_bank_id: bankId,
        p_title: "TEST Class Test (should be blocked)",
        p_instructions: "",
        p_kind: "class_test",
        p_points_possible: 10,
        p_selection_mode: "fixed",
        p_question_order_mode: "shuffled",
        p_option_order_mode: "shuffled",
        p_rules: [{ position: 1, fixedQuestionId: practiceId }],
      });
      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/Practice-visible/);
    },
    15000,
  );

  it("rejects a fixed question that belongs to a different bank", async () => {
    const { error } = await instructor.rpc("create_assessment", {
      p_course_id: CSE_1203,
      p_bank_id: bankId,
      p_title: "TEST cross-bank (should be blocked)",
      p_instructions: "",
      p_kind: "mock_test",
      p_points_possible: null,
      p_selection_mode: "fixed",
      p_question_order_mode: "shuffled",
      p_option_order_mode: "shuffled",
      p_rules: [{ position: 1, fixedQuestionId: foreignQuestionId }],
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/do not belong to this question bank/);
  });

  it("rejects a student calling create_assessment directly", async () => {
    const { error } = await student.rpc("create_assessment", {
      p_course_id: CSE_1203,
      p_bank_id: bankId,
      p_title: "TEST student-forged assessment",
      p_instructions: "",
      p_kind: "mock_test",
      p_points_possible: null,
      p_selection_mode: "random",
      p_question_order_mode: "shuffled",
      p_option_order_mode: "shuffled",
      p_rules: [{ position: 1, count: 1 }],
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/Not authorized/);
  });
});
