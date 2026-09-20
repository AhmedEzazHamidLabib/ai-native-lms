import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";

const CSE_1203 = "11111111-1111-1111-1111-111111111111";

export default async function globalTeardown() {
  process.loadEnvFile(path.resolve(__dirname, "../.env.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SECRET_KEY!;
  const admin = createClient(url, serviceKey);

  const creds = JSON.parse(await readFile(path.resolve(__dirname, "../scripts/.dev-credentials.json"), "utf-8"));
  const { data: users } = await admin.auth.admin.listUsers();
  const student = users.users.find((u) => u.email === creds.student.email);
  if (!student) return;

  // Clean up any throwaway attempts this run created on the REAL
  // Learning Diagnostic before removing membership (attempts/course_members
  // have no cascade tying them together the other way).
  const { data: diagnostic } = await admin
    .from("assessments")
    .select("id")
    .eq("course_id", CSE_1203)
    .eq("is_diagnostic", true)
    .maybeSingle();
  if (diagnostic) {
    await admin.from("attempts").delete().eq("assessment_id", diagnostic.id).eq("user_id", student.id);
  }
  await admin.from("tutor_preferences").delete().eq("user_id", student.id);
  await admin.from("course_members").delete().eq("user_id", student.id).eq("course_id", CSE_1203);
}
