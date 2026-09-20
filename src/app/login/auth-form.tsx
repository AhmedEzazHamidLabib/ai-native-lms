"use client";

import { useActionState, useState } from "react";
import {
  instructorSignIn,
  instructorSignUp,
  studentSignIn,
  studentSignUp,
} from "@/lib/supabase/actions";
import { initialAuthActionState } from "@/lib/supabase/auth-types";
import { cn } from "@/lib/utils/cn";

type Role = "student" | "instructor";
type Mode = "signin" | "signup";

const COPY: Record<Role, Record<Mode, { title: string; description: string; submitLabel: string }>> = {
  student: {
    signin: {
      title: "Sign in",
      description: "Welcome back.",
      submitLabel: "Sign in",
    },
    signup: {
      title: "Create your account",
      description: "Join the course as a student.",
      submitLabel: "Create account",
    },
  },
  instructor: {
    signin: {
      title: "Instructor sign in",
      description: "Welcome back.",
      submitLabel: "Sign in",
    },
    signup: {
      title: "Instructor sign up",
      description: "Authorized course staff only.",
      submitLabel: "Create account",
    },
  },
};

export function AuthForm({
  initialRole = "student",
  initialMode = "signin",
}: {
  initialRole?: Role;
  initialMode?: Mode;
}) {
  const [role, setRole] = useState<Role>(initialRole);
  const [mode, setMode] = useState<Mode>(initialMode);

  const [studentSignInState, studentSignInAction, studentSignInPending] =
    useActionState(studentSignIn, initialAuthActionState);
  const [studentSignUpState, studentSignUpAction, studentSignUpPending] =
    useActionState(studentSignUp, initialAuthActionState);
  const [instructorSignInState, instructorSignInAction, instructorSignInPending] =
    useActionState(instructorSignIn, initialAuthActionState);
  const [instructorSignUpState, instructorSignUpAction, instructorSignUpPending] =
    useActionState(instructorSignUp, initialAuthActionState);

  const combos = {
    student: { signin: [studentSignInState, studentSignInAction, studentSignInPending] as const,
               signup: [studentSignUpState, studentSignUpAction, studentSignUpPending] as const },
    instructor: { signin: [instructorSignInState, instructorSignInAction, instructorSignInPending] as const,
                  signup: [instructorSignUpState, instructorSignUpAction, instructorSignUpPending] as const },
  } as const;

  const [state, formAction, pending] = combos[role][mode];
  const copy = COPY[role][mode];

  return (
    <div className="max-w-sm w-full">
      <div
        role="tablist"
        aria-label="Account type"
        className="grid grid-cols-2 gap-1 p-1 mb-6 bg-black/[0.03] rounded-lg"
      >
        {(["student", "instructor"] as const).map((r) => (
          <button
            key={r}
            role="tab"
            type="button"
            aria-selected={role === r}
            onClick={() => setRole(r)}
            className={cn(
              "rounded-md py-2 text-sm font-medium transition-colors duration-[180ms] capitalize",
              role === r ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-text",
            )}
          >
            {r}
          </button>
        ))}
      </div>

      <div className="flex items-baseline justify-between mb-1">
        <h1 className="font-display text-2xl text-ink tracking-tight">{copy.title}</h1>
        <button
          type="button"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="text-sm text-azure hover:underline underline-offset-2"
        >
          {mode === "signin" ? "Create an account" : "Sign in instead"}
        </button>
      </div>
      <p className="text-sm text-muted mb-8">{copy.description}</p>

      <form key={`${role}-${mode}`} action={formAction} className="flex flex-col gap-4">
        {mode === "signup" && role === "student" && (
          <label className="block">
            <span className="block text-xs text-muted mb-1.5">Full name</span>
            <input
              type="text"
              name="fullName"
              required
              autoComplete="name"
              maxLength={200}
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-surface focus-visible:border-azure"
            />
          </label>
        )}
        <label className="block">
          <span className="block text-xs text-muted mb-1.5">Email</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className="w-full border border-border rounded-md px-3 py-2 text-sm bg-surface focus-visible:border-azure"
          />
        </label>
        <label className="block">
          <span className="block text-xs text-muted mb-1.5">Password</span>
          <input
            type="password"
            name="password"
            required
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className="w-full border border-border rounded-md px-3 py-2 text-sm bg-surface focus-visible:border-azure"
          />
        </label>
        {mode === "signup" && (
          <label className="block">
            <span className="block text-xs text-muted mb-1.5">Confirm password</span>
            <input
              type="password"
              name="confirmPassword"
              required
              autoComplete="new-password"
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-surface focus-visible:border-azure"
            />
          </label>
        )}

        {mode === "signup" && role === "instructor" && (
          <p className="text-xs text-muted -mt-1">
            We&apos;ll email you a link to confirm your address before your
            account is active.
          </p>
        )}

        {state.error && (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        )}
        {state.info && (
          <p role="status" className="text-sm text-azure">
            {state.info}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-2 inline-flex items-center justify-center rounded-md bg-ink text-warm-paper px-4 py-2.5 text-sm font-medium hover:bg-azure transition-colors duration-[180ms] disabled:opacity-40"
        >
          {pending ? "Please wait…" : copy.submitLabel}
        </button>
      </form>
    </div>
  );
}
