import "server-only";
import { cache } from "react";
import { createClient } from "./server";
import type { CourseRole } from "./database.types";

export interface CurrentUser {
  id: string;
  email: string | null;
}

/**
 * The one place in this file that actually calls `auth.getUser()` — a
 * real network round trip to Supabase Auth, not a free cookie decode.
 * `React.cache()` memoizes it per request/render: every helper below
 * still gets a freshly server-verified user, just resolved once per
 * request instead of once per helper (measured: up to 4 redundant
 * `getUser()` calls for a single page render before this — see
 * docs/PERFORMANCE_OPTIMIZATION_2026-09-22.md Phase 2B). This is scoped
 * to Server Component rendering only — `src/proxy.ts`'s own check runs
 * in a separate execution context (middleware) and is deliberately left
 * independent, never trusting this cache or a client-supplied identity.
 */
const getVerifiedUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/** Authentication only — "is anyone signed in," no role resolution. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const user = await getVerifiedUser();
  if (!user) return null;
  return { id: user.id, email: user.email ?? null };
}

/**
 * Display-only profile data (docs/COURSEWORK_LEARNING_ARCHITECTURE.md
 * "PROFILES"). Never used for authorization. Returns null full_name
 * for pre-existing accounts created before this field existed — the
 * caller decides whether to prompt for it, never blocks on it.
 */
export async function getMyFullName(): Promise<string | null> {
  const supabase = await createClient();
  const user = await getVerifiedUser();
  if (!user) return null;
  // Must filter to the caller's own row: an instructor's profiles RLS
  // visibility also includes every student's profile in their courses
  // ("instructors read profiles of students in their courses",
  // 0019_profiles.sql), so an unfiltered select returns multiple rows
  // and .maybeSingle() errors — which this silently swallowed into
  // null, always falling back to the email-only display for instructors.
  const { data } = await supabase.from("profiles").select("full_name").eq("user_id", user.id).maybeSingle();
  return data?.full_name ?? null;
}

/**
 * Owner/admin capability — an extension of instructor authorization,
 * not a parallel role. Resolved via the database function so the check
 * lives in exactly one place (supabase/migrations/0004_instructor_authorization.sql);
 * this is a read for UI presentation, never itself the enforcement —
 * the RPCs it gates re-check ownership internally regardless of what
 * this returns.
 */
export async function isCurrentUserOwner(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("current_user_is_owner");
  if (error) return false;
  return Boolean(data);
}

export interface CourseSummary {
  id: string;
  code: string;
  title: string;
  term: string;
  autoEnroll: boolean;
}

function toCourseSummary(row: {
  id: string;
  code: string;
  title: string;
  term: string;
  auto_enroll: boolean;
}): CourseSummary {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    term: row.term,
    autoEnroll: row.auto_enroll,
  };
}

export interface CourseMembership {
  courseId: string;
  role: CourseRole;
  course: CourseSummary;
}

/**
 * Resolves this user's membership in ONE SPECIFIC course — always
 * scoped by the courseId in the URL, never "whatever course they
 * happen to be in," now that a user can belong to more than one
 * (docs/ARCHITECTURE.md, "account vs. enrollment vs. course context").
 */
export async function getCourseMembership(
  courseId: string,
): Promise<CourseMembership | null> {
  const supabase = await createClient();
  const user = await getVerifiedUser();
  if (!user) return null;

  // Must filter by user_id explicitly, not just course_id — an
  // instructor's RLS visibility into course_members extends to every
  // row in their course (the whole roster), so course_id alone can
  // match more than one row and .maybeSingle() would throw.
  const { data, error } = await supabase
    .from("course_members")
    .select("course_id, role, courses(id, code, title, term, auto_enroll)")
    .eq("course_id", courseId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data || !data.courses) return null;

  return {
    courseId: data.course_id,
    role: data.role,
    course: toCourseSummary(
      data.courses as unknown as {
        id: string;
        code: string;
        title: string;
        term: string;
        auto_enroll: boolean;
      },
    ),
  };
}

