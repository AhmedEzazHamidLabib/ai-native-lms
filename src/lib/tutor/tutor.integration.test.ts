import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import { ensureCourseMembership, removeCourseMembershipIfAdded } from "../test-support/course-membership";

/**
 * Live authorization verification for the AI Tutor, same approach as
 * src/lib/supabase/rls.integration.test.ts — real accounts, real
 * RPCs/RLS against the hosted dev project, not mocks. Skips (not
 * fails) without credentials, so `npm run test` stays safe.
 */
try {
  process.loadEnvFile(path.resolve(__dirname, "../../../.env.local"));
} catch {
  // handled by canRun below
}

const CSE_1203 = "11111111-1111-1111-1111-111111111111";
const ASSESSMENT_ID = "d74bdc20-f6c7-4995-b4db-2d4bc6567108"; // CSE 1203 Mock Test

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

describe.runIf(canRun)("AI Tutor: authorization and security boundaries", () => {
  let studentA: SupabaseClient<Database>; // CSE 1203 member
  let studentB: SupabaseClient<Database>; // CSE 1203 member (different person)
  let cse1205Student: SupabaseClient<Database>; // CSE 1205 only, NOT in CSE 1203
  let anonClient: SupabaseClient<Database>;
  let admin: SupabaseClient<Database>;
  let uidA: string;
  let uidB: string;
  let studentAAdded = false;
  let studentBAdded = false;

  let sessionA: string;

  beforeAll(async () => {
    studentA = createClient<Database>(url!, anonKey!);
    studentB = createClient<Database>(url!, anonKey!);
    cse1205Student = createClient<Database>(url!, anonKey!);
    anonClient = createClient<Database>(url!, anonKey!);
    admin = createClient<Database>(url!, serviceKey!);

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

    const { data: session, error } = await studentA
      .from("tutor_sessions")
      .insert({ user_id: (await studentA.auth.getUser()).data.user!.id, course_id: CSE_1203, entry_source: "direct" })
      .select("id")
      .single();
    if (error) throw new Error(`could not create studentA session: ${error.message}`);
    sessionA = session.id;

    await studentA.from("tutor_messages").insert({
      session_id: sessionA,
      role: "user",
      content: "test message from studentA",
    });
  });

  afterAll(async () => {
    if (sessionA) {
      await studentA.from("tutor_sessions").delete().eq("id", sessionA);
    }
    await removeCourseMembershipIfAdded(admin, uidA, CSE_1203, studentAAdded);
    await removeCourseMembershipIfAdded(admin, uidB, CSE_1203, studentBAdded);
  });

  describe("cross-student isolation", () => {
    it("studentB cannot read studentA's tutor session", async () => {
      const { data } = await studentB.from("tutor_sessions").select("id").eq("id", sessionA);
      expect(data ?? []).toHaveLength(0);
    });

    it("studentB cannot read studentA's tutor messages", async () => {
      const { data } = await studentB
        .from("tutor_messages")
        .select("id")
        .eq("session_id", sessionA);
      expect(data ?? []).toHaveLength(0);
    });

    it("studentB cannot forge an insert into studentA's session", async () => {
      const { error } = await studentB
        .from("tutor_messages")
        .insert({ session_id: sessionA, role: "user", content: "forged" });
      expect(error).not.toBeNull();
    });

    it("a student cannot forge a tutor_sessions row for someone else's user_id", async () => {
      const { data: bUser } = await studentB.auth.getUser();
      const { error } = await studentA.from("tutor_sessions").insert({
        user_id: bUser.user!.id, // forged identity — studentA's client, studentB's id
        course_id: CSE_1203,
        entry_source: "direct",
      });
      expect(error).not.toBeNull();
    });
  });

  describe("cross-course retrieval isolation", () => {
    it("a CSE 1205-only student is rejected from searching CSE 1203 material", async () => {
      const { data, error } = await cse1205Student.rpc("search_course_material", {
        p_course_id: CSE_1203,
        p_query: "binary",
      });
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });

    it("a CSE 1203 student can search CSE 1203 material successfully", async () => {
      const { data, error } = await studentA.rpc("search_course_material", {
        p_course_id: CSE_1203,
        p_query: "memory storage",
      });
      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
    });

    it("a forged/nonexistent course id is rejected, not silently empty", async () => {
      const { error } = await studentA.rpc("search_course_material", {
        p_course_id: "00000000-0000-0000-0000-000000000000",
        p_query: "anything",
      });
      expect(error).not.toBeNull();
    });

    it("a CSE 1205-only student cannot create a tutor session for CSE 1203", async () => {
      const { data: user } = await cse1205Student.auth.getUser();
      const { error } = await cse1205Student.from("tutor_sessions").insert({
        user_id: user.user!.id,
        course_id: CSE_1203,
        entry_source: "direct",
      });
      expect(error).not.toBeNull();
    });

    it("evidence RPCs reject a non-member course id", async () => {
      const { error: e1 } = await cse1205Student.rpc("get_student_objective_evidence", {
        p_course_id: CSE_1203,
      });
      expect(e1).not.toBeNull();

      const { error: e2 } = await cse1205Student.rpc("get_student_practice_evidence", {
        p_course_id: CSE_1203,
      });
      expect(e2).not.toBeNull();
    });
  });

  describe("unauthenticated access", () => {
    it("an anonymous client cannot call search_course_material", async () => {
      const { error } = await anonClient.rpc("search_course_material", {
        p_course_id: CSE_1203,
        p_query: "anything",
      });
      expect(error).not.toBeNull();
    });

    it("an anonymous client cannot read any tutor_sessions row", async () => {
      const { data } = await anonClient.from("tutor_sessions").select("id").limit(1);
      expect(data ?? []).toHaveLength(0);
    });
  });

  describe("assessment security: active/unsubmitted attempt cannot be reviewed", () => {
    let unsubmittedAttemptId: string;
    // The real assessment's lock state is instructor-owned config, not
    // test fixture state — save/restore it exactly rather than assuming
    // it's unlocked.
    let originalLocked: boolean | null = null;

    beforeAll(async () => {
      const { data: assessment } = await admin
        .from("assessments")
        .select("locked")
        .eq("id", ASSESSMENT_ID)
        .single();
      originalLocked = assessment!.locked;
      if (originalLocked) {
        await admin.from("assessments").update({ locked: false }).eq("id", ASSESSMENT_ID);
      }
    });

    afterAll(async () => {
      // Throwaway attempt cleanup via the service-role client (students
      // have no delete policy on attempts) — never leave test attempts
      // on the real assessment.
      if (unsubmittedAttemptId) {
        await admin.from("attempts").delete().eq("id", unsubmittedAttemptId);
      }
      if (originalLocked) {
        await admin.from("assessments").update({ locked: true }).eq("id", ASSESSMENT_ID);
      }
    });

    it("studentB starts a fresh (unsubmitted) attempt", async () => {
      const { data, error } = await studentB.rpc("start_attempt", {
        p_assessment_id: ASSESSMENT_ID,
      });
      expect(error).toBeNull();
      expect(typeof data).toBe("string");
      unsubmittedAttemptId = data as unknown as string;
    });

    it("get_attempt_mistakes rejects an unsubmitted attempt", async () => {
      const { error } = await studentB.rpc("get_attempt_mistakes", {
        p_attempt_id: unsubmittedAttemptId,
      });
      expect(error).not.toBeNull();
    });

    it("studentA (not the owner) cannot call get_attempt_mistakes on studentB's attempt either", async () => {
      const { error } = await studentA.rpc("get_attempt_mistakes", {
        p_attempt_id: unsubmittedAttemptId,
      });
      expect(error).not.toBeNull();
    });
  });

  describe("assessment security: cannot review someone else's attempt", () => {
    // The real assessment's lock state is instructor-owned config —
    // save/restore it exactly. The submitted attempt itself is a
    // throwaway fixture this suite creates and cleans up, rather than
    // depending on some pre-existing submitted attempt in real data.
    let originalLocked: boolean | null = null;
    let studentASubmittedAttemptId: string;

    beforeAll(async () => {
      const { data: assessment } = await admin
        .from("assessments")
        .select("locked")
        .eq("id", ASSESSMENT_ID)
        .single();
      originalLocked = assessment!.locked;
      if (originalLocked) {
        await admin.from("assessments").update({ locked: false }).eq("id", ASSESSMENT_ID);
      }

      const { data: attemptId, error: startErr } = await studentA.rpc("start_attempt", {
        p_assessment_id: ASSESSMENT_ID,
      });
      if (startErr) throw new Error(`studentA start_attempt failed: ${startErr.message}`);
      const { error: submitErr } = await studentA.rpc("submit_attempt", {
        p_attempt_id: attemptId as unknown as string,
      });
      if (submitErr) throw new Error(`studentA submit_attempt failed: ${submitErr.message}`);
      studentASubmittedAttemptId = attemptId as unknown as string;
    });

    afterAll(async () => {
      if (studentASubmittedAttemptId) {
        await admin.from("attempts").delete().eq("id", studentASubmittedAttemptId);
      }
      if (originalLocked) {
        await admin.from("assessments").update({ locked: true }).eq("id", ASSESSMENT_ID);
      }
    });

    it("studentB cannot read studentA's submitted attempt row at all (RLS)", async () => {
      // The exact forged path the orchestrator's createTutorSession
      // ownership check relies on: RLS-scoped SELECT, not an app-level
      // "does this belong to me" comparison.
      const { data: forged } = await studentB
        .from("attempts")
        .select("id, submitted_at")
        .eq("id", studentASubmittedAttemptId)
        .maybeSingle();
      expect(forged).toBeNull();

      const { error: mistakesError } = await studentB.rpc("get_attempt_mistakes", {
        p_attempt_id: studentASubmittedAttemptId,
      });
      expect(mistakesError).not.toBeNull();
    });
  });

  describe("practice_attempts: answer key is never client-readable", () => {
    it("a direct select on practice_attempts returns nothing (zero client policies)", async () => {
      const { data } = await studentA.from("tutor_sessions").select("id").eq("id", sessionA);
      expect(data).not.toBeNull(); // sanity: session itself IS readable

      // practice_attempts has RLS enabled with NO policies at all —
      // any direct select, even for the owner, returns empty.
      const { data: practiceRows, error } = await studentA
        .from("practice_attempts")
        .select("*")
        .eq("user_id", (await studentA.auth.getUser()).data.user!.id);
      expect(error).toBeNull(); // not an error — just zero visible rows
      expect(practiceRows ?? []).toHaveLength(0);
    });
  });
});
