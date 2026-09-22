// Phase 3 pre-implementation verification — docs/PERFORMANCE_OPTIMIZATION_2026-09-22.md
//
// Read-only. Runs the CURRENT 5-step getCourseContent() implementation
// and a CANDIDATE single nested-embed query side by side, against the
// same real, RLS-scoped dev-student session (temporary CSE1203
// membership, same ensure/verify-remove pattern as every other script
// in this pass), and diffs the results field-by-field. Nothing is
// written except the same temporary fixture row every other Phase
// script adds and removes.
//
// STUDENT ROLE ONLY, deliberately (Phase 3.5 hardening). This script
// originally also supported an "instructor" role for RLS-role parity
// checking, using scripts/.dev-credentials.json's `instructors[0]` —
// which is a REAL account (ezaz.labib@gmail.com), not a synthetic
// fixture; there is no synthetic instructor fixture in this project.
// Running that path plus this script's (then-unsafe) global signOut()
// call revoked the real account's active sessions — see
// docs/PERFORMANCE_OPTIMIZATION_2026-09-22.md Phase 3 for what happened
// and Phase 3.5 for the fix. That one-time instructor-role verification
// already ran and is documented in the report; it is not repeated here.
// A future safe re-check would need a synthetic instructor fixture
// (e.g. `dev-instructor@example.test`, added to `instructor_allowlist`
// and `course_members` for CSE 1203 the same way `dev-student` already
// exists) — intentionally not created by this pass, since creating
// accounts/allowlist entries is a real, human-reviewed change, not
// something automated tooling should do on its own.
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSyntheticAccount, safeSignOut } from "./fixture-safety.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(path.resolve(__dirname, "../../.env.local"));
const CSE_1203 = "11111111-1111-1111-1111-111111111111";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const creds = JSON.parse(await readFile(path.resolve(__dirname, "../../scripts/.dev-credentials.json"), "utf-8"));
const account = creds.student;
assertSyntheticAccount(account.email);

const { data: users } = await admin.auth.admin.listUsers();
const student = users.users.find((u) => u.email === account.email);
const fixtureUserId = student.id;
const { data: existing } = await admin
  .from("course_members")
  .select("id")
  .eq("user_id", student.id)
  .eq("course_id", CSE_1203)
  .maybeSingle();
let added = false;
if (!existing) {
  const { error } = await admin.from("course_members").insert({ user_id: student.id, course_id: CSE_1203, role: "student" });
  if (error && error.code !== "23505") throw new Error(`ensure membership failed: ${error.message}`);
  added = true;
}

// Real, RLS-scoped client — same as the app uses, not the admin/service client.
const userClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const { error: signInError } = await userClient.auth.signInWithPassword({
  email: account.email,
  password: account.password,
});
if (signInError) throw signInError;
console.log(`[setup] verifying as student (${account.email})`);

async function oldWay(courseId) {
  const { data: courseRow, error: courseError } = await userClient
    .from("courses")
    .select("id, code, title, term")
    .eq("id", courseId)
    .single();
  if (courseError || !courseRow) throw courseError ?? new Error("Course not found.");

  const { data: unitRows } = await userClient
    .from("units")
    .select("id, course_id, title, position, archived_at")
    .eq("course_id", courseId)
    .order("position");
  const units = unitRows ?? [];

  const unitIds = units.map((u) => u.id);
  const { data: lectureRows } = unitIds.length
    ? await userClient
        .from("lectures")
        .select("id, unit_id, title, position, scheduled_for, published_at, archived_at")
        .in("unit_id", unitIds)
        .order("position")
    : { data: [] };
  const lectures = lectureRows ?? [];

  const lectureIds = lectures.map((l) => l.id);
  const { data: materialRows } = lectureIds.length
    ? await userClient
        .from("materials")
        .select("id, lecture_id, kind, title, position, current_version_id, published_at, archived_at, external_url")
        .in("lecture_id", lectureIds)
        .order("position")
    : { data: [] };
  const materials = materialRows ?? [];

  const versionIds = materials.map((m) => m.current_version_id).filter((id) => id !== null);
  const { data: versionRows } = versionIds.length
    ? await userClient
        .from("material_versions")
        .select(
          "id, material_id, version_number, original_filename, storage_path, uploaded_at, uploaded_by, ingestion_status, ingestion_error, slide_count, rendered_pdf_path, extracted_html",
        )
        .in("id", versionIds)
    : { data: [] };
  const materialVersions = versionRows ?? [];

  return { course: courseRow, units, lectures, materials, materialVersions };
}

