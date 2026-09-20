import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";

/**
 * Live verification of the Course Intelligence status/rebuild
 * authorization boundary (Part 14/15) against the hosted dev project.
 * Deliberately does NOT trigger a real Sonnet call against a real
 * objective — that costs real money and would mutate real CSE 1203
 * production state. It only exercises the read-only status RPC and the
 * rejection paths (student caller; an objective with no chunked
 * material yet), which are side-effect-free.
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
const credentials = await loadCredentials();

const canRun = Boolean(url && anonKey && credentials);

describe.runIf(canRun)("Course Intelligence status/rebuild: authorization boundary", () => {
  let instructor: SupabaseClient<Database>;
  let student: SupabaseClient<Database>;

  beforeAll(async () => {
    instructor = createClient<Database>(url!, anonKey!);
    student = createClient<Database>(url!, anonKey!);
    const [i, s] = await Promise.all([
      instructor.auth.signInWithPassword(credentials!.instructors[0]),
      student.auth.signInWithPassword(credentials!.student),
    ]);
    if (i.error) throw new Error(`instructor sign-in failed: ${i.error.message}`);
    if (s.error) throw new Error(`student sign-in failed: ${s.error.message}`);
  });

  it("instructor can read course intelligence status for their own course", async () => {
    const { data, error } = await instructor.rpc("get_course_intelligence_status", { p_course_id: CSE_1203 });
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });

  it("student cannot read course intelligence status", async () => {
    const { error } = await student.rpc("get_course_intelligence_status", { p_course_id: CSE_1203 });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/Not authorized/);
  });

  it("student cannot trigger a regeneration", async () => {
    const { data: status } = await instructor.rpc("get_course_intelligence_status", { p_course_id: CSE_1203 });
    const anyObjective = status![0].learning_objective_id;
    const { error } = await student.rpc("start_intelligence_regeneration", { p_learning_objective_id: anyObjective });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/Not authorized/);
  });

  it("instructor regeneration is blocked (no side effects) for an objective with no chunked material yet", async () => {
    const { data: status } = await instructor.rpc("get_course_intelligence_status", { p_course_id: CSE_1203 });
    const noMaterial = status!.find((r) => r.chunk_count === 0);
    expect(noMaterial).toBeDefined(); // "DOS & Command Line" as of this writing — see docs

    const { error } = await instructor.rpc("start_intelligence_regeneration", {
      p_learning_objective_id: noMaterial!.learning_objective_id,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/No source material/);
  });

  it("student cannot write or fail an intelligence record directly", async () => {
    const { data: status } = await instructor.rpc("get_course_intelligence_status", { p_course_id: CSE_1203 });
    const anyObjective = status![0].learning_objective_id;

    const { error: writeErr } = await student.rpc("write_learning_objective_intelligence", {
      p_learning_objective_id: anyObjective,
      p_canonical_explanation: "forged",
      p_key_facts: [],
      p_common_misconceptions: [],
      p_analogies: [],
      p_teaching_progression: [],
      p_practice_generation_guidance: "",
      p_source_hash: "forged",
      p_model: "forged",
    });
    expect(writeErr).not.toBeNull();
    expect(writeErr!.message).toMatch(/Not authorized/);

    const { error: failErr } = await student.rpc("fail_learning_objective_intelligence", {
      p_learning_objective_id: anyObjective,
      p_error: "forged",
    });
    expect(failErr).not.toBeNull();
    expect(failErr!.message).toMatch(/Not authorized/);
  });
});
