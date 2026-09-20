# Decisions

Meaningful technical choices and the tradeoffs behind them. Not a full
change log — see git history and the migrations for that.

## Assessments: students get almost no direct table access at all

The schema is `question_banks → questions → question_options →
assessments → assessment_rules → attempts → attempt_questions →
responses` (`supabase/migrations/0005_assessments.sql`). The interesting
decision is in `0006_assessments_rls.sql`: students have **no RLS
policy whatsoever** on `questions`, `question_options`,
`attempt_questions`, or `responses`. Every student interaction with an
attempt goes through exactly four SECURITY DEFINER functions —
`start_attempt`, `save_response`, `submit_attempt`, `get_attempt_view`
— each re-validating ownership and state from `auth.uid()` inside
Postgres on every call.

This is deliberately stricter than "just hide `is_correct`." A
column-level leak (e.g., a view that forgets to exclude `is_correct`)
is a realistic mistake; a *table with no student policy at all* can't
leak that way, because there's no student-reachable row to leak. The
tradeoff: reads and writes that would otherwise be simple RLS-scoped
`select`/`upsert` calls are instead RPCs, which is more ceremony for
less code flexibility — worth it here because the thing being protected
(the answer key) is the entire point of the feature.

`get_attempt_view()` is also what makes "hidden before submission,
visible after" a single code path instead of two: it includes
`isCorrect` on each option only when `submitted_at is not null` (or the
caller is an instructor) — verified directly (see chat transcript):
before submit, the JSON response has no `isCorrect` key on any option
at all; after, it does, and matches server-graded results exactly.

Grading (`submit_attempt`) reads `question_options.is_correct` directly
— SECURITY DEFINER makes this legal regardless of RLS — and only ever
trusts the `attempt_id`/`selected_option_id` pairs already sitting in
`responses`, which themselves only ever arrived via `save_response`'s
own validation (question belongs to this attempt, option belongs to
that question, attempt not yet submitted). Nothing the browser sends is
ever treated as a score or a correctness claim.

## A `.bind()`-wrapped Server Action combined with `redirect()` doesn't survive a no-JS form submission

Found while driving the "Start test" button the same way as everything
else this session (reconstructing Next's progressive-enhancement form
POST by hand): `<form action={startAttempt.bind(null, assessmentId)}>`
where `startAttempt` calls `redirect()` on success reliably failed with
"Failed to find Server Action," even immediately after a fresh page
load and a clean dev server restart. The same `.bind()` pattern works
fine for actions that don't redirect (`toggleLockAssessment`,
`resetAttempt`, `removeInstructorEmail` — all tested successfully this
way), and plain `redirect()`-calling actions work fine when *not*
bound (every login/signup form, via `useActionState` reading from
`FormData` directly).

Fix: `startAttempt` now reads `assessmentId` from `FormData` instead of
a bound argument, called via `useActionState` like the login forms —
the exact shape already proven to redirect correctly. Whether this is a
genuine Next.js 16/Turbopack dev-mode limitation or something narrower
is unconfirmed; the practical takeaway is to prefer `useActionState` +
`FormData` over `.bind()` for any action that redirects.

## Instructor email verification, decoupled from the project's global "Confirm email" setting

The hosted project has "Confirm email" ON globally (confirmed empirically —
an ordinary `signUp()` call returns `session: null` until confirmed). That
setting is project-wide, not per-flow, but the product needs opposite
behavior for the two roles: students get in immediately, instructors must
verify first.

Rather than touching that global setting (which would need dashboard
access, and would still apply to both flows identically), both signup
paths use the **admin API with an explicit `email_confirm` flag**,
which overrides the global setting per call:
`admin.createUser({ email, password, email_confirm: true })` for
students, `email_confirm: false` for instructors. Instructor
verification is then triggered separately via
`supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })`
— a native Supabase primitive, no custom email system. This means
neither flow depends on the dashboard's global toggle at all, in either
direction.

**The actual security boundary is a database trigger, not the email
being clicked.** `supabase/migrations/0004_instructor_authorization.sql`'s
`on_instructor_email_confirmed` trigger fires on
`auth.users.email_confirmed_at` transitioning from null to set —
whichever mechanism caused that (OTP link, future magic-link login,
manual dashboard confirmation) — and only then, if the email is on
`instructor_allowlist`, grants `course_members(role='instructor')`.
Verified empirically: hitting Supabase's own `/auth/v1/verify` endpoint
with a generated token sets `email_confirmed_at` immediately, before
any redirect back to the app — so the grant happens even if the
client-side session-establishment step that follows (below) never runs.

