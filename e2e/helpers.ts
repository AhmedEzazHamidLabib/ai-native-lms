import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const CSE_1203 = "11111111-1111-1111-1111-111111111111";

export interface DevCredentials {
  student: { email: string; password: string };
  studentB: { email: string; password: string };
  tomorrowStudent: { email: string; password: string };
  instructors: { email: string; password: string }[];
}

export async function loadCredentials(): Promise<DevCredentials> {
  const raw = await readFile(path.resolve(__dirname, "../scripts/.dev-credentials.json"), "utf-8");
  return JSON.parse(raw);
}

/**
 * Attempts are one-per-user (unique on assessment_id, user_id) — rerunning
 * this spec (desktop then mobile, or twice locally) against the same
 * synthetic dev-student account would otherwise land on the already-
 * submitted results page instead of a fresh Start-test screen. Reset
 * before each run instead of assuming a clean slate.
 */
export async function resetDiagnosticAttempt(studentEmail: string) {
  process.loadEnvFile(path.resolve(__dirname, "../.env.local"));
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
  const { data: users } = await admin.auth.admin.listUsers();
  const student = users.users.find((u) => u.email === studentEmail);
  if (!student) return;
  const { data: diagnostic } = await admin
    .from("assessments")
    .select("id")
    .eq("course_id", CSE_1203)
    .eq("is_diagnostic", true)
    .maybeSingle();
  if (!diagnostic) return;
  await admin.from("attempts").delete().eq("assessment_id", diagnostic.id).eq("user_id", student.id);
}

export async function loginAs(page: Page, role: "student" | "instructor", email: string, password: string) {
  await page.goto("/login");
  await page.getByRole("tab", { name: role, exact: true }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(role === "instructor" ? "**/instructor" : "**/student", { timeout: 15_000 });
}
