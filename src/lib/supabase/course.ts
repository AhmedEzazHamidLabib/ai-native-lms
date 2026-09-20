import "server-only";
import { createClient } from "./server";
import type { CourseRole } from "./database.types";

export interface CurrentUser {
  id: string;
  email: string | null;
}

/** Authentication only — "is anyone signed in," no role resolution. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

  const {
    data: { user },
  } = await supabase.auth.getUser();
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

  const {
    data: { user },
  } = await supabase.auth.getUser();
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
}

/** The full catalog, each course annotated with this user's relationship to it — powers "Available Courses." */
export async function getAllCoursesWithStatus(): Promise<CourseWithStatus[]> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: courses, error } = await supabase
    .from("courses")
    .select("id, code, title, term, auto_enroll")
    .order("code");
  if (error || !courses) return [];

  // Explicit user_id filters for the same reason as getCourseMembership
  // / getMyCourses — an instructor's RLS visibility is roster-wide, not
  // self-only, so this must not rely on RLS alone to scope "mine."
  const { data: memberships } = await supabase
    .from("course_members")
    .select("course_id, role")
    .eq("user_id", user.id);

  const { data: pending } = await supabase
    .from("enrollment_requests")
    .select("course_id")
    .eq("user_id", user.id)
    .eq("status", "pending");

  return courses.map((c) => {
    const membership = memberships?.find((m) => m.course_id === c.id);
    const hasPending = pending?.some((p) => p.course_id === c.id);

    let status: EnrollmentStatus = "none";
    if (membership?.role === "instructor") status = "enrolled_instructor";
    else if (membership?.role === "student") status = "enrolled_student";
    else if (hasPending) status = "pending";

    return { ...toCourseSummary(c), status };
  });
}
