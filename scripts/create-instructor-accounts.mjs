#!/usr/bin/env node
/**
 * Creates real Supabase Auth accounts for the two allowlisted instructor
 * emails (src/lib/auth/instructor-allowlist.ts) and enrolls them as
 * 'instructor' in the seeded course.
 *
 * These are the user's real email addresses, so this deliberately does
 * NOT invent or reuse a real-world password for them: it generates a
 * fresh, random Supabase Auth credential unrelated to their Google/MSU
 * password, writes it to scripts/.dev-credentials.json (gitignored,
 * never printed to stdout), and that's the ONLY password usable to sign
 * into this app with that email — nothing about their real Google/MSU
 * account is touched or required.
 *
 * Usage: node --experimental-strip-types --env-file=.env.local scripts/create-instructor-accounts.mjs
 */
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { instructorAllowlist } from "../src/lib/auth/instructor-allowlist.ts";

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

async function ensureInstructor(admin, email) {
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
    console.log(`reset password for existing instructor account: ${email}`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;
    console.log(`created instructor account: ${email}`);
  }

  const { error: memberError } = await admin.from("course_members").upsert(
    { course_id: COURSE_ID, user_id: userId, role: "instructor" },
    { onConflict: "course_id,user_id" },
  );
  if (memberError) throw memberError;

  return { email, password, userId, role: "instructor" };
}

async function main() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SECRET_KEY");

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const instructors = [];
  for (const email of instructorAllowlist()) {
    instructors.push(await ensureInstructor(admin, email));
  }

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
    JSON.stringify({ ...existingCredentials, instructors }, null, 2),
  );
  console.log(`Credentials written to ${CREDENTIALS_PATH} (gitignored).`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
