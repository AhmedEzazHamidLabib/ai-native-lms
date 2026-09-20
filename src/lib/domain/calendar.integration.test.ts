import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import { ensureCourseMembership, removeCourseMembershipIfAdded } from "../test-support/course-membership";

/**
 * Live verification of Calendar + Settings schedule (instructor
 * product pass, Parts 12/13): deterministic Monday/Saturday-style
 * session generation, session annotation, custom events, and the
 * authorization boundary — students can read but never write.
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

describe.runIf(canRun)("Calendar + Settings schedule: generation and authorization", () => {
  let admin: SupabaseClient<Database>;
  let instructor: SupabaseClient<Database>;
  let student: SupabaseClient<Database>;

  // Snapshot the real course's schedule so this test never leaves
  // production state altered.
  let originalSchedule: { start_date: string | null; end_date: string | null; meeting_days: string[]; meeting_start_time: string | null; meeting_end_time: string | null; timezone: string } | null = null;
  let studentAdded = false;

  const createdEventIds: string[] = [];
  const createdAnnouncementIds: string[] = [];

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

    const { data } = await admin
      .from("courses")
      .select("start_date, end_date, meeting_days, meeting_start_time, meeting_end_time, timezone")
      .eq("id", CSE_1203)
      .single();
    originalSchedule = data;
  });

  afterAll(async () => {
    if (createdEventIds.length > 0) await admin.from("course_events").delete().in("id", createdEventIds);
    if (createdAnnouncementIds.length > 0) await admin.from("announcements").delete().in("id", createdAnnouncementIds);
    await admin.from("course_session_notes").delete().eq("course_id", CSE_1203).ilike("title", "TEST%");
    // Restore the real course's schedule exactly as it was before this test ran.
    if (originalSchedule) {
      await admin.from("courses").update(originalSchedule).eq("id", CSE_1203);
    }
    const { data: studentUser } = await student.auth.getUser();
    await removeCourseMembershipIfAdded(admin, studentUser.user!.id, CSE_1203, studentAdded);
  });

  it("student cannot change the course schedule directly", async () => {
    // Deliberately runs before this file gives `student` any CSE 1203
    // membership at all — this is the exact scenario that caught the
    // NULL-check regression fixed in 0046_fix_instructor_check_regression.sql
    // (a caller with ZERO relationship to the course must still be rejected).
    const { error } = await student.rpc("set_course_schedule", {
      p_course_id: CSE_1203,
      p_start_date: "2026-01-01",
      p_end_date: "2026-06-01",
      p_meeting_days: ["monday"],
      p_meeting_start_time: null,
      p_meeting_end_time: null,
      p_timezone: "UTC",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/Not authorized/);
  });

  it("ensures the student fixture is a CSE 1203 member for the remaining read/write boundary tests", async () => {
    // The real CSE 1203 roster is now exactly the instructor's real
    // students — ensure this fixture account for the rest of this
    // suite only, AFTER the non-member check above has already run.
    const { data: studentUser } = await student.auth.getUser();
    ({ added: studentAdded } = await ensureCourseMembership(admin, studentUser.user!.id, CSE_1203, "student"));
  });

  it("instructor sets a schedule and get_course_calendar deterministically generates Monday/Saturday sessions", async () => {
    const { error: setErr } = await instructor.rpc("set_course_schedule", {
      p_course_id: CSE_1203,
      p_start_date: "2026-11-01",
      p_end_date: "2026-11-30",
      p_meeting_days: ["monday", "saturday"],
      p_meeting_start_time: null,
      p_meeting_end_time: null,
      p_timezone: "UTC",
    });
    expect(setErr).toBeNull();

    const { data, error } = await instructor.rpc("get_course_calendar", {
      p_course_id: CSE_1203,
      p_from: "2026-11-01",
      p_to: "2026-11-30",
    });
    expect(error).toBeNull();
    const dayNames = new Set(data!.sessions.map((s) => s.dayName));
    expect(dayNames).toEqual(new Set(["monday", "saturday"]));
    // November 2026: Sundays are the 1st/8th/.../29th, so Mondays are
    // 2,9,16,23,30 (5) and Saturdays are 7,14,21,28 (4) = 9 sessions.
    expect(data!.sessions).toHaveLength(9);
  });

  it("rejects an invalid meeting day", async () => {
    const { error } = await instructor.rpc("set_course_schedule", {
      p_course_id: CSE_1203,
      p_start_date: null,
      p_end_date: null,
      p_meeting_days: ["funday"],
      p_meeting_start_time: null,
      p_meeting_end_time: null,
      p_timezone: "UTC",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/Invalid meeting day/);
  });

  it("student cannot create a course event or session note directly", async () => {
    const { error: eventErr } = await student.rpc("create_course_event", {
      p_course_id: CSE_1203,
      p_event_date: "2026-11-05",
      p_category: "other",
      p_title: "TEST forged event",
      p_details: null,
      p_announcement_id: null,
    });
    expect(eventErr).not.toBeNull();
    expect(eventErr!.message).toMatch(/Not authorized/);

    const { error: noteErr } = await student.rpc("upsert_session_note", {
      p_course_id: CSE_1203,
      p_session_date: "2026-11-02",
      p_title: "TEST forged note",
      p_agenda: null,
      p_related_lecture_id: null,
      p_related_assessment_id: null,
      p_cancelled: false,
      p_announcement_id: null,
    });
    expect(noteErr).not.toBeNull();
    expect(noteErr!.message).toMatch(/Not authorized/);
  });

  it("instructor creates an event, a student can read it, and deleting it is instructor-only", async () => {
    const { data: eventId, error } = await instructor.rpc("create_course_event", {
      p_course_id: CSE_1203,
      p_event_date: "2026-11-10",
      p_category: "exam",
      p_title: "TEST exam event",
      p_details: "bring a calculator",
      p_announcement_id: null,
    });
    expect(error).toBeNull();
    createdEventIds.push(eventId!);

    const { data: studentRead } = await student.from("course_events").select("id, title").eq("id", eventId!);
    expect(studentRead).toHaveLength(1);

    const { error: studentDeleteErr } = await student.rpc("delete_course_event", { p_event_id: eventId! });
    expect(studentDeleteErr).not.toBeNull();

    const { data: stillThere } = await admin.from("course_events").select("id").eq("id", eventId!).maybeSingle();
    expect(stillThere).not.toBeNull();
  });

  it("editing a session note with 'also announce' twice updates the SAME announcement, never creates a second one", async () => {
    const { data: created } = await admin
      .from("announcements")
      .insert({
        course_id: CSE_1203,
        title: "TEST linked announcement v1",
        body: "first version",
        published_at: new Date().toISOString(),
        created_by: (await instructor.auth.getUser()).data.user!.id,
      })
      .select("id")
      .single();
    createdAnnouncementIds.push(created!.id);

    const { data: noteId } = await instructor.rpc("upsert_session_note", {
      p_course_id: CSE_1203,
      p_session_date: "2026-11-16",
      p_title: "TEST session with announcement",
      p_agenda: "agenda text",
      p_related_lecture_id: null,
      p_related_assessment_id: null,
      p_cancelled: false,
      p_announcement_id: created!.id,
    });
    expect(noteId).toBeTruthy();

    const { data: note } = await admin.from("course_session_notes").select("announcement_id").eq("id", noteId!).single();
    expect(note!.announcement_id).toBe(created!.id);

    const { data: countCheck } = await admin.from("announcements").select("id").eq("course_id", CSE_1203).ilike("title", "TEST linked announcement%");
    expect(countCheck).toHaveLength(1); // still exactly one, not duplicated
  });
});
