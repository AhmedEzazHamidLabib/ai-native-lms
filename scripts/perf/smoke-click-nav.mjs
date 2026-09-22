// Phase 3.6 review: does an actual <Link> CLICK (not a direct
// page.goto()) still navigate correctly now that the course sidebar
// has prefetch={false}? The Phase 1-3 benchmark only ever did direct
// URL navigations, which never exercised Next.js's client-side Link
// transition path. Read-only; reuses the dev-student fixture with the
// same tracked add/remove discipline as every other perf script.
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSyntheticAccount } from "./fixture-safety.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(path.resolve(__dirname, "../../.env.local"));
const BASE_URL = "http://localhost:3100";
const CSE_1203 = "11111111-1111-1111-1111-111111111111";
const creds = JSON.parse(await readFile(path.resolve(__dirname, "../../scripts/.dev-credentials.json"), "utf-8"));
assertSyntheticAccount(creds.student.email);

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const { data: users } = await admin.auth.admin.listUsers();
const student = users.users.find((u) => u.email === creds.student.email);
const { data: existing } = await admin
  .from("course_members")
  .select("id")
  .eq("user_id", student.id)
  .eq("course_id", CSE_1203)
  .maybeSingle();
let added = false;
if (!existing) {
  await admin.from("course_members").insert({ user_id: student.id, course_id: CSE_1203, role: "student" });
  added = true;
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${BASE_URL}/login`);
await page.getByRole("tab", { name: "student", exact: true }).click();
await page.getByLabel("Email").fill(creds.student.email);
await page.getByLabel("Password", { exact: true }).fill(creds.student.password);
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForURL("**/student", { timeout: 15_000 });

const results = [];
for (const label of ["Materials", "Grades", "Announcements", "Calendar"]) {
  // Fresh page load each time (isolates each click test from the last).
  await page.goto(`${BASE_URL}/student/courses/${CSE_1203}`);
  const locator = page.getByRole("link", { name: label, exact: true });
  const count = await locator.count();
  const href = count === 1 ? await locator.getAttribute("href") : null;
  try {
    await Promise.all([
      page.waitForURL((u) => u.pathname.toLowerCase().includes(label.toLowerCase()), { timeout: 10_000 }),
      locator.click({ timeout: 10_000 }),
    ]);
    results.push({ clicked: label, matchCount: count, href, endedUpAt: page.url(), ok: true });
  } catch (err) {
    results.push({ clicked: label, matchCount: count, href, endedUpAtOnFailure: page.url(), error: String(err).slice(0, 300), ok: false });
  }
}

console.log(JSON.stringify(results, null, 2));
const allOk = results.every((r) => r.ok);
console.log(allOk ? "[OK] every sidebar link click navigated correctly" : "[FAIL] navigation mismatch found");

await browser.close();
if (added) {
  await admin.from("course_members").delete().eq("user_id", student.id).eq("course_id", CSE_1203);
}
if (!allOk) process.exit(1);
