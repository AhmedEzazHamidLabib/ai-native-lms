#!/usr/bin/env node
/**
 * Creates a throwaway STUDENT account on the hosted dev project,
 * enrolled in the seeded CSE 1203 course. Used for RLS/authorization
 * testing (src/lib/supabase/rls.integration.test.ts) — in particular,
 * for proving an ordinary account is denied instructor access.
 *
 * Instructor accounts are handled separately by
 * scripts/create-instructor-accounts.mjs, which only ever provisions
 * the allowlisted emails in src/lib/auth/instructor-allowlist.ts — this
 * script must never create a course_members row with role='instructor',
 * to keep that invariant real rather than accidental.
 *
 * Usage: node --env-file=.env.local scripts/create-dev-users.mjs
 */
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const COURSE_ID = "11111111-1111-1111-1111-111111111111";
const CREDENTIALS_PATH = path.resolve(
  import.meta.dirname,
  ".dev-credentials.json",
);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set. See .env.example.`);
    process.exit(1);
  }
  return value;
}

async function ensureStudent(admin, email) {
  const password = randomBytes(18).toString("base64url");

  const { data: list, error: listError } = await admin.auth.admin.listUsers();
  if (listError) throw listError;
  const existing = list.users.find((u) => u.email === email);

  let userId;
  if (existing) {
    const { data, error } = await admin.auth.admin.updateUserById(
      existing.id,
      { password },
    );
    if (error) throw error;
    userId = data.user.id;
    console.log(`reset password for existing student: ${email}`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;
    console.log(`created student: ${email}`);
  }

  const { error: memberError } = await admin.from("course_members").upsert(
    { course_id: COURSE_ID, user_id: userId, role: "student" },
    { onConflict: "course_id,user_id" },
  );
  if (memberError) throw memberError;

  return { email, password, userId, role: "student" };
}

async function main() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SECRET_KEY");

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const student = await ensureStudent(admin, "dev-student@example.test");

  let existingCredentials = {};
  try {
    existingCredentials = JSON.parse(
      await readFile(CREDENTIALS_PATH, "utf-8"),
    );
  } catch {
    // No file yet — fine.
  }

  await writeFile(
    CREDENTIALS_PATH,
    JSON.stringify({ ...existingCredentials, student }, null, 2),
  );
  console.log(`Credentials written to ${CREDENTIALS_PATH} (gitignored).`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
