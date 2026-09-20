import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";

/**
 * Live verification of Content management completion (instructor
 * product pass, Part 1/15/16): rename/reorder/archive, dependency-aware
 * delete blocking, and the authorization boundary. Isolated throwaway
 * unit/lecture/material fixtures only — never touches real content.
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

describe.runIf(canRun)("Content management: rename/reorder/archive/delete", () => {
  let admin: SupabaseClient<Database>;
  let instructor: SupabaseClient<Database>;
  let student: SupabaseClient<Database>;

  let unitAId: string;
  let unitBId: string;
  let lectureId: string;
  let materialId: string;

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

    const { data: unitA } = await admin.from("units").insert({ course_id: CSE_1203, title: "TEST Unit A", position: 900 }).select("id").single();
    const { data: unitB } = await admin.from("units").insert({ course_id: CSE_1203, title: "TEST Unit B", position: 901 }).select("id").single();
    unitAId = unitA!.id;
    unitBId = unitB!.id;

    const { data: lecture } = await admin
      .from("lectures")
      .insert({ unit_id: unitAId, title: "TEST Lecture", position: 1 })
      .select("id")
      .single();
    lectureId = lecture!.id;

    const { data: material } = await admin
      .from("materials")
      .insert({ lecture_id: lectureId, kind: "link", title: "TEST Material", position: 1, external_url: "https://example.test" })
      .select("id")
      .single();
    materialId = material!.id;
  });

  afterAll(async () => {
    if (unitAId) await admin.from("units").delete().eq("id", unitAId);
    if (unitBId) await admin.from("units").delete().eq("id", unitBId);
  });

  it("student cannot rename, reorder, archive, or delete any content level", async () => {
    const { error: renameErr } = await student.rpc("rename_unit", { p_unit_id: unitAId, p_title: "forged" });
    expect(renameErr).not.toBeNull();

    const { error: reorderErr } = await student.rpc("reorder_unit", { p_unit_id: unitAId, p_direction: "down" });
    expect(reorderErr).not.toBeNull();

    const { error: archiveErr } = await student.rpc("set_unit_archived", { p_unit_id: unitAId, p_archived: true });
    expect(archiveErr).not.toBeNull();

    const { error: deleteErr } = await student.rpc("delete_unit_if_unused", { p_unit_id: unitBId });
    expect(deleteErr).not.toBeNull();
  });

  it("instructor can rename a unit", async () => {
    const { error } = await instructor.rpc("rename_unit", { p_unit_id: unitAId, p_title: "TEST Unit A Renamed" });
    expect(error).toBeNull();
    const { data } = await admin.from("units").select("title").eq("id", unitAId).single();
    expect(data!.title).toBe("TEST Unit A Renamed");
  });

  it("rejects an empty rename", async () => {
    const { error } = await instructor.rpc("rename_unit", { p_unit_id: unitAId, p_title: "   " });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/empty/);
  });

  it("reorder_unit swaps position with the adjacent unit", async () => {
    const { data: before } = await admin.from("units").select("id, position").in("id", [unitAId, unitBId]).order("position");
    const { error } = await instructor.rpc("reorder_unit", { p_unit_id: unitAId, p_direction: "down" });
    expect(error).toBeNull();
    const { data: after } = await admin.from("units").select("id, position").in("id", [unitAId, unitBId]).order("position");
    // The two positions should now be swapped relative to before.
    expect(after!.map((r) => r.id)).not.toEqual(before!.map((r) => r.id));
  });

  it("archiving a lecture auto-unpublishes it, and restoring does not auto-republish", async () => {
    await admin.from("lectures").update({ published_at: new Date().toISOString() }).eq("id", lectureId);

    const { error: archiveErr } = await instructor.rpc("set_lecture_archived", { p_lecture_id: lectureId, p_archived: true });
    expect(archiveErr).toBeNull();
    const { data: archived } = await admin.from("lectures").select("archived_at, published_at").eq("id", lectureId).single();
    expect(archived!.archived_at).not.toBeNull();
    expect(archived!.published_at).toBeNull();

    const { error: restoreErr } = await instructor.rpc("set_lecture_archived", { p_lecture_id: lectureId, p_archived: false });
    expect(restoreErr).toBeNull();
    const { data: restored } = await admin.from("lectures").select("archived_at, published_at").eq("id", lectureId).single();
    expect(restored!.archived_at).toBeNull();
    expect(restored!.published_at).toBeNull(); // still unpublished — restore never auto-republishes
  });

  it(
    "blocks deleting a unit that still has a lecture, with a human-readable reason",
    async () => {
      const { error } = await instructor.rpc("delete_unit_if_unused", { p_unit_id: unitAId });
      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/lecture.*archive it instead/i);
    },
    15000,
  );

  it("blocks deleting a lecture that still has a material", async () => {
    const { error } = await instructor.rpc("delete_lecture_if_unused", { p_lecture_id: lectureId });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/material.*archive it instead/i);
  });

  it("allows deleting an empty unit with no lectures", async () => {
    const { error } = await instructor.rpc("delete_unit_if_unused", { p_unit_id: unitBId });
    expect(error).toBeNull();
    const { data } = await admin.from("units").select("id").eq("id", unitBId).maybeSingle();
    expect(data).toBeNull();
    unitBId = ""; // already gone — afterAll no-ops on empty id
  });

  it("blocks permanently deleting a material that was ever published", async () => {
    await admin.from("materials").update({ published_at: new Date().toISOString() }).eq("id", materialId);
    const { error } = await instructor.rpc("delete_material_if_unused", { p_material_id: materialId });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/published.*archive it instead/i);
  });
});
