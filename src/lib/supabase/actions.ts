"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createClient } from "./server";
import { createAdminClient } from "./admin";
import { isInstructorAnywhere } from "./course";
import type { Database } from "./database.types";
import type { AuthActionState } from "./auth-types";

const credentialsSchema = z
  .object({
    email: z.string().email("Enter a valid email address."),
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match.",
    path: ["confirmPassword"],
  });

// Full name is required for new student signups (see
// docs/COURSEWORK_LEARNING_ARCHITECTURE.md "PROFILES") — display data
// only, never checked for access control. Existing accounts created
// before this requirement are handled by a separate profile-completion
// prompt, not this schema.
const studentSignUpSchema = z
  .object({
    fullName: z.string().trim().min(1, "Enter your full name.").max(200),
    email: z.string().email("Enter a valid email address."),
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match.",
    path: ["confirmPassword"],
  });

const signInSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

async function currentOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

// ---------------------------------------------------------------------
// Student
// ---------------------------------------------------------------------

/**
 * Ordinary email + password, no verification step — students can start
 * using the product immediately. Account identity only: this does not
 * enroll them in a course (see docs/ARCHITECTURE.md, "account vs
 * enrollment"). Authorization for a signed-up student is simply "role
 * defaults to none until enrolled" — there is no field here a client
 * could set to become an instructor.
 */
export async function studentSignUp(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = studentSignUpSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message, info: null };
  }

  const admin = createAdminClient();
  const { error: createError } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true, // students get in immediately — no OTP required
  });

  if (createError) {
    if (createError.message.toLowerCase().includes("already been registered")) {
      return {
        error: "An account with this email already exists. Try signing in instead.",
        info: null,
      };
    }
    if (createError.status === 429) {
      return {
        error: "Too many sign-ups at once. Please wait a moment and try again.",
        info: null,
      };
    }
    return { error: "Could not create your account. Please try again.", info: null };
  }

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (signInError) {
    if (signInError.status === 429) {
      return {
        error:
          "Your account was created, but sign-in is temporarily rate-limited. Wait a moment, then sign in — no need to sign up again.",
        info: null,
      };
    }
    return {
      error: "Account created — please sign in.",
      info: null,
    };
  }

  // Best-effort: full_name is display data, never an authorization
  // input (see docs/COURSEWORK_LEARNING_ARCHITECTURE.md "PROFILES") —
  // a failure here must never block the account the student just
  // successfully created and signed into.
  try {
    await supabase.rpc("upsert_my_full_name", { p_full_name: parsed.data.fullName });
  } catch {
    // ignore — profile completion banner will offer another chance
  }

  redirect("/student");
}

export async function studentSignIn(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message, info: null };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.status === 429) {
      return {
        error: "Too many attempts right now. Please wait a moment and try again.",
        info: null,
      };
    }
    return { error: "Incorrect email or password.", info: null };
  }

  redirect("/student");
}

// ---------------------------------------------------------------------
// Instructor
// ---------------------------------------------------------------------

/**
 * Instructor signup requires proof of email ownership before the
 * account becomes usable. The allowlist (instructor_allowlist table)
 * only makes an email ELIGIBLE — it is checked here read-only via the
 * admin client (there's no signed-in user yet to run an RLS-scoped
 * query as). The account is created unconfirmed; Supabase's own OTP
 * email is what proves ownership, and the database trigger in
 * 0004_instructor_authorization.sql is what actually grants access
 * once that happens — never this function.
 */
export async function instructorSignUp(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message, info: null };
  }

  const admin = createAdminClient();
  const { data: allowlistRow } = await admin
    .from("instructor_allowlist")
    .select("email")
    .eq("email", parsed.data.email.toLowerCase())
    .maybeSingle();

  if (!allowlistRow) {
    return {
      error: "This email isn't set up for instructor access. Contact your course administrator.",
      info: null,
    };
  }

  const { data: existingList } = await admin.auth.admin.listUsers();
  const existing = existingList?.users.find(
    (u) => u.email?.toLowerCase() === parsed.data.email.toLowerCase(),
  );

  if (existing?.email_confirmed_at) {
    return {
      error: "This account already exists and is verified — try signing in instead.",
      info: null,
    };
  }

  if (existing) {
    // Re-attempting signup before verifying — let them set a new
    // password and get a fresh verification email.
    await admin.auth.admin.updateUserById(existing.id, {
      password: parsed.data.password,
    });
  } else {
    const { error: createError } = await admin.auth.admin.createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      email_confirm: false, // instructor accounts must verify email ownership
    });
    if (createError) {
      return { error: "Could not create your account. Please try again.", info: null };
    }
  }

  const origin = await currentOrigin();
  const anonClient = createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
  const { error: otpError } = await anonClient.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${origin}/auth/confirm`,
    },
  });
  if (otpError) {
    // The account exists either way (created above, or already existed) —
    // only the email send failed. Most commonly Supabase's built-in dev
    // mailer's send rate limit (see docs/DECISIONS.md); a real SMTP
    // provider in production wouldn't hit this. Distinguishing this from
    // "signup failed" matters: retrying signup would just hit the
    // "already exists" branch above.
    const rateLimited = otpError.status === 429;
    return {
      error: rateLimited
        ? "Your account was created, but too many verification emails were sent recently. Wait a few minutes and try signing up again to get a new one."
        : "Could not send a verification email. Please try again shortly.",
      info: null,
    };
  }

  return {
    error: null,
    info: "Check your email to verify your account. Once verified, you can sign in as usual.",
  };
}

/**
 * Normal instructor login. No OTP here — only at signup. Authorization
 * is resolved fresh from course_members after sign-in, never from
 * which button the user pressed.
 */
export async function instructorSignIn(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message, info: null };
  }

  const supabase = await createClient();
  const { error: authError } = await supabase.auth.signInWithPassword(parsed.data);
  if (authError) {
    if (authError.status === 429) {
      return {
        error: "Too many attempts right now. Please wait a moment and try again.",
        info: null,
      };
    }
    return { error: "Incorrect email or password.", info: null };
  }

  const isInstructor = await isInstructorAnywhere();
  if (!isInstructor) {
    // scope: 'local' — denying this login must not sign this account
    // out of its other active sessions/devices.
    await supabase.auth.signOut({ scope: "local" });
    return { error: "This account doesn't have instructor access.", info: null };
  }

  redirect("/instructor");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
