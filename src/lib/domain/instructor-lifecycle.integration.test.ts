import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";

/**
 * Live regression coverage for the instructor revocation/re-authorization
 * lifecycle bug (0049_instructor_lifecycle_and_course_creation.sql) and
 * the course-creation/discovery features shipped alongside the fix.
 *
 * Uses a single throwaway instructor-candidate Auth account, created
 * and deleted by this suite — deliberately different from how a REAL
 * revoked instructor is handled (their Auth identity is never touched;
 * see the migration's own comment). Deleting this specific account at
 * teardown is safe precisely because it's a synthetic fixture this
 * suite created for itself, not a real person's account.
 */
try {
  process.loadEnvFile(path.resolve(__dirname, "../../../.env.local"));
} catch {
  // handled by canRun below
}

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

describe.runIf(canRun)("Instructor lifecycle: revoke / re-authorize / course creation", () => {
  let admin: SupabaseClient<Database>;
  let owner: SupabaseClient<Database>;
  let student: SupabaseClient<Database>;

  let candidateEmail: string;
  let candidatePassword: string;
  let candidateUserId: string;
  const createdCourseIds: string[] = [];

  beforeAll(async () => {
    admin = createClient<Database>(url!, serviceKey!);
    owner = createClient<Database>(url!, anonKey!);
    student = createClient<Database>(url!, anonKey!);

    const [o, s] = await Promise.all([
      owner.auth.signInWithPassword(credentials!.instructors[0]),
      student.auth.signInWithPassword(credentials!.student),
    ]);
    if (o.error) throw new Error(`owner sign-in failed: ${o.error.message}`);
    if (s.error) throw new Error(`student sign-in failed: ${s.error.message}`);

    candidateEmail = `test-instructor-lifecycle-${Date.now()}@example.test`;
    candidatePassword = `Test-${Date.now()}-Pw!`;

    // email_confirm: true — this deliberately reproduces the exact
    // reported scenario: an Auth account that is ALREADY verified
    // before the owner ever authorizes/revokes/re-authorizes it (the
    // one-time email-confirmation trigger has already fired, or in
    // this synthetic case never needs to at all).
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: candidateEmail,
      password: candidatePassword,
      email_confirm: true,
    });
    if (createErr || !created.user) throw new Error(`could not create candidate: ${createErr?.message}`);
    candidateUserId = created.user.id;
  });

  afterAll(async () => {
    if (createdCourseIds.length > 0) {
      await admin.from("course_members").delete().in("course_id", createdCourseIds);
      await admin.from("courses").delete().in("id", createdCourseIds);
    }
    await admin.from("course_members").delete().eq("user_id", candidateUserId);
    await admin.from("instructor_allowlist").delete().eq("email", candidateEmail);
    // Throwaway fixture this suite created for itself — see file header
    // for why deleting THIS specific Auth identity is safe and does not
    // contradict "never delete an Auth identity on revocation."
    await admin.auth.admin.deleteUser(candidateUserId);
  });

  it("CASE A: authorizing an already-verified Auth account grants instructor access immediately", async () => {
    const { error } = await owner.rpc("add_instructor_email", { p_email: candidateEmail });
    expect(error).toBeNull();

    const candidate = createClient<Database>(url!, anonKey!);
    const { error: signInErr } = await candidate.auth.signInWithPassword({ email: candidateEmail, password: candidatePassword });
    expect(signInErr).toBeNull();

    // Explicit user_id filter — an instructor's course_members RLS
    // visibility is roster-wide (every member of their course), not
    // self-scoped, so filtering by role alone would also return every
    // OTHER instructor's row in any course this account can now see.
    const { data: memberships } = await candidate
      .from("course_members")
      .select("course_id, role")
      .eq("user_id", candidateUserId)
      .eq("role", "instructor");
    expect(memberships?.length ?? 0).toBeGreaterThan(0);
  });

  it("CASE B: revoking removes instructor access", async () => {
    const { error } = await owner.rpc("remove_instructor_email", { p_email: candidateEmail });
    expect(error).toBeNull();

    const candidate = createClient<Database>(url!, anonKey!);
    await candidate.auth.signInWithPassword({ email: candidateEmail, password: candidatePassword });
    const { data: memberships } = await candidate
      .from("course_members")
      .select("course_id, role")
      .eq("user_id", candidateUserId)
      .eq("role", "instructor");
    expect(memberships ?? []).toHaveLength(0);
  });

  it("CASE D: a revoked account cannot call an instructor-only RPC directly", async () => {
    const candidate = createClient<Database>(url!, anonKey!);
    await candidate.auth.signInWithPassword({ email: candidateEmail, password: candidatePassword });
    const { error } = await candidate.rpc("create_course", {
      p_code: "TEST-DENIED",
      p_title: "Should never be created",
      p_term: "TEST",
    });
    expect(error).not.toBeNull();
  });

  it("CASE C: re-authorizing the SAME email restores access via the EXISTING Auth identity — this is the exact regression", async () => {
    const { error } = await owner.rpc("add_instructor_email", { p_email: candidateEmail });
    expect(error).toBeNull();

    // Never a duplicate allowlist row (email is the primary key; this
    // also confirms add_instructor_email didn't error trying to insert
    // a second one).
    const { data: allowlistRows } = await admin.from("instructor_allowlist").select("email").eq("email", candidateEmail);
    expect(allowlistRows).toHaveLength(1);

    const candidate = createClient<Database>(url!, anonKey!);
    const { error: signInErr, data: signInData } = await candidate.auth.signInWithPassword({
      email: candidateEmail,
      password: candidatePassword,
    });
    expect(signInErr).toBeNull();
    expect(signInData.user!.id).toBe(candidateUserId); // the SAME Auth identity — no duplicate account was ever needed

    const { data: memberships } = await candidate
      .from("course_members")
      .select("course_id, role")
      .eq("user_id", candidateUserId)
      .eq("role", "instructor");
    expect(memberships?.length ?? 0).toBeGreaterThan(0);

    const { data: allCourses } = await admin.from("courses").select("id");
    expect(memberships?.length).toBe(allCourses?.length); // exactly one instructor row per course, never duplicated
  });

  it("CASE E + F: an authorized instructor can create a course; a student cannot", async () => {
    const candidate = createClient<Database>(url!, anonKey!);
    await candidate.auth.signInWithPassword({ email: candidateEmail, password: candidatePassword });

    const { data: courseId, error } = await candidate.rpc("create_course", {
      p_code: "TEST 9001",
      p_title: "TEST Instructor Lifecycle Course",
      p_term: "TEST Term",
    });
    expect(error).toBeNull();
    createdCourseIds.push(courseId!);

    const { data: courseRow } = await admin.from("courses").select("created_by").eq("id", courseId!).single();
    expect(courseRow!.created_by).toBe(candidateUserId); // ownership derived from the authenticated session, not client input

    const { data: creatorMembership } = await admin
      .from("course_members")
      .select("role")
      .eq("course_id", courseId!)
      .eq("user_id", candidateUserId)
      .single();
    expect(creatorMembership!.role).toBe("instructor");

    // The other real, currently-authorized instructor also gets access —
    // matching the existing "every instructor sees every course" model
    // instead of silently creating an invisible-to-others course.
    const { data: ownerUser } = await owner.auth.getUser();
    const { data: ownerMembership } = await admin
      .from("course_members")
      .select("role")
      .eq("course_id", courseId!)
      .eq("user_id", ownerUser.user!.id)
      .maybeSingle();
    expect(ownerMembership?.role).toBe("instructor");

    // A student cannot create a course, even calling the RPC directly.
    const { error: studentErr } = await student.rpc("create_course", {
      p_code: "TEST-STUDENT-DENIED",
      p_title: "Should never be created",
      p_term: "TEST",
    });
    expect(studentErr).not.toBeNull();
  });

  it("CASE G + H: course discovery shows the correct instructor name, name-only, to both a student and another instructor — without granting privileges", async () => {
    const courseId = createdCourseIds[0];

    const { data: studentView, error: studentErr } = await student.rpc("get_course_instructors");
    expect(studentErr).toBeNull();
    const studentRow = studentView!.find((r) => r.course_id === courseId);
    expect(studentRow).toBeTruthy();
    expect(JSON.stringify(studentRow)).not.toMatch(/@/); // never an email

    const { data: ownerView, error: ownerErr } = await owner.rpc("get_course_instructors");
    expect(ownerErr).toBeNull();
    expect(ownerView!.find((r) => r.course_id === courseId)).toBeTruthy();

    // The owner already has instructor course_members on this course
    // (case E/F), but merely seeing/being a member of a course someone
    // else created must never rewrite who created it.
    const { data: courseRow } = await admin.from("courses").select("created_by").eq("id", courseId).single();
    expect(courseRow!.created_by).toBe(candidateUserId);
  });

  it("CASE I: revoking an instructor who owns a course does not delete the course, and does not remove a co-instructor's access", async () => {
    const courseId = createdCourseIds[0];
    const { error } = await owner.rpc("remove_instructor_email", { p_email: candidateEmail });
    expect(error).toBeNull();

    const { data: stillThere } = await admin.from("courses").select("id, created_by").eq("id", courseId).maybeSingle();
    expect(stillThere).not.toBeNull();
    expect(stillThere!.created_by).toBe(candidateUserId); // historical attribution survives revocation

    const { data: candidateMembership } = await admin
      .from("course_members")
      .select("id")
      .eq("course_id", courseId)
      .eq("user_id", candidateUserId)
      .maybeSingle();
    expect(candidateMembership).toBeNull(); // the revoked instructor's own access is gone

    const { data: ownerUser } = await owner.auth.getUser();
    const { data: ownerStillMember } = await admin
      .from("course_members")
      .select("id")
      .eq("course_id", courseId)
      .eq("user_id", ownerUser.user!.id)
      .maybeSingle();
    expect(ownerStillMember).not.toBeNull(); // no destructive cascade to a co-instructor
  });

  it("CASE J: re-authorizing again after owning a course does not duplicate any record", async () => {
    const { error } = await owner.rpc("add_instructor_email", { p_email: candidateEmail });
    expect(error).toBeNull();

    const { data: allowlistRows } = await admin.from("instructor_allowlist").select("email").eq("email", candidateEmail);
    expect(allowlistRows).toHaveLength(1);

    const { data: membershipRows } = await admin.from("course_members").select("id").eq("user_id", candidateUserId);
    const { data: allCourses } = await admin.from("courses").select("id");
    expect(membershipRows?.length).toBe(allCourses?.length); // exactly one row per course, still no duplicates
  });
});
