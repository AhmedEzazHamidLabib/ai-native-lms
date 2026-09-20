import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import { ensureCourseMembership, removeCourseMembershipIfAdded } from "../test-support/course-membership";

/**
 * Live verification of the Course Members directory (Part 6) and the
 * instructor-only per-student evidence RPCs (Part 8/15's explicit
 * checklist item: a student in a DIFFERENT course must not enumerate
 * another course's roster; names only, never emails).
 */
try {
  process.loadEnvFile(path.resolve(__dirname, "../../../.env.local"));
} catch {
  // handled by canRun below
}

const CSE_1203 = "11111111-1111-1111-1111-111111111111";

interface DevCredentials {
  student: { email: string; password: string };
  tomorrowStudent: { email: string; password: string };
  instructors: { email: string; password: string }[];
}

async function loadCredentials(): Promise<DevCredentials | null> {
  try {
    const raw = await readFile(path.resolve(__dirname, "../../../scripts/.dev-credentials.json"), "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed.student || !parsed.tomorrowStudent || !parsed.instructors?.length) return null;
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

describe.runIf(canRun)("Course Members directory + instructor-only student evidence", () => {
  let studentIn1203: SupabaseClient<Database>;
  let studentNotIn1203: SupabaseClient<Database>; // CSE 1205, not a CSE 1203 member
  let instructor: SupabaseClient<Database>;
  let admin: SupabaseClient<Database>;
  let uidIn1203: string;
  let studentAdded = false;

  beforeAll(async () => {
    studentIn1203 = createClient<Database>(url!, anonKey!);
    studentNotIn1203 = createClient<Database>(url!, anonKey!);
    instructor = createClient<Database>(url!, anonKey!);
    admin = createClient<Database>(url!, serviceKey!);

    const [a, c, i] = await Promise.all([
      studentIn1203.auth.signInWithPassword(credentials!.student),
      studentNotIn1203.auth.signInWithPassword(credentials!.tomorrowStudent),
      instructor.auth.signInWithPassword(credentials!.instructors[0]),
    ]);
    if (a.error) throw new Error(`student sign-in failed: ${a.error.message}`);
    if (c.error) throw new Error(`tomorrowStudent sign-in failed: ${c.error.message}`);
    if (i.error) throw new Error(`instructor sign-in failed: ${i.error.message}`);
    uidIn1203 = (await studentIn1203.auth.getUser()).data.user!.id;

    // The real CSE 1203 roster is now exactly the instructor's real
    // students — ensure this fixture account for this suite only.
    ({ added: studentAdded } = await ensureCourseMembership(admin, uidIn1203, CSE_1203, "student"));
  });

  afterAll(async () => {
    await removeCourseMembershipIfAdded(admin, uidIn1203, CSE_1203, studentAdded);
  });

  it("a course member sees the directory with full names, never emails, on any row", async () => {
    const { data, error } = await studentIn1203.rpc("list_course_members_directory", { p_course_id: CSE_1203 });
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    expect(data!.some((r) => r.user_id === uidIn1203)).toBe(true);
    const serialized = JSON.stringify(data);
    expect(serialized).not.toMatch(/@/); // no email-shaped string anywhere in the payload
  });

  it("a student NOT enrolled in the course cannot enumerate its membership", async () => {
    const { error } = await studentNotIn1203.rpc("list_course_members_directory", { p_course_id: CSE_1203 });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/Not authorized/);
  });

  it("get_student_objective_evidence_for_instructor rejects a student caller", async () => {
    const { error } = await studentIn1203.rpc("get_student_objective_evidence_for_instructor", {
      p_course_id: CSE_1203,
      p_user_id: uidIn1203,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/Not authorized/);
  });

  it("instructor can read a real student's objective evidence for their own course", async () => {
    const { error } = await instructor.rpc("get_student_objective_evidence_for_instructor", {
      p_course_id: CSE_1203,
      p_user_id: uidIn1203,
    });
    expect(error).toBeNull();
  });
});
