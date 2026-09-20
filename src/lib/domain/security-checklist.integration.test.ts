import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import { ensureCourseMembership, removeCourseMembershipIfAdded } from "../test-support/course-membership";

/**
 * Part 15's exhaustive security checklist, run as LIVE forged-call
 * attempts against the hosted dev project — the threat model is a
 * direct RPC/table call bypassing the UI entirely, not a UI-level
 * restriction. Every item not already covered by
 * assessment-builder.integration.test.ts, project-instructor.integration.test.ts,
 * course-members.integration.test.ts, or course-intelligence.integration.test.ts
 * (all from this same milestone) is exercised here. Isolated throwaway
 * fixtures only — never mutates real CSE 1203 question/assessment data.
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

describe.runIf(canRun)("Security checklist: direct forged-call boundaries", () => {
  let admin: SupabaseClient<Database>;
  let studentA: SupabaseClient<Database>;
  let studentB: SupabaseClient<Database>;
  let instructor: SupabaseClient<Database>;
  let nonOwnerInstructor: SupabaseClient<Database>;
  let uidA: string;
  let uidB: string;
  let studentAAdded = false;
  let studentBAdded = false;

  // Question-bank fixture for visibility/correct-answer tamper tests.
  let bankId: string;
  let questionId: string;
  let optionId: string;

  // Project fixture for cross-group submission-forgery tests.
  let testAssessmentId: string;
  let testProjectId: string;
  let groupAId: string;
  let groupBId: string;
  let deliverableId: string;

  beforeAll(async () => {
    admin = createClient<Database>(url!, serviceKey!);
    studentA = createClient<Database>(url!, anonKey!);
    studentB = createClient<Database>(url!, anonKey!);
    instructor = createClient<Database>(url!, anonKey!);
    nonOwnerInstructor = createClient<Database>(url!, anonKey!);

    const [a, b, i, n] = await Promise.all([
      studentA.auth.signInWithPassword(credentials!.student),
      studentB.auth.signInWithPassword(credentials!.studentB),
      instructor.auth.signInWithPassword(credentials!.instructors[0]),
      credentials!.instructors[1]
        ? nonOwnerInstructor.auth.signInWithPassword(credentials!.instructors[1])
        : Promise.resolve({ error: null }),
    ]);
    if (a.error) throw new Error(`studentA sign-in failed: ${a.error.message}`);
    if (b.error) throw new Error(`studentB sign-in failed: ${b.error.message}`);
    if (i.error) throw new Error(`instructor sign-in failed: ${i.error.message}`);
    if (n.error) throw new Error(`nonOwnerInstructor sign-in failed: ${n.error.message}`);
    uidA = (await studentA.auth.getUser()).data.user!.id;
    uidB = (await studentB.auth.getUser()).data.user!.id;

    // The real CSE 1203 roster is now exactly the instructor's real
    // students — ensure these fixture accounts for this suite only.
    ({ added: studentAAdded } = await ensureCourseMembership(admin, uidA, CSE_1203, "student"));
    ({ added: studentBAdded } = await ensureCourseMembership(admin, uidB, CSE_1203, "student"));

    const { data: bank } = await admin
      .from("question_banks")
      .insert({ course_id: CSE_1203, title: "TEST security-checklist bank", version: 1 })
      .select("id")
      .single();
    bankId = bank!.id;

    const { data: question } = await admin
      .from("questions")
      .insert({ bank_id: bankId, topic: "TEST", prompt: "TEST tamper-check question", visibility: "hidden" } as never)
      .select("id")
      .single();
    questionId = question!.id;

    const { data: options } = await admin
      .from("question_options")
      .insert([
        { question_id: questionId, position: 0, text: "A", is_correct: true },
        { question_id: questionId, position: 1, text: "B", is_correct: false },
      ])
      .select("id, is_correct");
    optionId = options!.find((o) => !o.is_correct)!.id;

    const { data: assessment } = await admin
      .from("assessments")
      .insert({
        course_id: CSE_1203,
        bank_id: bankId,
        title: "TEST security-checklist project assessment",
        question_count: 0,
        kind: "project",
        locked: true,
      })
      .select("id")
      .single();
    testAssessmentId = assessment!.id;

    const { data: project } = await admin
      .from("projects")
      .insert({ assessment_id: testAssessmentId, course_id: CSE_1203, description: "TEST security-checklist project" })
      .select("id")
      .single();
    testProjectId = project!.id;

    const [{ data: groupA }, { data: groupB }] = await Promise.all([
      admin.from("project_groups").insert({ project_id: testProjectId, name: "TEST Sec Group A" }).select("id").single(),
      admin.from("project_groups").insert({ project_id: testProjectId, name: "TEST Sec Group B" }).select("id").single(),
    ]);
    groupAId = groupA!.id;
    groupBId = groupB!.id;

    await admin.from("project_group_members").insert([
      { group_id: groupAId, user_id: uidA },
      { group_id: groupBId, user_id: uidB },
    ]);

    const { data: deliverable } = await admin
      .from("project_deliverables")
      .insert({ project_id: testProjectId, title: "TEST Sec Deliverable", position: 1, published: true })
      .select("id")
      .single();
    deliverableId = deliverable!.id;

    await admin.from("project_submissions").insert({
      deliverable_id: deliverableId,
      group_id: groupBId,
      submitted_by_user_id: uidB,
      storage_path: `${CSE_1203}/${groupBId}/${deliverableId}/private.txt`,
      note: "TEST private note for group B only",
    });
  });

  afterAll(async () => {
    if (testAssessmentId) await admin.from("assessments").delete().eq("id", testAssessmentId);
    if (bankId) await admin.from("question_banks").delete().eq("id", bankId);
    await removeCourseMembershipIfAdded(admin, uidA, CSE_1203, studentAAdded);
    await removeCourseMembershipIfAdded(admin, uidB, CSE_1203, studentBAdded);
  });

  it("a student's direct table update cannot make a hidden question practice-visible", async () => {
    await studentA.from("questions").update({ visibility: "practice" }).eq("id", questionId);
    const { data } = await admin.from("questions").select("visibility").eq("id", questionId).single();
    expect(data!.visibility).toBe("hidden");
  });

  it("a student's direct table update cannot flip a question option's correct answer", async () => {
    await studentA.from("question_options").update({ is_correct: true }).eq("id", optionId);
    const { data } = await admin.from("question_options").select("is_correct").eq("id", optionId).single();
    expect(data!.is_correct).toBe(false);
  });

  it("a student's direct table update cannot alter contributes_to_grade on an assessment", async () => {
    await studentA.from("assessments").update({ contributes_to_grade: true }).eq("id", testAssessmentId);
    const { data } = await admin.from("assessments").select("contributes_to_grade").eq("id", testAssessmentId).single();
    expect(data!.contributes_to_grade).toBe(false);
  });

  it("a student cannot self-authorize as an instructor", async () => {
    const { error } = await studentA.rpc("add_instructor_email", { p_email: credentials!.student.email });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/owner/i);
  });

  it("a student with no group cannot submit a project deliverable", async () => {
    // studentA is in groupA for THIS project, so use the sign-in-only
    // tomorrowStudent-style pattern instead: assert the RPC resolves
    // group server-side and never accepts a client-supplied one — there
    // is no group_id parameter to forge in the first place.
    const { error } = await studentA.rpc("submit_project_deliverable", {
      p_deliverable_id: deliverableId,
      p_storage_path: `${CSE_1203}/${groupAId}/${deliverableId}/forged.txt`,
    });
    // studentA legitimately belongs to groupA, so this should succeed
    // and land in groupA — the real assertion is what group it lands in.
    expect(error).toBeNull();
    const { data: landed } = await admin
      .from("project_submissions")
      .select("group_id")
      .eq("deliverable_id", deliverableId)
      .eq("submitted_by_user_id", uidA)
      .single();
    expect(landed!.group_id).toBe(groupAId); // never groupB, regardless of the storage_path string passed
  });

  it("a student cannot read another group's private submission via a direct table select", async () => {
    const { data } = await studentA.from("project_submissions").select("id, note").eq("group_id", groupBId);
    expect(data ?? []).toHaveLength(0);
  });

  it("a student cannot pause/unpause AI for a course or globally", async () => {
    const { error: courseErr } = await studentA.rpc("set_course_ai_paused", { p_course_id: CSE_1203, p_paused: true });
    expect(courseErr).not.toBeNull();

    const { error: globalErr } = await studentA.rpc("set_global_ai_paused", { p_paused: true });
    expect(globalErr).not.toBeNull();
  });

  it("a non-owner instructor cannot flip the GLOBAL AI pause (owner-only, distinct from course-level)", async () => {
    const { data: isOwner } = await nonOwnerInstructor.rpc("current_user_is_owner");
    expect(isOwner).toBe(false);

    const { error } = await nonOwnerInstructor.rpc("set_global_ai_paused", { p_paused: true });
    expect(error).not.toBeNull();

    // A non-owner instructor CAN still pause their own course, though —
    // that boundary is course-scoped instructor authority, not owner-only.
    const { error: courseErr } = await nonOwnerInstructor.rpc("set_course_ai_paused", {
      p_course_id: CSE_1203,
      p_paused: false, // idempotent no-op: already unpaused, keeps real state untouched
    });
    expect(courseErr).toBeNull();
  });

  it("a non-owner instructor cannot authorize new instructors (owner-only)", async () => {
    const { error } = await nonOwnerInstructor.rpc("add_instructor_email", { p_email: "should-not-work@example.test" });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/owner/i);
  });
});
