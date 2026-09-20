# Architecture

## Shape

```
Course
  └─ Unit
       └─ Lecture (published_at: null | timestamp — draft vs visible)
            └─ Material (kind: pptx | pdf | document | link | video)
                 └─ MaterialVersion (immutable source, one per upload)
                      └─ Slide (extracted, ordered, provenance-tagged)
```

One object model (`src/lib/domain/types.ts`) is shared by both the
instructor and student experiences (Invariant 8). The instructor's
Content section is a CMS over these same rows; the student's Course page
is a read-only, publication-filtered projection of them. Neither side
has its own parallel model.

## The fixture → reality seam

Every Milestone 1 screen is built against `src/lib/domain/types.ts` and
pure selectors in `src/lib/domain/selectors.ts` (`unitsForCourse`,
`publishedOnly`, etc.). Right now those selectors run over
`src/lib/domain/fixtures.ts` (clearly marked dev-only). Once Supabase is
wired in, the only thing that changes is what's passed into those same
selectors — a Supabase query result shaped like `Unit[]`, `Lecture[]`,
etc. instead of a fixture array. Components do not change shape.

## Publication semantics

`published_at` is a nullable timestamp on both `lectures` and
`materials`, not a boolean. `null` means draft. A student-facing query
filters `published_at is not null`; an instructor-facing query doesn't
filter at all. This is enforced twice, independently:

- **UI**: student routes call `notFound()` for any lecture without
  `published_at` (see `src/app/student/course/lecture/[lectureId]/page.tsx`).
- **RLS**: `supabase/migrations/0002_rls_policies.sql` enforces the same
  rule at the database layer, which is the one that actually matters
  (Invariant 3 — hiding a button is not authorization).

## Authorization shape

- **Identity**: Supabase Auth. The `auth.users` UUID is the only
  identity our schema stores — no separate `profiles` table needed yet,
  no email-as-identity anywhere in a foreign key.
- **Account vs. enrollment vs. course context**: creating an account
  (`auth.users`), being enrolled in *a* course, and which course a page
  is currently scoped to are three different things. An account can
  exist with zero course memberships (a fresh signup lands on Available
  Courses, not an error). `src/lib/supabase/course.ts` exposes
  `getCurrentUser()` (authenticated?) separately from
  `getCourseMembership(courseId)` (enrolled in *this specific* course,
  and as what role?), `getMyCourses()` (every course this user belongs
  to, any role), and `getAllCoursesWithStatus()` (the whole catalog,
  each course annotated with this user's relationship to it — enrolled,
  pending, or none). There is no single "current membership" any more —
  every read is explicitly scoped by a `courseId`, because a user can
  belong to more than one course.
- **Membership/role**: `course_members(course_id, user_id, role)` is the
  one join table that answers "can this person see this course, and as
  what role." Every RLS policy on every other table ultimately traces
  back to a `course_members` lookup (via the `current_course_role()`
  SQL helper). A user's *intent* to join a course that requires approval
  lives in a separate table, `enrollment_requests` — it is never a
  `course_members` row with some kind of "pending" role. See
  `docs/DECISIONS.md`, "Multi-course enrollment."
- **Who can ever become an instructor**: `instructor_allowlist` (email,
  is_owner) — a database table, not application source. RLS on it has
  no policies at all for `authenticated`/`anon`; every read and write
  goes through SECURITY DEFINER functions
  (`supabase/migrations/0004_instructor_authorization.sql`) that
  re-derive the caller's authorization from `auth.uid()` inside
  Postgres, not from anything the client sends. An email on this table
  is only *eligible* — it grants nothing by itself.
- **How instructor access is actually granted**: a trigger on
  `auth.users`, firing when `email_confirmed_at` transitions from null
  to set (i.e., Supabase itself just verified that email), grants
  `course_members(role='instructor')` if that email is allowlisted. No
  application code path grants instructor access — not the signup
  form, not the login action, only this trigger. See
  `docs/DECISIONS.md` for why and how this was verified.
- **Owner/admin**: a capability (`is_owner`) on an allowlist row, not a
  separate role or login flow. `current_user_is_owner()` gates the
  instructor-management functions and the "Manage instructors" nav
  link's visibility — the former is the boundary, the latter is UX.
- **Enforcement**: RLS on every table, always. `src/lib/supabase/server.ts`
  creates a client scoped to the signed-in user (RLS applies).
  `src/lib/supabase/admin.ts` creates a service-role client that bypasses
  RLS — its use is confined to the ingestion pipeline and the two
  account-creation paths (which must set `email_confirm` explicitly
  before any session exists), never to serving an authenticated user's
  own request (see `docs/DECISIONS.md`).
- **Files**: the `course-materials` Storage bucket is private. Storage
  RLS policies (`0003_storage.sql`) mirror the row-level rules: instructors
  get full access to their course's folder; students only get objects
  that are the *current* version of a *published* material on a
  *published* lecture.

## Ingestion boundary

Upload and extraction are separate events (see `docs/DECISIONS.md` for
why, and the execution model). `src/lib/ingestion/pptx.ts` is a pure,
framework-independent parser — it takes bytes, returns ordered slides.
It has no knowledge of Supabase, HTTP, or the database, so the boundary
could move to a different executor (a queue worker, an edge function)
later without touching the parsing logic itself.

## Route structure

Course-scoped routing: everything about a specific course lives under a
`[courseId]` segment, and a `layout.tsx` at that segment is the single
place membership is checked for everything beneath it (Invariant 3 —
the check happens once, at the boundary, not re-derived per page).

```
src/app/
  page.tsx                        redirects to /student or /instructor by role
  login/                          Supabase Auth sign-in
  student/
    page.tsx                      "My Courses" — enrolled courses only
    courses/page.tsx              "Available Courses" — full catalog + enroll/request
    courses/[courseId]/layout.tsx membership check + CourseContextBar; gates everything below
      page.tsx, course/, assessments/, materials/, grades/, performance/
  instructor/
    page.tsx                      course picker — courses this user instructs
    manage-instructors/           GLOBAL, owner-only — LMS-wide instructor status,
                                   unrelated to any one course's roster
    courses/[courseId]/layout.tsx membership check (role=instructor) + CourseContextBar
      page.tsx, content/, assessments/, students/, settings/, gradebook/, ...
```

`students/` (per-course roster + pending enrollment requests) and
`manage-instructors/` (global instructor allowlist) are deliberately
different features living at different levels of the tree — conflating
them would let course-level UI imply LMS-wide authority it doesn't have.

`src/proxy.ts` (Next.js 16 renamed `middleware.ts` → `proxy.ts`) refreshes
the Supabase session cookie and redirects unauthenticated requests to
`/student` or `/instructor` to `/login`.

## Mobile

Responsive, not a separate mobile build: `flex-col sm:flex-row` /
`grid-cols-1 sm:grid-cols-3` layouts throughout, `CourseContextBar`
(`src/components/shell/course-context-bar.tsx`) is a horizontally
scrollable tab row instead of a second sidebar, and the assessment
runner (`src/components/assessment/attempt-runner.tsx`) uses large
(`py-4`, `border-2`) tap targets with Previous/Next as equal-width
`flex-1` buttons rather than a cramped button row. Wide instructor
tables (roster, results) are the one area still using literal
`<table>` markup — acceptable for instructor-only screens per the
brief, but a first candidate for a stacked-card treatment if instructor
mobile use grows.

## What's deliberately not here yet

No AI/embeddings anywhere. Course *creation* still has no UI — new
courses are seeded via migration, not a "New course" instructor flow
(schema and RLS already support it, same as Milestone 1's original
multi-course-ready design predicted).