/** Every course this user belongs to (any role) — powers "My Courses." */
export async function getMyCourses(): Promise<CourseMembership[]> {
  const supabase = await createClient();
  const user = await getVerifiedUser();
  if (!user) return [];

  // Same reason as getCourseMembership: an instructor's RLS visibility
  // into course_members covers their whole roster, not just their own
  // row, so this needs an explicit user_id filter or it would return
  // one row per OTHER enrolled person too.
  const { data, error } = await supabase
    .from("course_members")
    .select("course_id, role, courses(id, code, title, term, auto_enroll)")
    .eq("user_id", user.id)
    .order("created_at");

  if (error || !data) return [];

  return data
    .filter((row) => row.courses)
    .map((row) => ({
      courseId: row.course_id,
      role: row.role,
      course: toCourseSummary(
        row.courses as unknown as {
          id: string;
          code: string;
          title: string;
          term: string;
          auto_enroll: boolean;
        },
      ),
    }));
}

/** Every course this user instructs — powers the instructor course picker. */
export async function getInstructorCourses(): Promise<CourseSummary[]> {
  const memberships = await getMyCourses();
  return memberships.filter((m) => m.role === "instructor").map((m) => m.course);
}

export interface CourseSummaryWithInstructor extends CourseSummary {
  instructorName: string | null;
}

/**
 * Same as getInstructorCourses(), annotated with each course's display
 * instructor (0049's get_course_instructors()) — useful now that an
 * instructor can create a course themselves and other instructors
 * (who, per the current global-instructor-access model, immediately
 * see it too) benefit from knowing whose course it is. Kept separate
 * from getInstructorCourses()/isInstructorAnywhere() so the hot
 * "does /instructor even open" check never pays for an extra RPC call
 * it doesn't need.
 */
export async function getInstructorCoursesWithNames(): Promise<CourseSummaryWithInstructor[]> {
  const supabase = await createClient();
  const [courses, { data: instructors }] = await Promise.all([
    getInstructorCourses(),
    supabase.rpc("get_course_instructors"),
  ]);
  return courses.map((c) => ({
    ...c,
    instructorName: instructors?.find((i) => i.course_id === c.id)?.instructor_name ?? null,
  }));
}

/**
 * Is this user an instructor of ANY course? Instructor status is
 * currently granted globally (every course, via the email-confirmation
 * trigger — see docs/DECISIONS.md), so this is the right check for
 * "does the /instructor shell open at all," independent of which
 * course they're about to pick inside it.
 */
export async function isInstructorAnywhere(): Promise<boolean> {
  const courses = await getInstructorCourses();
  return courses.length > 0;
}

export type EnrollmentStatus =
  | "enrolled_student"
  | "enrolled_instructor"
  | "pending"
  | "none";

export interface CourseWithStatus extends CourseSummary {
  status: EnrollmentStatus;
  /** Display name only, never an email — see get_course_instructors() (0049). Null if no instructor has a full_name set yet. */
  instructorName: string | null;
}

/** The full catalog, each course annotated with this user's relationship to it — powers "Available Courses." */
export async function getAllCoursesWithStatus(): Promise<CourseWithStatus[]> {
  const supabase = await createClient();
  const user = await getVerifiedUser();
  if (!user) return [];

  const { data: courses, error } = await supabase
    .from("courses")
    .select("id, code, title, term, auto_enroll")
    .order("code");
  if (error || !courses) return [];

  // Explicit user_id filters for the same reason as getCourseMembership
  // / getMyCourses — an instructor's RLS visibility is roster-wide, not
  // self-only, so this must not rely on RLS alone to scope "mine."
  const [{ data: memberships }, { data: pending }, { data: instructors }] = await Promise.all([
    supabase.from("course_members").select("course_id, role").eq("user_id", user.id),
    supabase.from("enrollment_requests").select("course_id").eq("user_id", user.id).eq("status", "pending"),
    // A browsing user has no RLS path to another user's profile until
    // they're actually a course member — get_course_instructors() is
    // SECURITY DEFINER specifically to make "who teaches this" visible
    // on the catalog anyway, names only, never emails.
    supabase.rpc("get_course_instructors"),
  ]);

  return courses.map((c) => {
    const membership = memberships?.find((m) => m.course_id === c.id);
    const hasPending = pending?.some((p) => p.course_id === c.id);
    const instructorName = instructors?.find((i) => i.course_id === c.id)?.instructor_name ?? null;

    let status: EnrollmentStatus = "none";
    if (membership?.role === "instructor") status = "enrolled_instructor";
    else if (membership?.role === "student") status = "enrolled_student";
    else if (hasPending) status = "pending";

    return { ...toCourseSummary(c), status, instructorName };
  });
}