async function newWay(courseId) {
  const { data: courseRow, error } = await userClient
    .from("courses")
    .select(
      `id, code, title, term,
       units(
         id, course_id, title, position, archived_at,
         lectures(
           id, unit_id, title, position, scheduled_for, published_at, archived_at,
           materials(
             id, lecture_id, kind, title, position, current_version_id, published_at, archived_at, external_url,
             current_version:material_versions!materials_current_version_fk(
               id, material_id, version_number, original_filename, storage_path, uploaded_at, uploaded_by, ingestion_status, ingestion_error, slide_count, rendered_pdf_path, extracted_html
             )
           )
         )
       )`,
    )
    .eq("id", courseId)
    .single();
  if (error || !courseRow) throw error ?? new Error("Course not found.");

  const units = [...courseRow.units].sort((a, b) => a.position - b.position);
  const lectures = [];
  const materials = [];
  const materialVersions = [];
  for (const u of units) {
    const uLectures = [...(u.lectures ?? [])].sort((a, b) => a.position - b.position);
    for (const l of uLectures) {
      const { materials: lMaterials, ...lectureRow } = l;
      lectures.push(lectureRow);
      for (const m of [...(lMaterials ?? [])].sort((a, b) => a.position - b.position)) {
        const { current_version, ...materialRow } = m;
        materials.push(materialRow);
        if (current_version) materialVersions.push(current_version);
      }
    }
  }
  const course = { id: courseRow.id, code: courseRow.code, title: courseRow.title, term: courseRow.term };
  const unitsOut = units.map((u) => {
    const { lectures, ...rest } = u;
    void lectures;
    return rest;
  });
  return { course, units: unitsOut, lectures, materials, materialVersions };
}

const [oldResult, newResult] = await Promise.all([oldWay(CSE_1203), newWay(CSE_1203)]);

function sortById(arr) {
  return [...arr].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function diffArrays(name, a, b) {
  const as = sortById(a);
  const bs = sortById(b);
  if (as.length !== bs.length) {
    console.log(`[MISMATCH] ${name}: count ${as.length} vs ${bs.length}`);
    return false;
  }
  let ok = true;
  for (let i = 0; i < as.length; i++) {
    const ja = JSON.stringify(as[i], Object.keys(as[i]).sort());
    const jb = JSON.stringify(bs[i], Object.keys(bs[i]).sort());
    if (ja !== jb) {
      console.log(`[MISMATCH] ${name}[${i}] id=${as[i].id}`);
      console.log("  old:", ja);
      console.log("  new:", jb);
      ok = false;
    }
  }
  if (ok) console.log(`[OK] ${name}: ${as.length} rows, identical`);
  return ok;
}

function diffOrder(name, a, b) {
  const ok = a.map((x) => x.id).join(",") === b.map((x) => x.id).join(",");
  console.log(`[${ok ? "OK" : "MISMATCH"}] ${name} ordering identical: ${ok}`);
  return ok;
}

console.log("=== Phase 3 candidate-query verification (real RLS-scoped dev-student session, student role only) ===");
console.log("course:", JSON.stringify(oldResult.course) === JSON.stringify(newResult.course) ? "[OK] identical" : "[MISMATCH]");
let allOk = true;
allOk = diffArrays("units", oldResult.units, newResult.units) && allOk;
allOk = diffOrder("units", oldResult.units, newResult.units) && allOk;
allOk = diffArrays("lectures", oldResult.lectures, newResult.lectures) && allOk;
allOk = diffOrder("lectures", oldResult.lectures, newResult.lectures) && allOk;
allOk = diffArrays("materials", oldResult.materials, newResult.materials) && allOk;
const flatOrderOk = diffOrder("materials (flat array, global order)", oldResult.materials, newResult.materials);
// The app never renders the flat array — every caller filters via
// materialsForLecture(allMaterials, lectureId) first (verified by
// grep across src/). What actually matters for behavior is whether
// each lecture's own material order matches once filtered that way —
// check that explicitly rather than assuming the flat-array mismatch
// above is harmless.
let perLectureOk = true;
for (const lectureId of [...new Set(oldResult.lectures.map((l) => l.id))]) {
  const oldForLecture = oldResult.materials.filter((m) => m.lecture_id === lectureId).map((m) => m.id);
  const newForLecture = newResult.materials.filter((m) => m.lecture_id === lectureId).map((m) => m.id);
  const ok = oldForLecture.join(",") === newForLecture.join(",");
  console.log(`[${ok ? "OK" : "MISMATCH"}] materials order within lecture ${lectureId}: ${ok}`);
  perLectureOk = perLectureOk && ok;
}
console.log(
  `[info] flat-array global order identical: ${flatOrderOk} (expected false if lectures interleave — harmless since no caller reads the flat order); per-lecture order identical: ${perLectureOk} (this is what the app actually renders)`,
);
allOk = perLectureOk && allOk;
allOk = diffArrays("materialVersions", oldResult.materialVersions, newResult.materialVersions) && allOk;

console.log("\nCounts — old vs new:");
console.log(
  JSON.stringify(
    {
      units: [oldResult.units.length, newResult.units.length],
      lectures: [oldResult.lectures.length, newResult.lectures.length],
      materials: [oldResult.materials.length, newResult.materials.length],
      materialVersions: [oldResult.materialVersions.length, newResult.materialVersions.length],
    },
    null,
    2,
  ),
);

console.log(`\n=== OVERALL: ${allOk ? "SEMANTICALLY EQUIVALENT" : "MISMATCH FOUND"} ===`);

await safeSignOut(userClient);
if (added) {
  await admin.from("course_members").delete().eq("user_id", fixtureUserId).eq("course_id", CSE_1203);
  console.log("[cleanup] removed temporary dev-student CSE1203 membership");
}
if (!allOk) process.exit(1);
