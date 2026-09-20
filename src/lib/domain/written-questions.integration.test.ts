import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import { ensureCourseMembership, removeCourseMembershipIfAdded } from "../test-support/course-membership";

/**
 * Live verification of Written Q&A question type (instructor product
 * pass, Part 3/6): mixed MCQ + written attempt, correct auto-grading of
 * the MCQ portion, "pending" (never silently zero) for the ungraded
 * written portion, and instructor manual grading updating the score.
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
    const raw = await readFile(path.resolve(__dirname, "../../../scripts/.dev-credentials.json"), "utf-8");
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

describe.runIf(canRun)("Written Q&A: mixed attempt, pending grading, manual grade", () => {
  let admin: SupabaseClient<Database>;
  let instructor: SupabaseClient<Database>;
  let student: SupabaseClient<Database>;

  let bankId: string;
  let mcqId: string;
  let correctOptionId: string;
  let writtenId: string;
  let assessmentId: string;
  let attemptId: string;
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
      .insert({ course_id: CSE_1203, title: "TEST written-qa bank", version: 1 })
      .select("id")
      .single();
    bankId = bank!.id;

    const { data: mcq } = await admin
      .from("questions")
      .insert({ bank_id: bankId, topic: "TEST", prompt: "TEST MCQ", visibility: "hidden", question_type: "single_choice" } as never)
      .select("id")
      .single();
    mcqId = mcq!.id;
    const { data: opts } = await admin
      .from("question_options")
      .insert([
        { question_id: mcqId, position: 0, text: "Right", is_correct: true },
        { question_id: mcqId, position: 1, text: "Wrong", is_correct: false },
      ])
      .select("id, is_correct");
    correctOptionId = opts!.find((o) => o.is_correct)!.id;

    const { data: written } = await admin
      .from("questions")
      .insert({
        bank_id: bankId,
        topic: "TEST",
        prompt: "TEST written question — explain X",
        visibility: "hidden",
        question_type: "written",
        answer_guide: "Should mention X and Y",
        explanation: "X because Y",
      } as never)
      .select("id")
      .single();
    writtenId = written!.id;

    const { data: id, error } = await instructor.rpc("create_assessment", {
      p_course_id: CSE_1203,
      p_bank_id: bankId,
      p_title: "TEST mixed written+mcq assessment",
      p_instructions: "",
      p_kind: "mock_test",
      p_points_possible: null,
      p_selection_mode: "fixed",
      p_question_order_mode: "fixed",
      p_option_order_mode: "fixed",
      p_rules: [
        { position: 1, fixedQuestionId: mcqId },
        { position: 2, fixedQuestionId: writtenId },
      ],
    });
    expect(error).toBeNull();
    assessmentId = id!;

    await admin.from("assessments").update({ published_at: new Date().toISOString(), locked: false }).eq("id", assessmentId);
  });

  afterAll(async () => {
    if (bankId) {
      await admin.from("assessments").delete().eq("bank_id", bankId);
      await admin.from("question_banks").delete().eq("id", bankId);
    }
    const { data: studentUser } = await student.auth.getUser();
    await removeCourseMembershipIfAdded(admin, studentUser.user!.id, CSE_1203, studentAdded);
  });

  it("start_attempt includes both question types with correct question_type tagging", async () => {
    const { data, error } = await student.rpc("start_attempt", { p_assessment_id: assessmentId });
    expect(error).toBeNull();
    attemptId = data!;

    const { data: view, error: viewErr } = await student.rpc("get_attempt_view", { p_attempt_id: attemptId });
    expect(viewErr).toBeNull();
    const types = view!.questions.map((q: { questionType: string }) => q.questionType);
    expect(types.sort()).toEqual(["single_choice", "written"]);
  });

  it("save_response accepts a text answer for the written question and an option for the MCQ", async () => {
    const { error: mcqErr } = await student.rpc("save_response", {
      p_attempt_id: attemptId,
      p_question_id: mcqId,
      p_selected_option_id: correctOptionId,
      p_text_response: null,
    });
    expect(mcqErr).toBeNull();

    const { error: writtenErr } = await student.rpc("save_response", {
      p_attempt_id: attemptId,
      p_question_id: writtenId,
      p_selected_option_id: null,
      p_text_response: "X happens because Y causes it.",
    });
    expect(writtenErr).toBeNull();
  });

  it(
    "submit_attempt auto-grades the MCQ, never silently scores the written question zero, and flags it pending",
    async () => {
      const { data, error } = await student.rpc("submit_attempt", { p_attempt_id: attemptId });
      expect(error).toBeNull();
      expect(data!.score).toBe(1); // only the MCQ counted so far
      expect(data!.maxScore).toBe(2); // both questions counted toward the total
      expect(data!.pendingGradingCount).toBe(1); // the written question is explicitly pending, not scored as wrong
    },
    15000,
  );

  it("a student cannot grade their own written response", async () => {
    const { error } = await student.rpc("grade_written_response", {
      p_attempt_id: attemptId,
      p_question_id: writtenId,
      p_is_correct: true,
      p_grading_note: null,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/Not authorized/);
  });

  it("instructor grading the written response updates score and clears pending count", async () => {
    const { data, error } = await instructor.rpc("grade_written_response", {
      p_attempt_id: attemptId,
      p_question_id: writtenId,
      p_is_correct: true,
      p_grading_note: "Good explanation.",
    });
    expect(error).toBeNull();
    expect(data!.score).toBe(2);
    expect(data!.maxScore).toBe(2);
    expect(data!.pendingGradingCount).toBe(0);

    const { data: attemptRow } = await admin.from("attempts").select("score, max_score, pending_grading_count").eq("id", attemptId).single();
    expect(attemptRow!.score).toBe(2);
    expect(attemptRow!.pending_grading_count).toBe(0);
  });

  it("get_attempt_view reveals the grading note and answer guide to the instructor after grading", async () => {
    const { data: instructorView } = await instructor.rpc("get_attempt_view", { p_attempt_id: attemptId });
    const writtenQ = instructorView!.questions.find((q: { questionId: string }) => q.questionId === writtenId) as {
      answerGuide: string | null;
      gradingNote: string | null;
      isCorrectManual: boolean | null;
    };
    expect(writtenQ.answerGuide).toBe("Should mention X and Y");
    expect(writtenQ.gradingNote).toBe("Good explanation.");
    expect(writtenQ.isCorrectManual).toBe(true);

    const { data: studentView } = await student.rpc("get_attempt_view", { p_attempt_id: attemptId });
    const studentWrittenQ = studentView!.questions.find((q: { questionId: string }) => q.questionId === writtenId) as {
      answerGuide: string | null;
    };
    expect(studentWrittenQ.answerGuide).toBeNull(); // never shown to the student directly
  });
});