**The confirmation email's link uses a URL fragment, not a query
param.** Followed a real generated link with curl to check: Supabase's
default `{{ .ConfirmationURL }}` template redirects to
`{redirectTo}#access_token=...&refresh_token=...`, not
`?token_hash=...`. A fragment is invisible to the server, so
`src/app/auth/confirm/page.tsx` is a client component that reads
`window.location.hash` and calls `supabase.auth.setSession()` — this
works with Supabase's unmodified default email template, no dashboard
template edit required.

**Supabase's built-in dev mailer has a real, low send-rate limit.**
Hit `over_email_send_rate_limit` (HTTP 429) during this pass's own
testing. The account is still created either way — only the email send
fails — so `instructorSignUp` distinguishes that case with a specific
retry-later message rather than implying signup itself failed. For a
real class, production would want a configured SMTP provider (native
Supabase capability, not a new dependency) purely to raise this send
volume — a deployment concern, not a development-time blocker, exactly
because the verification mechanism itself doesn't depend on which
mailer is behind it.

## Dynamic instructor allowlist + owner capability: one table, SECURITY DEFINER functions, no policies

`instructor_allowlist` (who may ever become an instructor) and the
owner/admin capability (who may edit that list) needed a home. Chose:
one table, RLS enabled with **zero** policies for `authenticated`/`anon`,
and every read/write going through SECURITY DEFINER Postgres functions
(`current_user_is_owner`, `add_instructor_email`,
`remove_instructor_email`, `list_instructor_status`) that re-derive the
caller's authorization from `auth.uid()` inside the function body. A
direct `select * from instructor_allowlist` as any authenticated
client returns nothing — there's no policy granting it — so there's no
path to this table that trusts anything from the client except identity.

This also answers "is admin a separate role": no. `is_owner` is a
boolean on an instructor's allowlist row — admin is a capability
attached to an already-authenticated instructor identity, not a third
parallel auth flow. `ezaz.labib@gmail.com` keeps using the same
Instructor Sign In as everyone else; the server resolves the extra
capability from the same session.

**Revoke actually revokes.** `remove_instructor_email` deletes the
allowlist row *and* deletes any `course_members(role='instructor')`
rows for that email in the same function — tested by removing a test
instructor through the real admin UI and confirming both rows were
gone, not just hidden from the list.

## Account identity vs. course enrollment

Self-service student signup (`studentSignUp`) only ever creates an
`auth.users` row — never a `course_members` row. A brand-new student
lands on `/student` with a "not enrolled yet" empty state rather than
being bounced back to `/login`, because being signed in and being
enrolled are different questions (`src/lib/supabase/course.ts` now
exposes `getCurrentUser()` and `getCurrentMembership()` separately,
where before there was only the latter). Enrollment is still
instructor/admin-granted (a `course_members` insert) — no self-service
enrollment flow in this pass, matching the instruction not to
redesign enrollment beyond what's needed here.

## Session lifetime: 24h cookie maxAge, not Supabase's 400-day default

`cookieOptions: { maxAge: 60 * 60 * 24 }`, applied consistently across
`src/proxy.ts`, `src/lib/supabase/server.ts`, and
`src/lib/supabase/client.ts` (wherever a session cookie gets written).
Because a silent token refresh rewrites the cookie with a fresh 24h
window, this caps *idle* sessions at 24h rather than forcing re-login
every day during active use — closer to "logged in until you sign out"
than a hard daily expiry. A true activity-independent cap exists as a
native Supabase project setting ("time-box user sessions"), not
configured here since it needs dashboard access this environment
doesn't have; worth revisiting if a stricter absolute cap is wanted
later.

## Instructor authorization: allowlist + role selector are not the same thing

