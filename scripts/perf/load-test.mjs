// Phase 5 — staged, established-session classroom-capacity load test.
// docs/PERFORMANCE_OPTIMIZATION_2026-09-22.md
//
// Establishes ONE real authenticated session (via the actual /login
// form, synthetic dev-student fixture only) ONCE, outside any timed
// window, then reuses its cookies for concurrent GET requests across
// the same 8 read-only pages every prior phase has benchmarked. No
// fresh sign-ins occur during any timed stage -- this deliberately
// tests server-side navigation concurrency, not Auth's login-burst
// behavior (a separate, unaddressed concern by design, per the
// project's own documented Supabase Auth rate-limit history).
//
// Never touches: AI Tutor, assessment start/submit, grade mutation,
// material upload/delete, admin/instructor mutation, enrollment
// beyond the single tracked dev-student fixture row, real credentials.
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, setGlobalDispatcher } from "undici";
import { assertSyntheticAccount } from "./fixture-safety.mjs";

// Node's default global fetch dispatcher has a per-origin connection
// pool too small for this test's own top stage (50 concurrent) --
// empirically confirmed: the same 50-concurrent request set that
// showed a 14-15s p95 "cliff" under the default dispatcher completed
// cleanly at ~3s p95 with a larger pool. Without this, the test would
// measure its own client-side queuing, not the server. Sized well
// above the largest stage so the pool itself is never the constraint.
setGlobalDispatcher(new Agent({ connections: 200, keepAliveTimeout: 30_000, keepAliveMaxTimeout: 30_000 }));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(path.resolve(__dirname, "../../.env.local"));

const BASE_URL = process.env.PERF_BASE_URL || "http://localhost:3100";
const CSE_1203 = "11111111-1111-1111-1111-111111111111";
const STAGES = [1, 5, 10, 25, 50];
const REQUEST_TIMEOUT_MS = 15_000;
const ABORT_ERROR_RATE = 0.05;
const ABORT_P95_MULTIPLIER = 5;

const PAGES = [
  `/student`,
  `/student/courses`,
  `/student/courses/${CSE_1203}`,
  `/student/courses/${CSE_1203}/materials`,
  `/student/courses/${CSE_1203}/course`,
  `/student/courses/${CSE_1203}/assessments`,
  `/student/courses/${CSE_1203}/grades`,
  `/student/courses/${CSE_1203}/announcements`,
];

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

