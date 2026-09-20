import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { ensureCourseMembership, removeCourseMembershipIfAdded } from "../test-support/course-membership";

/**
 * Live authorization verification against the hosted dev Supabase
 * project. Signs in as real accounts and exercises real RPCs/RLS — not
 * a mock, not an assertion about the SQL.
 *
 * Requires:
 *   - NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 *   - scripts/.dev-credentials.json with a verified owner, a verified
 *     non-owner instructor, and a student account (see
 *     docs/IMPLEMENTATION.md for how those were established this pass)
 *
 * Skips (not fails) if either is missing, so `npm run test` stays safe
 * without a live project configured.
 */
try {
  process.loadEnvFile(path.resolve(__dirname, "../../../.env.local"));
} catch {
  // No .env.local yet, or Node too old — canRun below handles it.
}

const COURSE_ID = "11111111-1111-1111-1111-111111111111";

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
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const credentials = await loadCredentials();

const canRun = Boolean(url && anonKey && serviceKey && credentials?.instructors?.length === 2);

describe.runIf(canRun)("Live authorization: hosted dev project", () => {
  let ownerClient: SupabaseClient<Database>;
  let instructorClient: SupabaseClient<Database>; // non-owner
  let studentClient: SupabaseClient<Database>;
  let anonClient: SupabaseClient<Database>; // never signed in
  let admin: SupabaseClient<Database>;
  let studentAddedToCourse = false;

  beforeAll(async () => {
    ownerClient = createClient<Database>(url!, anonKey!);
    instructorClient = createClient<Database>(url!, anonKey!);
    studentClient = createClient<Database>(url!, anonKey!);
    anonClient = createClient<Database>(url!, anonKey!);
    admin = createClient<Database>(url!, serviceKey!);

    const [owner, nonOwner] = credentials!.instructors;

    const { error: ownerErr } = await ownerClient.auth.signInWithPassword(owner);
    if (ownerErr) throw new Error(`owner sign-in failed: ${ownerErr.message}`);

    const { error: instErr } = await instructorClient.auth.signInWithPassword(nonOwner);
    if (instErr) throw new Error(`instructor sign-in failed: ${instErr.message}`);

    const { error: studErr } = await studentClient.auth.signInWithPassword(
      credentials!.student,
    );
    if (studErr) throw new Error(`student sign-in failed: ${studErr.message}`);

    // The real CSE 1203 roster is now exactly the instructor's real
    // students (see docs/HANDOFF_NEXT_SESSION.md) — this fixture
    // account is no longer a permanent member, so ensure it for the
    // duration of this suite only.
    const { data: studentUser } = await studentClient.auth.getUser();
    const { added } = await ensureCourseMembership(admin, studentUser.user!.id, COURSE_ID, "student");
    studentAddedToCourse = added;
  });

  afterAll(async () => {
    const { data: studentUser } = await studentClient.auth.getUser();
    await removeCourseMembershipIfAdded(admin, studentUser.user!.id, COURSE_ID, studentAddedToCourse);
  });

  describe("owner/admin capability", () => {
    it("is true only for the owner", async () => {
      const { data: ownerIsOwner } = await ownerClient.rpc("current_user_is_owner");
      expect(ownerIsOwner).toBe(true);

      const { data: instructorIsOwner } = await instructorClient.rpc(
        "current_user_is_owner",
      );
      expect(instructorIsOwner).toBe(false);

      const { data: studentIsOwner } = await studentClient.rpc("current_user_is_owner");
      expect(studentIsOwner).toBe(false);
    });
  });

  describe("instructor allowlist management (add/remove RPCs)", () => {
    const testEmail = `rls-test-${Date.now()}@example.com`;

    afterAll(async () => {
      // Best-effort cleanup regardless of which assertion failed.
      await ownerClient.rpc("remove_instructor_email", { p_email: testEmail });
    });

    it("blocks a non-owner instructor from adding an instructor", async () => {
      const { error } = await instructorClient.rpc("add_instructor_email", {
        p_email: testEmail,
      });
      expect(error).not.toBeNull();
    });

    it("blocks a student from adding an instructor", async () => {
      const { error } = await studentClient.rpc("add_instructor_email", {
        p_email: `${testEmail}-student-attempt`,
      });
      expect(error).not.toBeNull();
    });

    it("blocks an unauthenticated client from adding an instructor", async () => {
      const { error } = await anonClient.rpc("add_instructor_email", {
        p_email: `${testEmail}-anon-attempt`,
      });
      expect(error).not.toBeNull();
    });

    it("lets the owner add an instructor email, and it appears in the status list", async () => {
      const { error } = await ownerClient.rpc("add_instructor_email", {
        p_email: testEmail,
      });
      expect(error).toBeNull();

      const { data } = await ownerClient.rpc("list_instructor_status");
      expect(data?.some((r) => r.email === testEmail)).toBe(true);
    });

    it("blocks a non-owner instructor from viewing instructor status", async () => {
      const { error } = await instructorClient.rpc("list_instructor_status");
      expect(error).not.toBeNull();
    });

    it("protects the owner row from removal, even by the owner", async () => {
      const owner = credentials!.instructors[0].email;
      const { error } = await ownerClient.rpc("remove_instructor_email", {
        p_email: owner,
      });
      expect(error).not.toBeNull();
    });

    it("blocks a non-owner instructor from removing anyone", async () => {
      const { error } = await instructorClient.rpc("remove_instructor_email", {
        p_email: testEmail,
      });
      expect(error).not.toBeNull();
    });

    it("owner removing an instructor actually revokes it, not just hides it", async () => {
      const { error } = await ownerClient.rpc("remove_instructor_email", {
        p_email: testEmail,
      });
      expect(error).toBeNull();

      const { data } = await ownerClient.rpc("list_instructor_status");
      expect(data?.some((r) => r.email === testEmail)).toBe(false);
    });
  });

  describe("content management (instructor) / draft-publish visibility (student)", () => {
    let unitId: string;
    let lectureId: string;
    let materialId: string;

    afterAll(async () => {
      if (unitId) {
        await ownerClient.from("units").delete().eq("id", unitId);
      }
    });

    it("lets the instructor create a unit, lecture, and material", async () => {
      const { data: unit, error: unitError } = await ownerClient
        .from("units")
        .insert({ course_id: COURSE_ID, title: "RLS test unit", position: 999 })
        .select("id")
        .single();
      expect(unitError).toBeNull();
      unitId = unit!.id;

      const { data: lecture, error: lectureError } = await ownerClient
        .from("lectures")
        .insert({ unit_id: unitId, title: "RLS test lecture", position: 1 })
        .select("id")
        .single();
      expect(lectureError).toBeNull();
      lectureId = lecture!.id;

      const { data: material, error: materialError } = await ownerClient
        .from("materials")
        .insert({
          lecture_id: lectureId,
          kind: "link",
          title: "RLS test material",
          position: 1,
          external_url: "https://example.edu/test",
        })
        .select("id")
        .single();
      expect(materialError).toBeNull();
      materialId = material!.id;
    });

    it("blocks the student from creating a unit, lecture, or material", async () => {
      const { error: unitErr } = await studentClient
        .from("units")
        .insert({ course_id: COURSE_ID, title: "rejected", position: 998 });
      expect(unitErr).not.toBeNull();

      const { error: lectureErr } = await studentClient
        .from("lectures")
        .insert({ unit_id: unitId, title: "rejected", position: 2 });
      expect(lectureErr).not.toBeNull();

      const { error: materialErr } = await studentClient.from("materials").insert({
        lecture_id: lectureId,
        kind: "link",
        title: "rejected",
        position: 2,
        external_url: "https://example.edu/rejected",
      });
      expect(materialErr).not.toBeNull();
    });

    it("hides the draft lecture and its material from the student", async () => {
      const { data: lectureRows } = await studentClient
        .from("lectures")
        .select("id")
        .eq("id", lectureId);
      expect(lectureRows).toHaveLength(0);

      const { data: materialRows } = await studentClient
        .from("materials")
        .select("id")
        .eq("id", materialId);
      expect(materialRows).toHaveLength(0);
    });

    it("reveals the lecture and material to the student once both are published", async () => {
      const now = new Date().toISOString();
      await ownerClient.from("lectures").update({ published_at: now }).eq("id", lectureId);
      await ownerClient
        .from("materials")
        .update({ published_at: now })
        .eq("id", materialId);

      const { data: lectureRows } = await studentClient
        .from("lectures")
        .select("id")
        .eq("id", lectureId);
      expect(lectureRows).toHaveLength(1);

      const { data: materialRows } = await studentClient
        .from("materials")
        .select("id")
        .eq("id", materialId);
      expect(materialRows).toHaveLength(1);
    });

    it("still blocks the student from editing the now-visible lecture", async () => {
      const { data } = await studentClient
        .from("lectures")
        .update({ title: "hijacked" })
        .eq("id", lectureId)
        .select("id");
      expect(data?.length ?? 0).toBe(0);

      const { data: check } = await ownerClient
        .from("lectures")
        .select("title")
        .eq("id", lectureId)
        .single();
      expect(check?.title).toBe("RLS test lecture");
    });
  });
});
