import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import { ensureCourseMembership, removeCourseMembershipIfAdded } from "../test-support/course-membership";

/**
 * Live verification of Announcements (instructor product pass, Part
 * 11): publish/draft/expiry visibility, and the authorization boundary
 * — a student can never write, and a student outside the course can
 * never read. Isolated throwaway rows only, cleaned up in afterAll.
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

describe.runIf(canRun)("Announcements: visibility + authorization", () => {
  let admin: SupabaseClient<Database>;
  let instructor: SupabaseClient<Database>;
  let student: SupabaseClient<Database>;
  let outsideStudent: SupabaseClient<Database>;
  let instructorUid: string;
  let studentAdded = false;

  const createdIds: string[] = [];

  beforeAll(async () => {
    admin = createClient<Database>(url!, serviceKey!);
    instructor = createClient<Database>(url!, anonKey!);
    student = createClient<Database>(url!, anonKey!);
    outsideStudent = createClient<Database>(url!, anonKey!);

    const [i, s, o] = await Promise.all([
      instructor.auth.signInWithPassword(credentials!.instructors[0]),
      student.auth.signInWithPassword(credentials!.student),
      outsideStudent.auth.signInWithPassword(credentials!.tomorrowStudent),
    ]);
    if (i.error) throw new Error(`instructor sign-in failed: ${i.error.message}`);
    if (s.error) throw new Error(`student sign-in failed: ${s.error.message}`);
    if (o.error) throw new Error(`outsideStudent sign-in failed: ${o.error.message}`);
    instructorUid = (await instructor.auth.getUser()).data.user!.id;

    // The real CSE 1203 roster is now exactly the instructor's real
    // students — ensure this fixture account for this suite only.
    // outsideStudent (tomorrowStudent) must stay NOT a member — this
    // test relies on that exclusion.
    const { data: studentUser } = await student.auth.getUser();
    ({ added: studentAdded } = await ensureCourseMembership(admin, studentUser.user!.id, CSE_1203, "student"));
  });

  afterAll(async () => {
    if (createdIds.length > 0) await admin.from("announcements").delete().in("id", createdIds);
    const { data: studentUser } = await student.auth.getUser();
    await removeCourseMembershipIfAdded(admin, studentUser.user!.id, CSE_1203, studentAdded);
  });

  it("a draft announcement is invisible to students but visible to the instructor", async () => {
    const { data, error } = await instructor
      .from("announcements")
      .insert({ course_id: CSE_1203, title: "TEST draft", body: "draft body", created_by: instructorUid })
      .select("id")
      .single();
    expect(error).toBeNull();
    createdIds.push(data!.id);

    const { data: studentView } = await student.from("announcements").select("id").eq("id", data!.id);
    expect(studentView ?? []).toHaveLength(0);

    const { data: instructorView } = await instructor.from("announcements").select("id").eq("id", data!.id);
    expect(instructorView).toHaveLength(1);
  });

  it("a published, unexpired announcement is visible to a course student", async () => {
    const { data } = await instructor
      .from("announcements")
      .insert({
        course_id: CSE_1203,
        title: "TEST published",
        body: "published body",
        created_by: instructorUid,
        published_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    createdIds.push(data!.id);

    const { data: studentView } = await student.from("announcements").select("id, title").eq("id", data!.id);
    expect(studentView).toHaveLength(1);
    expect(studentView![0].title).toBe("TEST published");
  });

  it("an expired announcement is invisible to students even though it was published", async () => {
    const { data } = await instructor
      .from("announcements")
      .insert({
        course_id: CSE_1203,
        title: "TEST expired",
        body: "expired body",
        created_by: instructorUid,
        published_at: new Date(Date.now() - 60_000).toISOString(),
        expires_at: new Date(Date.now() - 1_000).toISOString(),
      })
      .select("id")
      .single();
    createdIds.push(data!.id);

    const { data: studentView } = await student.from("announcements").select("id").eq("id", data!.id);
    expect(studentView ?? []).toHaveLength(0);
  });

  it("a student outside the course cannot see its published announcements", async () => {
    const { data } = await instructor
      .from("announcements")
      .insert({
        course_id: CSE_1203,
        title: "TEST cross-course",
        body: "should not leak",
        created_by: instructorUid,
        published_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    createdIds.push(data!.id);

    const { data: outsideView } = await outsideStudent.from("announcements").select("id").eq("id", data!.id);
    expect(outsideView ?? []).toHaveLength(0);
  });

  it("a student cannot create, publish, or delete an announcement directly", async () => {
    const { data: forged, error: insertErr } = await student
      .from("announcements")
      .insert({ course_id: CSE_1203, title: "TEST forged", body: "forged", created_by: instructorUid })
      .select("id");
    // RLS blocks the insert outright (no matching policy for students).
    expect(insertErr).not.toBeNull();
    expect(forged).toBeNull();

    // A student also cannot flip an existing draft to published, or delete a real one.
    const { data: draft } = await admin
      .from("announcements")
      .insert({ course_id: CSE_1203, title: "TEST admin draft", body: "x", created_by: instructorUid })
      .select("id")
      .single();
    createdIds.push(draft!.id);

    await student.from("announcements").update({ published_at: new Date().toISOString() }).eq("id", draft!.id);
    const { data: stillDraft } = await admin.from("announcements").select("published_at").eq("id", draft!.id).single();
    expect(stillDraft!.published_at).toBeNull();

    await student.from("announcements").delete().eq("id", draft!.id);
    const { data: stillThere } = await admin.from("announcements").select("id").eq("id", draft!.id).maybeSingle();
    expect(stillThere).not.toBeNull();
  });
});