The login page has two buttons ("Login as Student" / "Login as
Instructor"), but that choice is only ever an *intent* — it's read from
`FormData`, which is exactly as trustworthy as any other client input.
The actual authorization for the instructor path is two checks ANDed
together, both server-side, both re-derived after every sign-in: the
signed-in user's `course_members.role` (the database) AND their email
against `src/lib/auth/instructor-allowlist.ts` (who's allowed to ever
hold that role at all). Denial signs the session back out — `scope:
'local'` specifically (see the bug note below) — rather than leaving an
ambiguous authenticated-but-unauthorized session sitting on the login
page. Choosing "Login as Student" never touches `course_members`, so it
can't accidentally revoke an instructor's role — the two paths are
asymmetric on purpose.

`signOut()` defaults to `scope: 'global'`, which revokes every session
for that account everywhere, not just the current one — found by
actually driving the login flow twice over real HTTP in the same
testing pass and noticing an earlier valid session had gone stale.
Every `signOut()` call in `src/lib/supabase/actions.ts` now passes
`{ scope: 'local' }` explicitly. Worth knowing if a future flow adds
another `signOut()` call — the permissive-sounding default is the
dangerous one here, not scope: 'local'.

## No local Supabase stack (Docker unavailable)

This dev machine has neither Docker nor the Supabase CLI, so
`supabase start` (local Postgres + Auth + Storage) isn't available.
Options were: install Docker, use a hosted free Supabase project, or
defer live testing entirely. **Chose hosted free project** — fastest
path to actually running the migrations and RLS policies against real
Postgres, which matters more here than local-only dev given how much of
Milestone 1 is "prove the RLS actually holds." `supabase/migrations/`
are ordinary SQL, so this isn't a one-way door — they run the same way
against a local stack if Docker becomes available later.

## Next.js 16 specifics

- Scaffolded with `create-next-app@latest`, landing on Next 16.3.5 —
  materially different from most training-era Next.js knowledge, so its
  bundled docs (`node_modules/next/dist/docs`) were read before writing
  routes.
- **Cache Components (`cacheComponents: true`) left off.** It's opt-in in
  16, and its value (partial prerendering, aggressive static shells) is
  aimed at content that's the same for every visitor. Nearly everything
  in this app is per-user and RLS-gated — there's little to prerender.
  Turning it on would mean sprinkling `'use cache'`/`<Suspense>`
  boundaries for no real payoff at "tens of students" scale. Standard
  dynamic rendering is simpler and correct for this shape of app.
- **`src/proxy.ts`, not `middleware.ts`.** Next 16 renamed the file
  convention; `middleware.ts` is deprecated. Behavior is the same
  (runs before rendering, refreshes the Supabase session cookie, gates
  `/student` and `/instructor`).
- `params`/`searchParams` are `Promise`s in route components
  (`PageProps<'/route'>` generated types) — every dynamic page `await`s
  them.

## Ingestion execution model

Upload and extraction are two separate steps (Invariant 6/7): the
original file must be safely stored even if parsing fails or never
runs. At this scale (tens of students, occasional uploads, decks in the
tens of slides), introducing a queue (Redis/Kafka/etc.) would be pure
overhead. The chosen shape:

1. The upload Route Handler writes the original file to Storage and
   inserts a `material_versions` row (`ingestion_status = 'pending'`) —
   this is the durable, safe-even-if-nothing-else-happens step.
2. Extraction runs via Next.js's `after()` API, which continues
   executing after the response is sent, in the same server
   invocation — no separate worker process, no external infra.
3. `parsePptx()` (`src/lib/ingestion/pptx.ts`) is pure and
   framework-independent: bytes in, ordered slides out. It doesn't know
   about Supabase, `after()`, or HTTP, so the execution boundary above
   could move to a real queue/worker later without touching the parser.
4. Extraction is idempotent: it always deletes-then-inserts that
   version's `slides` rows in one transaction, keyed on
   `material_version_id`. Running it twice (a manual retry, or a crash
   mid-run) can't duplicate rows.

This trades "survives a server restart mid-extraction" (a real queue
would) for "zero extra infrastructure" — acceptable at this scale, and
explicitly called out so it's revisited if the course/team grows.

## PPTX parsing: deterministic ZIP/XML, not a library, not OCR

PPTX is a ZIP of XML parts. `src/lib/ingestion/pptx.ts` reads
`ppt/presentation.xml` for the authoritative slide *order* (slide
filenames like `slide10.xml` are not reliably sortable), resolves it
through the relationships file, then walks each slide's shape tree
collecting text, title (from a `title`/`ctrTitle` placeholder shape,
when the deck uses one), and speaker notes (via each slide's own
`.rels` → its `notesSlide` part). No third-party PPTX-specific package
— `jszip` + `fast-xml-parser` give full control and no dependency on an
unmaintained wrapper. **Verified against the real CSE 1203 decks**
(`npx vitest run src/lib/ingestion/pptx.test.ts`): 28 and 37 slides
extracted in correct order with real text content, matching the
structural sanity check from the brief. Visual fidelity (exact
positioning, styled text) is explicitly out of scope for v1.

## Service role key: scoped narrowly

`src/lib/supabase/admin.ts` (service role, bypasses RLS) exists for
exactly one caller: the ingestion pipeline writing `slides` and
updating `material_versions.ingestion_status` after parsing. That's a
system process reacting to an already-authorized upload, not a
user-facing request — user-facing reads/writes always go through
`src/lib/supabase/server.ts`, where RLS actually runs. Extending the
service role's use to anything else should be a deliberate, reviewed
decision, not a convenience reach.

## Auth: email + password, not magic link

Supabase's shared SMTP for magic links / email confirmation is rate
limited and not fully reliable for a real class's login cadence.
Email + password sidesteps needing email delivery to work for every
sign-in. Account provisioning (who gets an account) is out of Milestone
1 scope — the Students/enrollment page — so for now, accounts are
created directly in the Supabase dashboard or via
`supabase.auth.admin.createUser()`, then linked to a course with a
`course_members` insert (see `supabase/seed.sql`).

## Course creation is out of Milestone 1 scope

The brief is explicit that Milestone 1 proves the content loop for
*one* course, and that building fifty tables/screens up front is the
wrong instinct. `courses`/`units` for the one real course are seeded
directly (`supabase/seed.sql`) rather than built through a "New course"
UI flow. The schema already supports multiple courses (every table
hangs off `course_id`); only the creation *screen* is deferred.

## `materials.current_version_id` ↔ `material_versions.material_id`

These two tables reference each other. Resolved the standard way:
create `materials` without the FK, create `material_versions` with its
FK to `materials`, then `ALTER TABLE materials ADD CONSTRAINT ...` for
the back-reference (`0001_core_schema.sql`). Not a versioning-system
abstraction — just enough to point "the material" at "its current
version" while keeping every prior version's row intact.

## Multi-course enrollment: per-course auto-enroll flag, not a global mode

`0009_multi_course_enrollment.sql` adds `courses.auto_enroll` and an
`enrollment_requests` table, distinct from `course_members`. Enrollment
is never a client-supplied action on `course_members` directly — RLS
has no insert/update/delete policy on either table for ordinary users;
every enrollment/approval/rejection/removal goes through a
SECURITY DEFINER RPC (`enroll_in_course`, `approve_enrollment_request`,
`reject_enrollment_request`, `remove_course_member`) that re-derives
`auth.uid()` and re-checks authorization itself, exactly like the
existing instructor-authorization pattern from `0004`. `enroll_in_course`
takes only `p_course_id` — there is no role parameter anywhere in the
self-enrollment path, so a forged `role=instructor` payload has nothing
to attach to; the function always inserts `role='student'`. A partial
unique index (`enrollment_requests_one_pending_idx`, `where status =
'pending'`) prevents duplicate pending requests while still allowing a
rejected student to request again later — there is no ban/disciplinary
state, only the request's own status history.

Toggling `auto_enroll` off does not touch existing `course_members` rows,
and toggling it back on does not retroactively approve requests that are
still `pending` — the flag only changes what happens the next time
`enroll_in_course` runs for someone with no existing relationship to the
course. Verified directly against the hosted DB: flipping CSE 1203's
`auto_enroll` off → on left an already-`pending` request untouched while
a brand-new student's `enroll_in_course` call went straight to
`{status:'enrolled'}`.

**RLS-visibility lesson**: any query on `course_members` filtered only by
`course_id` and expecting one row breaks for an instructor caller,
because their RLS visibility is roster-wide (every student in their
course), not self-only. `course.ts`'s `getCourseMembership`/
`getMyCourses`/`getAllCoursesWithStatus` all learned this the hard way —
first version filtered by `course_id` alone and either threw on
`.maybeSingle()` or would have returned one row per co-enrolled user.
Fix: always add an explicit `.eq("user_id", user.id)` when "my own row"
is intended — never rely on RLS to narrow a multi-row-visible table down
to one row on your behalf.

## Grades and Performance: no second grading system

`0010_grades_performance.sql` adds three read-only SECURITY DEFINER
functions — `get_student_performance`, `get_course_gradebook`,
`get_course_performance` — and nothing else. There is deliberately no
new table: the Grades page reads directly from `attempts` (already
authoritative, already graded by `submit_attempt()` in
`0006_assessments_rls.sql`), and Performance/Gradebook aggregate over
`attempt_questions`/`responses`/`questions`/`lectures` entirely inside
Postgres, returning one pre-aggregated JSON payload per page. That last
part matters for the 50-student capacity target as much as for
security: a page never pulls the question/answer bank client-side to
compute a breakdown itself, which would mean shipping answer keys to
the browser and doing O(students × questions) work per request.

Every breakdown query is anchored on `attempt_questions` (not
`responses`) as the base table, `left join`ing to `responses` and
`question_options`. This matters: `responses` only has a row for a
question the student actually answered, but `attempt_questions` has a
row for every question the attempt *assigned*, regardless of whether it
was answered. Anchoring on `responses` would silently drop unanswered
questions from both the numerator and denominator of every accuracy
stat — inflating a partial attempt's accuracy instead of correctly
counting an unanswered question as 0 credit, exactly like
`submit_attempt()`'s own grading already does.

**`current_course_role(...) != 'instructor'` is not a safe authorization
check** — this was the significant finding of this pass. Postgres's
three-valued logic means `NULL != 'instructor'` evaluates to `NULL`, and
`if NULL then ... end if` in PL/pgSQL is treated as false, not true — so
a caller with **zero relationship** to the course (no `course_members`
row at all, where `current_course_role()` returns `NULL`) sails straight
past the `if ... != 'instructor' then raise exception` guard instead of
tripping it. Found by calling the new `get_course_gradebook`/
`get_course_performance` functions as a student who had been fully
removed from the course — both returned the complete roster and score
data instead of raising `Not authorized.`. The same pattern turned out
to already exist, unnoticed, in six other functions going back to
`0007_assessment_instructor_views.sql`: `list_assessment_attempts`,
`approve_enrollment_request`, `reject_enrollment_request`,
`remove_course_member`, `list_course_roster`, `list_pending_requests`.
`0011_fix_null_instructor_check.sql` redefines all eight functions
using `is distinct from` instead of `!=`, which — unlike `!=` — never
evaluates to `NULL`: `NULL is distinct from 'instructor'` is `true`
(correctly rejects a non-member), `'student' is distinct from
'instructor'` is `true` (correctly rejects a student), `'instructor' is
distinct from 'instructor'` is `false` (correctly allows). Any future
SECURITY DEFINER function gating on a role comparison should use `is
distinct from` (or `coalesce(..., 'none') != ...`) from the start, never
a bare `!=` against a nullable value.

## `start_attempt()`: the check-then-insert race

`start_attempt()` reads as "return the existing attempt if there is
one, otherwise create one" — correct for a single caller, but under two
truly concurrent requests for the same `(assessment_id, user_id)` (a
real double-tap on Start Test, or a mobile retry after a slow response),
both can pass the initial `SELECT ... if found return` before either
commits its `INSERT`. The `attempts` table's `unique (assessment_id,
user_id)` constraint (`0005_assessments.sql`) correctly stops the second
INSERT from creating a duplicate row, but the caller used to see a raw
`duplicate key value violates unique constraint` error instead of
transparently resuming the attempt the other request just created —
found via a 50-synthetic-student concurrency simulation for this
release pass (11 of 25 concurrent double-start pairs hit it before the
fix; 0 of 50 after).
`0012_fix_start_attempt_race.sql` moves the conflict handling onto the
INSERT itself (`on conflict (assessment_id, user_id) do nothing
returning id`) and falls back to re-selecting the row when the insert
is skipped, instead of trusting the earlier SELECT to still be accurate
by the time the INSERT runs.

## Load-testing concurrency: don't reuse one client for "simultaneous" calls

The first attempt at the 50-student concurrency simulation fired two
`.rpc()` calls on the *same* `supabase-js` client object with
`Promise.all` to simulate a double-tap, and got nonsensical
`null value in column "user_id"` errors — an artifact of that client
library's internal session-state handling under truly-concurrent calls
on one instance, not a server-side bug. The real app never does this: a
double-tap in the browser produces two independent HTTP requests, each
landing on its own Next.js server action invocation with its own
request-scoped Supabase client built fresh from cookies
(`src/lib/supabase/server.ts`). The simulation was corrected to match
that: sign in once per synthetic student to get a stable access token,
then fire concurrent "double-tap" pairs as independent `fetch()` calls
carrying that same static bearer token — which is what actually
surfaced the real `start_attempt()` race above, rather than masking it
behind a client-library red herring.