async function fireOne(cookieHeader, path) {
  const start = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { Cookie: cookieHeader },
      redirect: "manual",
      signal: controller.signal,
    });
    const latencyMs = performance.now() - start;
    // Drain the body so the connection is actually considered complete,
    // mirroring what a real navigation waits for.
    await res.arrayBuffer().catch(() => {});
    // Only a real 200 counts as success. None of these 8 pages should
    // ever redirect for an authenticated user -- a 3xx here almost
    // certainly means the reused session cookie was rejected and
    // proxy.ts bounced the request to /login, which is a failure for
    // this test's purposes, not a benign redirect.
    return { path, status: res.status, latencyMs, ok: res.status === 200, timedOut: false };
  } catch (err) {
    const latencyMs = performance.now() - start;
    const timedOut = controller.signal.aborted;
    return { path, status: 0, latencyMs, ok: false, timedOut, error: String(err).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

async function runStage(concurrency, cookieHeader) {
  const requests = Array.from({ length: concurrency }, (_, i) => PAGES[i % PAGES.length]);
  const results = await Promise.all(requests.map((p) => fireOne(cookieHeader, p)));

  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const errors = results.filter((r) => !r.ok);
  const status429 = results.filter((r) => r.status === 429);
  const timeouts = results.filter((r) => r.timedOut);
  const status5xx = results.filter((r) => r.status >= 500);
  const statusDist = {};
  for (const r of results) {
    const key = r.status === 0 ? (r.timedOut ? "timeout" : "network_error") : String(r.status);
    statusDist[key] = (statusDist[key] || 0) + 1;
  }

  return {
    concurrency,
    requestCount: results.length,
    successCount: results.length - errors.length,
    errorCount: errors.length,
    errorRate: errors.length / results.length,
    count429: status429.length,
    countTimeouts: timeouts.length,
    count5xx: status5xx.length,
    statusDistribution: statusDist,
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    max: latencies[latencies.length - 1] ?? null,
    min: latencies[0] ?? null,
  };
}

async function main() {
  const creds = JSON.parse(await readFile(path.resolve(__dirname, "../../scripts/.dev-credentials.json"), "utf-8"));
  assertSyntheticAccount(creds.student.email);
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

  const { data: users } = await admin.auth.admin.listUsers();
  const student = users.users.find((u) => u.email === creds.student.email);
  if (!student) throw new Error("dev-student fixture account not found");

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
  console.log(`[setup] dev-student CSE1203 membership: ${existing ? "already present" : "added for this run"}`);

  // ---- Session establishment (ONCE, outside any timed stage) ----
  console.log("[setup] establishing one real authenticated session via /login...");
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`);
  await page.getByRole("tab", { name: "student", exact: true }).click();
  await page.getByLabel("Email").fill(creds.student.email);
  await page.getByLabel("Password", { exact: true }).fill(creds.student.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/student", { timeout: 15_000 });

  const cookies = await context.cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  await browser.close();
  console.log(`[setup] session established, ${cookies.length} cookies captured. No further sign-ins will occur.`);

  // ---- Stage 1 baseline (also the first stage's own result) ----
  const stageResults = [];
  let baselineP50 = null;

  for (const concurrency of STAGES) {
    if (stageResults.length > 0) {
      // Cooldown between stages so one stage's held connections
      // (Supabase pooler, Vercel function instances) have time to
      // release before the next stage's burst arrives -- isolates
      // "can this concurrency level work" from "does back-to-back
      // bursts with zero recovery time cause pileup," which are
      // different questions.
      console.log(`[cooldown] waiting 15s before next stage...`);
      await new Promise((r) => setTimeout(r, 15_000));
    }
    console.log(`\n[stage] concurrency=${concurrency} starting...`);
    const result = await runStage(concurrency, cookieHeader);
    stageResults.push(result);
    console.log(
      `[stage] concurrency=${concurrency} -> success=${result.successCount}/${result.requestCount} ` +
        `errorRate=${(result.errorRate * 100).toFixed(1)}% p50=${result.p50?.toFixed(0)}ms p95=${result.p95?.toFixed(0)}ms ` +
        `max=${result.max?.toFixed(0)}ms 429s=${result.count429} timeouts=${result.countTimeouts} 5xx=${result.count5xx}`,
    );
    console.log(`[stage] status distribution:`, JSON.stringify(result.statusDistribution));

    if (concurrency === 1) {
      baselineP50 = result.p50;
    }

    const abortReasons = [];
    if (result.errorRate > ABORT_ERROR_RATE) abortReasons.push(`error rate ${(result.errorRate * 100).toFixed(1)}% > ${ABORT_ERROR_RATE * 100}%`);
    if (result.count429 > 0) abortReasons.push(`${result.count429} HTTP 429 response(s)`);
    if (baselineP50 && result.p95 && result.p95 > baselineP50 * ABORT_P95_MULTIPLIER) {
      abortReasons.push(`p95 ${result.p95.toFixed(0)}ms > ${ABORT_P95_MULTIPLIER}x baseline p50 (${baselineP50.toFixed(0)}ms)`);
    }
    if (result.count5xx > 0) abortReasons.push(`${result.count5xx} HTTP 5xx response(s)`);

    if (abortReasons.length > 0) {
      console.log(`\n[ABORT] Stopping before next stage. Reasons: ${abortReasons.join("; ")}`);
      break;
    }
  }

  const outFile = path.resolve(__dirname, "load-test-results.json");
  await writeFile(outFile, JSON.stringify({ baseUrl: BASE_URL, stages: stageResults, baselineP50 }, null, 2));
  console.log(`\n[done] wrote ${outFile}`);

  if (added) {
    await admin.from("course_members").delete().eq("user_id", student.id).eq("course_id", CSE_1203);
    console.log("[cleanup] removed temporary dev-student CSE1203 membership");
  }
}

main().catch(async (err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
