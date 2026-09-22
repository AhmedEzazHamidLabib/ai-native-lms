// One-off verification: does disabling client JS (so Next.js Link
// prefetching can never fire) make the auth.getUser() burst disappear?
// Confirms/refutes the prefetch hypothesis from the Phase 1 baseline run.
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
// Tracked add/remove, not an unconditional upsert+delete — never
// touch a membership row this script didn't itself create (same
// discipline as measure-baseline.mjs and verify-nested-query.mjs).
const { data: existingMembership } = await admin
  .from("course_members")
  .select("id")
  .eq("user_id", student.id)
  .eq("course_id", CSE_1203)
  .maybeSingle();
let addedMembership = false;
if (!existingMembership) {
  await admin.from("course_members").insert({ user_id: student.id, course_id: CSE_1203, role: "student" });
  addedMembership = true;
}

const browser = await chromium.launch();
const context = await browser.newContext({ javaScriptEnabled: false });
const page = await context.newPage();

await page.goto(`${BASE_URL}/login`);
await page.getByRole("tab", { name: "student", exact: true }).click();
await page.getByLabel("Email").fill(creds.student.email);
await page.getByLabel("Password", { exact: true }).fill(creds.student.password);
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForURL("**/student", { timeout: 15_000 });
await page.waitForTimeout(300);

const navStart = Date.now();
await page.goto(`${BASE_URL}/student/courses/${CSE_1203}/course`);
const navDone = Date.now();
await page.waitForTimeout(1500);
const settleEnd = Date.now();

console.log(JSON.stringify({ navStart, navDone, settleEnd }));

await browser.close();
if (addedMembership) {
  await admin.from("course_members").delete().eq("user_id", student.id).eq("course_id", CSE_1203);
}
