// Phase 1 baseline measurement harness — docs/PERFORMANCE_OPTIMIZATION_2026-09-22.md
//
// Read-only against course content; the only write is a temporary
// course_members row for the dev-student fixture (added/removed exactly
// like e2e/global-setup.ts and src/lib/test-support/course-membership.ts
// already do for the same account). Never invokes the AI Tutor, never
// starts/submits an assessment attempt, never touches a real student.
//
// Run against a LOCAL `next start` server (not production) so the
// numbers isolate application/database round-trip behavior from the
// Vercel-edge/geography layer, which docs/PERFORMANCE_DIAGNOSTIC_2026-09-21.md
// already measured separately (Phase 4 of the optimization pass revisits
// geography specifically).
//
// Usage:
//   PERF_BASE_URL=http://localhost:3100 PERF_LOG_FILE=<server-stdout-log> \
//     node scripts/perf/measure-baseline.mjs [output-label]

import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSyntheticAccount } from "./fixture-safety.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(path.resolve(__dirname, "../../.env.local"));

const BASE_URL = process.env.PERF_BASE_URL || "http://localhost:3100";
const LOG_FILE = process.env.PERF_LOG_FILE;
const OUTPUT_LABEL = process.argv[2] || "baseline";
const CSE_1203 = "11111111-1111-1111-1111-111111111111";

const PAGES = [
  { name: "dashboard", path: "/student" },
  { name: "available-courses", path: "/student/courses" },
  { name: "course-home", path: `/student/courses/${CSE_1203}` },
  { name: "materials", path: `/student/courses/${CSE_1203}/materials` },
  { name: "course-content", path: `/student/courses/${CSE_1203}/course` },
  { name: "assessments-list", path: `/student/courses/${CSE_1203}/assessments` },
  { name: "grades", path: `/student/courses/${CSE_1203}/grades` },
  { name: "announcements", path: `/student/courses/${CSE_1203}/announcements` },
];

async function main() {
  const creds = JSON.parse(
    await readFile(path.resolve(__dirname, "../../scripts/.dev-credentials.json"), "utf-8"),
  );
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
  assertSyntheticAccount(creds.student.email);

  const { data: users } = await admin.auth.admin.listUsers();
  const student = users.users.find((u) => u.email === creds.student.email);
  if (!student) throw new Error("dev-student fixture account not found (scripts/create-dev-users.mjs)");

  const { data: existing } = await admin
    .from("course_members")
    .select("id")
    .eq("user_id", student.id)
    .eq("course_id", CSE_1203)
    .maybeSingle();
  let added = false;
  if (!existing) {
    const { error } = await admin
      .from("course_members")
      .insert({ user_id: student.id, course_id: CSE_1203, role: "student" });
    if (error && error.code !== "23505") throw new Error(`ensure membership failed: ${error.message}`);
    added = true;
  }
  console.log(`[setup] dev-student CSE1203 membership: ${existing ? "already present" : "added for this run"}`);

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const results = [];

  try {
    await page.goto(`${BASE_URL}/login`);
    await page.getByRole("tab", { name: "student", exact: true }).click();
    await page.getByLabel("Email").fill(creds.student.email);
    await page.getByLabel("Password", { exact: true }).fill(creds.student.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/student", { timeout: 15_000 });

    for (const p of PAGES) {
      await page.waitForTimeout(200); // keep server-log windows from overlapping between pages
      const wallStart = Date.now();
      await page.goto(`${BASE_URL}${p.path}`, { waitUntil: "networkidle", timeout: 30_000 });
      const wallEnd = Date.now();

      const timing = await page.evaluate(() => {
        const [nav] = performance.getEntriesByType("navigation");
        if (!nav) return null;
        return {
          ttfb: nav.responseStart - nav.startTime,
          domContentLoaded: nav.domContentLoadedEventEnd - nav.startTime,
          loadEvent: nav.loadEventEnd - nav.startTime,
        };
      });

      results.push({
        name: p.name,
        path: p.path,
        wallStart,
        wallEnd,
        wallMs: wallEnd - wallStart,
        ttfbMs: timing ? Math.round(timing.ttfb) : null,
        domContentLoadedMs: timing ? Math.round(timing.domContentLoaded) : null,
      });
      console.log(`[measured] ${p.name}: wall=${wallEnd - wallStart}ms ttfb=${timing ? Math.round(timing.ttfb) : "n/a"}ms`);
    }
  } finally {
    await browser.close();
    if (added) {
      await admin.from("course_members").delete().eq("user_id", student.id).eq("course_id", CSE_1203);
      console.log("[cleanup] removed temporary dev-student CSE1203 membership");
    }
  }

  let logLines = [];
  if (LOG_FILE) {
    const raw = await readFile(LOG_FILE, "utf-8").catch(() => "");
    logLines = raw
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter((l) => l && l.tag === "PERF_DIAG");
  }

  for (const r of results) {
    const windowLogs = logLines.filter((l) => l.t >= r.wallStart - 50 && l.t <= r.wallEnd + 50);
    r.supabaseCallCount = windowLogs.length;
    r.authGetUserCount = windowLogs.filter((l) => l.path.includes("/auth/v1/user")).length;
    r.totalSupabaseMs = windowLogs.reduce((s, l) => s + l.durationMs, 0);
    r.callsByPath = windowLogs.reduce((acc, l) => {
      acc[l.path] = (acc[l.path] || 0) + 1;
      return acc;
    }, {});
    r.calls = windowLogs.map((l) => ({ path: l.path, durationMs: l.durationMs, t: l.t }));
  }

  const outFile = path.resolve(__dirname, `${OUTPUT_LABEL}-results.json`);
  await writeFile(outFile, JSON.stringify(results, null, 2));
  console.log(`\n[done] wrote ${outFile}`);
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
