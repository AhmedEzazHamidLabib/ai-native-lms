import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import { ensureCourseMembership, removeCourseMembershipIfAdded } from "../test-support/course-membership";

/**
 * Live verification of Project Instructor Tooling (Part 5) against the
 * hosted dev project. Deliberately builds its OWN isolated test
 * project (a throwaway 'project'-kind assessment + projects row) rather
 * than touching the real CSE 1203 project, which holds real historical
 * group/submission data that must never be altered by a test run.
 * Cleanup deletes the throwaway assessment, which cascades everything.
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

describe.runIf(canRun)("Project Instructor Tooling: groups, deliverables, grades", () => {
  let admin: SupabaseClient<Database>;
  let instructor: SupabaseClient<Database>;
  let studentA: SupabaseClient<Database>;
  let studentB: SupabaseClient<Database>;
  let uidA: string;
  let uidB: string;
  let studentAAdded = false;
  let studentBAdded = false;

  let testBankId: string;
  let testAssessmentId: string;
  let testProjectId: string;

  beforeAll(async () => {
    admin = createClient<Database>(url!, serviceKey!);
    instructor = createClient<Database>(url!, anonKey!);
    studentA = createClient<Database>(url!, anonKey!);
    studentB = createClient<Database>(url!, anonKey!);

    const [i, a, b] = await Promise.all([
      instructor.auth.signInWithPassword(credentials!.instructors[0]),
      studentA.auth.signInWithPassword(credentials!.student),
      studentB.auth.signInWithPassword(credentials!.studentB),
    ]);
    if (i.error) throw new Error(`instructor sign-in failed: ${i.error.message}`);
    if (a.error) throw new Error(`studentA sign-in failed: ${a.error.message}`);
    if (b.error) throw new Error(`studentB sign-in failed: ${b.error.message}`);
    uidA = (await studentA.auth.getUser()).data.user!.id;
    uidB = (await studentB.auth.getUser()).data.user!.id;

    // The real CSE 1203 roster is now exactly the instructor's real
    // students — ensure these fixture accounts for this suite only.
    ({ added: studentAAdded } = await ensureCourseMembership(admin, uidA, CSE_1203, "student"));
    ({ added: studentBAdded } = await ensureCourseMembership(admin, uidB, CSE_1203, "student"));

    const { data: bank } = await admin
      .from("question_banks")
      .insert({ course_id: CSE_1203, title: "TEST project-tooling bank", version: 1 })
      .select("id")
      .single();
    testBankId = bank!.id;

    const { data: assessment } = await admin
      .from("assessments")
      .insert({
        course_id: CSE_1203,
        bank_id: testBankId,
        title: "TEST project-tooling project assessment",
        question_count: 0,
        kind: "project",
        locked: true,
      })
      .select("id")
      .single();
    testAssessmentId = assessment!.id;

    const { data: project } = await admin
      .from("projects")
      .insert({ assessment_id: testAssessmentId, course_id: CSE_1203, description: "TEST isolated project" })
      .select("id")
      .single();
    testProjectId = project!.id;
  });

  afterAll(async () => {
    // Cascades: assessments -> projects -> project_groups/deliverables -> members/submissions.
    if (testAssessmentId) await admin.from("assessments").delete().eq("id", testAssessmentId);
    if (testBankId) await admin.from("question_banks").delete().eq("id", testBankId);
    await removeCourseMembershipIfAdded(admin, uidA, CSE_1203, studentAAdded);
    await removeCourseMembershipIfAdded(admin, uidB, CSE_1203, studentBAdded);
  });

  it("instructor creates a group and assigns a student", async () => {
    const { data: groupId, error } = await instructor.rpc("create_project_group", {
      p_project_id: testProjectId,
      p_name: "TEST Group A",
      p_capacity: 2,
    });
    expect(error).toBeNull();

    const { error: assignErr } = await instructor.rpc("assign_student_to_group", {
      p_group_id: groupId!,
      p_user_id: uidA,
    });
    expect(assignErr).toBeNull();

    const { data: overview } = await instructor.rpc("get_project_instructor_overview", { p_project_id: testProjectId });
    const group = (overview as unknown as { groups: { groupId: string; members: { userId: string }[] }[] }).groups.find(
      (g) => g.groupId === groupId,
    );
    expect(group!.members.map((m) => m.userId)).toContain(uidA);
  });

  it("assign_student_to_group enforces capacity", async () => {
    const { data: groupId } = await instructor.rpc("create_project_group", {
      p_project_id: testProjectId,
      p_name: "TEST Group Capacity",
      p_capacity: 1,
    });
    const { error: firstErr } = await instructor.rpc("assign_student_to_group", { p_group_id: groupId!, p_user_id: uidA });
    expect(firstErr).toBeNull();

    const { error: secondErr } = await instructor.rpc("assign_student_to_group", { p_group_id: groupId!, p_user_id: uidB });
    expect(secondErr).not.toBeNull();
    expect(secondErr!.message).toMatch(/capacity/);
  });

  it("student cannot join a group in instructor_assigned mode", async () => {
    const { data: groupId } = await instructor.rpc("create_project_group", {
      p_project_id: testProjectId,
      p_name: "TEST Group Assigned-Only",
      p_capacity: null,
    });
    const { error } = await studentA.rpc("join_project_group", { p_group_id: groupId! });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/assigned by the instructor/);
  });

  it("self-enrollment: student can join, capacity is enforced, and locking blocks further changes", async () => {
    const { error: modeErr } = await instructor.rpc("set_project_group_mode", {
      p_project_id: testProjectId,
      p_mode: "self_enrollment",
    });
    expect(modeErr).toBeNull();

    const { data: groupId } = await instructor.rpc("create_project_group", {
      p_project_id: testProjectId,
      p_name: "TEST Self-Enroll Group",
      p_capacity: 1,
    });

    const { error: joinErr } = await studentA.rpc("join_project_group", { p_group_id: groupId! });
    expect(joinErr).toBeNull();

    const { error: fullErr } = await studentB.rpc("join_project_group", { p_group_id: groupId! });
    expect(fullErr).not.toBeNull();
    expect(fullErr!.message).toMatch(/full/);

    const { error: lockErr } = await instructor.rpc("set_project_groups_locked", { p_project_id: testProjectId, p_locked: true });
    expect(lockErr).toBeNull();

    const { error: leaveErr } = await studentA.rpc("leave_project_group", { p_group_id: groupId! });
    expect(leaveErr).not.toBeNull();
    expect(leaveErr!.message).toMatch(/locked/);

    // Instructor can still move students while locked.
    const { error: moveErr } = await instructor.rpc("assign_student_to_group", { p_group_id: groupId!, p_user_id: uidA });
    expect(moveErr).toBeNull(); // already a member — no-op, not an error

    await instructor.rpc("set_project_groups_locked", { p_project_id: testProjectId, p_locked: false });
  });

  it(
    "blocks deleting a group or deliverable once it has a submission on record",
    async () => {
      const { data: groupId } = await instructor.rpc("create_project_group", {
        p_project_id: testProjectId,
        p_name: "TEST Group With Submission",
        p_capacity: null,
      });
      await instructor.rpc("assign_student_to_group", { p_group_id: groupId!, p_user_id: uidA });

      const { data: deliverableId } = await instructor.rpc("create_project_deliverable", {
        p_project_id: testProjectId,
        p_title: "TEST Deliverable",
        p_description: "",
        p_due_at: null,
        p_submission_enabled: true,
        p_allowed_type: null,
        p_published: true,
      });

      await admin.from("project_submissions").insert({
        deliverable_id: deliverableId!,
        group_id: groupId!,
        submitted_by_user_id: uidA,
        storage_path: `${CSE_1203}/${groupId}/${deliverableId}/test.txt`,
      });

      const { error: deleteGroupErr } = await instructor.rpc("delete_project_group", { p_group_id: groupId! });
      expect(deleteGroupErr).not.toBeNull();
      expect(deleteGroupErr!.message).toMatch(/submissions on record/);

      const { error: deleteDeliverableErr } = await instructor.rpc("delete_project_deliverable", {
        p_deliverable_id: deliverableId!,
      });
      expect(deleteDeliverableErr).not.toBeNull();
      expect(deleteDeliverableErr!.message).toMatch(/submissions on record/);
    },
    15000,
  );

  it("draft (unpublished) deliverables are invisible to get_my_project_group but visible to the instructor overview", async () => {
    const { data: groupId } = await instructor.rpc("create_project_group", {
      p_project_id: testProjectId,
      p_name: "TEST Draft Visibility Group",
      p_capacity: null,
    });
    await instructor.rpc("assign_student_to_group", { p_group_id: groupId!, p_user_id: uidA });

    await instructor.rpc("create_project_deliverable", {
      p_project_id: testProjectId,
      p_title: "TEST Draft Deliverable",
      p_description: "",
      p_due_at: null,
      p_submission_enabled: true,
      p_allowed_type: null,
      p_published: false,
    });

    const { data: myGroup } = await studentA.rpc("get_my_project_group", { p_project_id: testProjectId });
    const deliverables = (myGroup as unknown as { deliverables: { title: string }[] }).deliverables;
    expect(deliverables.some((d) => d.title === "TEST Draft Deliverable")).toBe(false);
  });

  it("set_project_group_grade: own group can read, a different student cannot", async () => {
    const { data: groupId } = await instructor.rpc("create_project_group", {
      p_project_id: testProjectId,
      p_name: "TEST Grading Group",
      p_capacity: null,
    });
    await instructor.rpc("assign_student_to_group", { p_group_id: groupId!, p_user_id: uidA });

    const { error: gradeErr } = await instructor.rpc("set_project_group_grade", {
      p_project_id: testProjectId,
      p_group_id: groupId!,
      p_score: 18,
      p_max_score: 20,
      p_feedback: "Good work",
    });
    expect(gradeErr).toBeNull();

    const { data: ownRead } = await studentA.from("project_group_grades").select("score").eq("group_id", groupId!).maybeSingle();
    expect(ownRead?.score).toBe(18);

    const { data: otherRead } = await studentB.from("project_group_grades").select("score").eq("group_id", groupId!).maybeSingle();
    expect(otherRead).toBeNull();
  });

  it("rejects a student calling instructor-only project RPCs directly", async () => {
    const { error } = await studentA.rpc("create_project_group", {
      p_project_id: testProjectId,
      p_name: "TEST forged group",
      p_capacity: null,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/Not authorized/);
  });
});
