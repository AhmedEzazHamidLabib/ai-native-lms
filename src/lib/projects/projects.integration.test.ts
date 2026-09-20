import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import { ensureCourseMembership, removeCourseMembershipIfAdded } from "../test-support/course-membership";

/**
 * Live authorization verification for Projects and question-bank
 * Practice's hidden-pool boundary — same approach as the other
 * integration test files: real accounts, real RPCs/RLS against the
 * hosted dev project. Skips (not fails) without credentials.
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
  tomorrowStudent: { email: string; password: string };
}

async function loadCredentials(): Promise<DevCredentials | null> {
  try {
    const raw = await readFile(
      path.resolve(__dirname, "../../../scripts/.dev-credentials.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw);
    if (!parsed.student || !parsed.studentB || !parsed.tomorrowStudent) return null;
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

describe.runIf(canRun)("Projects and Practice: authorization boundaries", () => {
  let admin: SupabaseClient<Database>;
  let studentA: SupabaseClient<Database>; // dev-student, CSE 1203
  let studentB: SupabaseClient<Database>; // CSE 1203, different group
  let cse1205Student: SupabaseClient<Database>; // not in CSE 1203 at all
  let uidA: string;
  let uidB: string;
  let studentAAdded = false;
  let studentBAdded = false;

  let projectId: string;
  let groupAId: string;
  let groupBId: string;
  let deliverableId: string;

  beforeAll(async () => {
    admin = createClient<Database>(url!, serviceKey!);
    studentA = createClient<Database>(url!, anonKey!);
    studentB = createClient<Database>(url!, anonKey!);
    cse1205Student = createClient<Database>(url!, anonKey!);

    const [a, b, c] = await Promise.all([
      studentA.auth.signInWithPassword(credentials!.student),
      studentB.auth.signInWithPassword(credentials!.studentB),
      cse1205Student.auth.signInWithPassword(credentials!.tomorrowStudent),
    ]);
    if (a.error) throw new Error(`studentA sign-in failed: ${a.error.message}`);
    if (b.error) throw new Error(`studentB sign-in failed: ${b.error.message}`);
    if (c.error) throw new Error(`cse1205Student sign-in failed: ${c.error.message}`);

    uidA = (await studentA.auth.getUser()).data.user!.id;
    uidB = (await studentB.auth.getUser()).data.user!.id;

    // The real CSE 1203 roster is now exactly the instructor's real
    // students — ensure these fixture accounts for this suite only.
    ({ added: studentAAdded } = await ensureCourseMembership(admin, uidA, CSE_1203, "student"));
    ({ added: studentBAdded } = await ensureCourseMembership(admin, uidB, CSE_1203, "student"));

    const { data: project } = await admin.from("projects").select("id").eq("course_id", CSE_1203).single();
    projectId = project!.id;

    // Clearly-marked, throwaway test fixtures — cleaned up in afterAll.
    // No real project groups exist yet (verified before writing this
    // test), so this cannot collide with real data.
    const { data: groupA } = await admin
      .from("project_groups")
      .insert({ project_id: projectId, name: "TEST Group A" })
      .select("id")
      .single();
    const { data: groupB } = await admin
      .from("project_groups")
      .insert({ project_id: projectId, name: "TEST Group B" })
      .select("id")
      .single();
    groupAId = groupA!.id;
    groupBId = groupB!.id;

    await admin.from("project_group_members").insert([
      { group_id: groupAId, user_id: uidA },
      { group_id: groupBId, user_id: uidB },
    ]);

    const { data: deliverable } = await admin
      .from("project_deliverables")
      .insert({ project_id: projectId, title: "TEST Deliverable", position: 999 })
      .select("id")
      .single();
    deliverableId = deliverable!.id;
  });

  afterAll(async () => {
    if (deliverableId) await admin.from("project_deliverables").delete().eq("id", deliverableId);
    if (groupAId) await admin.from("project_groups").delete().eq("id", groupAId);
    if (groupBId) await admin.from("project_groups").delete().eq("id", groupBId);
    await removeCourseMembershipIfAdded(admin, uidA, CSE_1203, studentAAdded);
    await removeCourseMembershipIfAdded(admin, uidB, CSE_1203, studentBAdded);
  });

  describe("group membership and visibility", () => {
    it("studentA sees their own group via get_my_project_group", async () => {
      const { data, error } = await studentA.rpc("get_my_project_group", { p_project_id: projectId });
      expect(error).toBeNull();
      expect((data as { groupId?: string }).groupId).toBe(groupAId);
    });

    it("the group directory shows full names, not emails, to any course member", async () => {
      const { data, error } = await studentA.rpc("list_project_groups", { p_project_id: projectId });
      expect(error).toBeNull();
      const names = (data ?? []).map((r) => r.member_full_name);
      expect(names.every((n) => !n.includes("@"))).toBe(true);
    });

    it("a CSE 1205-only student cannot read the CSE 1203 project's groups", async () => {
      const { error } = await cse1205Student.rpc("list_project_groups", { p_project_id: projectId });
      expect(error).not.toBeNull();
    });

    it("studentB cannot directly select studentA's group membership row (raw RLS)", async () => {
      const { data } = await studentB
        .from("project_group_members")
        .select("id")
        .eq("group_id", groupAId);
      expect(data ?? []).toHaveLength(0);
    });
  });

  describe("submission authorization", () => {
    afterAll(async () => {
      await admin.from("project_submissions").delete().eq("deliverable_id", deliverableId);
    });

    it("studentB (not in a group for this deliverable's project... they ARE, group B) cannot submit for group A", async () => {
      // submit_project_deliverable always resolves the caller's OWN
      // group server-side — there is no parameter for "which group,"
      // so this proves the design: studentB's submission always lands
      // in group B, never group A, no matter what.
      const { data, error } = await studentB.rpc("submit_project_deliverable", {
        p_deliverable_id: deliverableId,
        p_storage_path: `${CSE_1203}/${groupBId}/${deliverableId}/forged-test.txt`,
      });
      expect(error).toBeNull();
      expect(data!.groupId).toBe(groupBId); // never groupAId, by construction
    });

    it("a CSE 1205-only student cannot submit to the CSE 1203 project at all", async () => {
      const { error } = await cse1205Student.rpc("submit_project_deliverable", {
        p_deliverable_id: deliverableId,
        p_storage_path: `${CSE_1203}/forged/${deliverableId}/forged.txt`,
      });
      expect(error).not.toBeNull();
    });

    it("studentA cannot read studentB's group's submission", async () => {
      const { data } = await studentA
        .from("project_submissions")
        .select("id")
        .eq("group_id", groupBId);
      expect(data ?? []).toHaveLength(0);
    });

    it("storage RLS rejects a student uploading into another group's folder path", async () => {
      const fakeFile = new Blob(["test"], { type: "text/plain" });
      const { error } = await studentA.storage
        .from("project-submissions")
        .upload(`${CSE_1203}/${groupBId}/${deliverableId}/forged.txt`, fakeFile);
      expect(error).not.toBeNull();
    });
  });

  describe("question-bank Practice: hidden pool boundary", () => {
    let hiddenQuestionId: string;
    let hiddenBankId: string;

    beforeAll(async () => {
      const { data: bank } = await admin
        .from("question_banks")
        .insert({ course_id: CSE_1203, title: "TEST hidden bank", version: 1 })
        .select("id")
        .single();
      hiddenBankId = bank!.id;
      const { data: q } = await admin
        .from("question_banks")
        .select("id")
        .eq("id", hiddenBankId)
        .single();
      void q;
      const { data: question } = await admin
        .from("questions")
        .insert({
          bank_id: hiddenBankId,
          topic: "TEST",
          prompt: "TEST hidden question — should never be practiceable",
          visibility: "hidden",
        } as never)
        .select("id")
        .single();
      hiddenQuestionId = question!.id;
      await admin.from("question_options").insert([
        { question_id: hiddenQuestionId, position: 0, text: "A", is_correct: true },
        { question_id: hiddenQuestionId, position: 1, text: "B", is_correct: false },
      ]);
    });

    afterAll(async () => {
      if (hiddenBankId) await admin.from("question_banks").delete().eq("id", hiddenBankId);
    });

    it("get_practice_question rejects a hidden-visibility question", async () => {
      const { error } = await studentA.rpc("get_practice_question", { p_question_id: hiddenQuestionId });
      expect(error).not.toBeNull();
    });

    it("submit_question_bank_practice_answer rejects a hidden-visibility question", async () => {
      const { data: opts } = await admin
        .from("question_options")
        .select("id")
        .eq("question_id", hiddenQuestionId)
        .limit(1);
      const { error } = await studentA.rpc("submit_question_bank_practice_answer", {
        p_question_id: hiddenQuestionId,
        p_selected_option_id: opts![0].id,
      });
      expect(error).not.toBeNull();
    });

    it("list_practice_questions never includes the hidden question", async () => {
      const { data } = await studentA.rpc("list_practice_questions", { p_course_id: CSE_1203 });
      expect((data ?? []).some((q) => q.question_id === hiddenQuestionId)).toBe(false);
    });
  });

  describe("practice_attempts remains fully locked regardless of source_type", () => {
    it("a direct select for question_bank-sourced rows returns nothing", async () => {
      const { data, error } = await studentA
        .from("practice_attempts")
        .select("*")
        .eq("source_type", "question_bank");
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
    });
  });
});
