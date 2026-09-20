import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * dev-student@example.test is no longer a permanent CSE 1203 member
 * (the real roster is now exactly the instructor's 4 real students —
 * see the 2026-09-20 cleanup). Ensure it for this Playwright run only,
 * global-teardown.ts removes it again — same pattern as
 * src/lib/test-support/course-membership.ts for the vitest suite.
 */
const CSE_1203 = "11111111-1111-1111-1111-111111111111";

export default async function globalSetup() {
  process.loadEnvFile(path.resolve(__dirname, "../.env.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SECRET_KEY!;
  const admin = createClient(url, serviceKey);

  const creds = JSON.parse(await readFile(path.resolve(__dirname, "../scripts/.dev-credentials.json"), "utf-8"));
  const { data: users } = await admin.auth.admin.listUsers();
  const student = users.users.find((u) => u.email === creds.student.email);
  if (!student) throw new Error("dev-student fixture account not found");

  // dev-student is a documented synthetic fixture (scripts/create-dev-users.mjs)
  // — never a real production student — so unlike the vitest helper this
  // doesn't need to track "did I add it": teardown always removes it again.
  await admin
    .from("course_members")
    .upsert({ user_id: student.id, course_id: CSE_1203, role: "student" }, { onConflict: "course_id,user_id" });
}
