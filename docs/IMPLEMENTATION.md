# Implementation status

Living document. Updated as milestones land — see `docs/ARCHITECTURE.md`
for the system shape and `docs/DECISIONS.md` for why things are built
the way they are.

## Milestone 2 — first assessment (CSE 1203 Mock Test): COMPLETE and live-verified

Question Bank → Test Definition → Attempt → Responses → Submission/Score,
built on the existing course/auth/RLS architecture rather than a
parallel system (`supabase/migrations/0005-0008`). The real
instructor-reviewed 100-question bank (from the supplied .docx, parsed
and checked into `scripts/data/question_bank.json`) is ingested and
live; "CSE 1203 Mock Test — Lectures 1 & 2" (10 questions, 5+5,
randomized per student, one attempt, auto-graded) is published and
unlocked for inspection.

Verified for real, not just written — driven through the actual running
app over HTTP wherever technically possible (see docs/DECISIONS.md for
the one Server Action pattern that didn't survive that and how it was
fixed), and directly against the live database/RPCs everywhere a real
browser's client-side JS would otherwise be required (per-question
option clicks and Submit are wired through the same thin RPC wrappers
already proven at the database level — see the chat transcript's
verification section for the exact split):

- Two real students got genuinely different 10-question selections and
  orderings from the same bank, each with exactly 5 Lecture 1 + 5
  Lecture 2 questions, no duplicates within an attempt, and
  independently shuffled option order even on a question both of them
  happened to receive.
- Revisiting an in-progress or submitted attempt's URL always
  reconstructs the identical attempt — proven by re-fetching the real
  intro page after submission and getting redirected straight back to
  the same attempt, not a new one.
- Cross-student access denied at the real page route: each student
  requesting the other's attempt URL got a real `404`, not an error
  page revealing the attempt exists.
- The answer key is unreachable before submission: `get_attempt_view()`'s
  JSON response carries no `isCorrect` key on any option until
  `submitted_at` is set; confirmed by inspecting the actual RPC
  response, not just reading the SQL.
- Grading is authoritative: submitted with 8/10 questions answered
  (2 deliberately skipped) and a real score came back computed from the
  stored correct answers, not anything the client sent; a subsequent
  `save_response` call against the submitted attempt was rejected.
- Instructor sees both real students' real scores and can drill into
  either attempt's full right/wrong breakdown with correct answers
  shown; "Reset attempt" deleted the targeted attempt (verified via a
  direct DB check — row and its children actually gone) and the
  student was immediately able to start a fresh attempt, while the
  other student's own submitted attempt was untouched.
- Lock/unlock exercised through the real instructor UI (not a direct
  DB update): locked showed every student a "hasn't opened this test
  yet" message and blocked `start_attempt` at the RPC level; unlocking
  through the same UI control immediately allowed starting.
- Full existing regression suite still passes (16/16 automated tests,
  `tsc`/`eslint`/`npm run build` clean, course/materials/PPTX/RLS/auth
  pages spot-checked live) — nothing in this pass touched the working
  Milestone 1/1.5 architecture, only added to it.

## Milestone 1.5 — real onboarding + instructor admin: COMPLETE and live-verified

Replaced the throwaway dev-account login model with genuine self-service
student signup, verified instructor signup (proof of email ownership via
Supabase's native OTP, decoupled from the project's global email-confirm
setting), and a dynamic, database-backed instructor allowlist with an
owner/admin capability — all exercised for real over HTTP and via direct
signed-in Supabase clients, not asserted from code review. Full
before/after test matrix is in the chat report for this pass; the short
version: every one of the 25 verification items the brief asked for was
either driven through the real running app or through the real database
functions/RLS it depends on. See `docs/DECISIONS.md` for the interesting
parts (email-confirm decoupling, the fragment-based confirmation link,
hitting Supabase's dev-mailer rate limit for real, the owner/admin
capability model).

One real, load-bearing bug found and fixed by testing rather than
review: `supabase.auth.signOut()` defaults to `scope: 'global'`, which
would have logged a denied login attempt out of every other session for
that account. Now `scope: 'local'` everywhere.

## Milestone 1 — content loop: COMPLETE and live-verified

Instructor logs in → creates Unit/Lecture/Material → uploads a real
PPTX through the real API → original stored safely → immutable version
→ deterministic extraction → ordered, provenance-tagged slides →
instructor publishes → student logs in → sees only what's published →
draft is invisible → unauthorized writes are rejected. All of this now
runs against the live hosted Supabase project, not fixtures.

### Verified for real, not just written

Every item below was exercised against the actual hosted project —
either through the real HTTP server (login form, upload API) or
through a signed-in Supabase client performing the same operations the
app performs, not a mock:

- **Real login, both roles, over real HTTP.** Drove the actual
  `/login` page's server action as a real POST (reverse-engineered
  Next.js's progressive-enhancement form-action encoding to do this
  without a browser) with real credentials, and got back real
  `Set-Cookie` session cookies and real redirects:
  `ezaz.labib@gmail.com` → `303 → /instructor`; `dev-student` → `303 →
  /student`; `dev-student` via "Login as Instructor" → `200` with the
  literal denial message rendered, and — confirmed by immediately
  reusing those cookies — the session was genuinely signed out.
- **Real proxy-level role gate.** Unauthenticated `GET /instructor` →
  `307 → /login`. Authenticated non-instructor `GET /instructor` → `307
  → /student` (not to /login — they're authenticated, just not
  authorized for that section). Authorized instructor `GET /instructor`
  → `200`.
- **Real PPTX upload through the real API route.** Both actual CSE
  1203 decks uploaded via `POST /api/materials/{id}/versions` with the
  instructor's real session cookie — not a direct database write. The
  real `after()`-deferred extraction ran, and `material_versions`
  landed at `ingestion_status: 'ready'` with **28 and 37 slides**
  respectively (matching the structural sanity check in the brief),
  containing real extracted text (verified by reading actual slide
  rows back from Postgres).
- **Real publish → real student visibility.** Published Lecture 01's
  material as the instructor; the student's own signed-in client
  immediately saw the material row and all 28 slides; re-fetching the
  actual student lecture page over HTTP with the student's session
  showed the lecture title and real extracted slide text ("Michigan
  State...") in the rendered HTML. Lecture 02 was deliberately left a
  draft — confirmed absent from every student-facing query and page.
- **Real write denial, both at the database and the API layer.** A
  signed-in student attempting `insert` on `units`/`lectures`/
  `materials` was rejected by Postgres RLS every time. A student
  attempting the real file-upload API route got a real `403` with an
  RLS policy violation message (fixed from a misleading `500` found
  during this testing pass) — and the database was confirmed to have
  zero unauthorized rows or files afterward, not just an error response.
- **Instructor role never downgraded by UI choice.** After the
  authorized instructor visited `/student` (the "preview" path), a
  direct database check confirmed `course_members.role` was still
  `'instructor'`.
- **12/12 automated tests pass**, including a live integration suite
  (`src/lib/supabase/rls.integration.test.ts`) that signs in as both a
  real instructor and the throwaway student and exercises the same
  create/read/publish/deny matrix above, plus the real PPTX ingestion
  test (`pptx.test.ts`) against the actual fixture files.
- `npm run build`, `npx tsc --noEmit`, and `npx eslint .` are all clean.

### A real bug this testing pass found and fixed

`supabase.auth.signOut()` defaults to `scope: 'global'` — it revokes
*every* session for that account, not just the current one. The
login action's denial path (a mis-click on "Login as Instructor") was
calling the bare `signOut()`, which meant denying one login attempt
would have logged that account out of every other open tab/device too.
Fixed to `signOut({ scope: 'local' })` everywhere in
`src/lib/supabase/actions.ts`. Found by actually driving the login flow
twice in a row over real HTTP and noticing the first session had gone
stale — not by code review.

### Fixture-backed: nothing, anymore

Every Milestone 1 screen now queries `src/lib/domain/queries.ts`
against the live database. `src/lib/domain/fixtures.ts` still exists
(clearly dev-only) but is no longer imported anywhere in the app.

### Instructor allowlist

`src/lib/auth/instructor-allowlist.ts` holds exactly two emails —
`ezaz.labib@gmail.com` and `labibahm@msu.edu`. It's the source of truth
for (a) which emails `scripts/create-instructor-accounts.mjs` will ever
grant `role='instructor'`, and (b) a defense-in-depth check in the
login action, on top of (not instead of) the real
`course_members.role` read from the database. Neither account's
Supabase password matches their real Google/MSU password — both were
freshly generated for this dev project (see demo credentials, given
separately).

### Not yet built (unchanged from before this pass)

Assessments, attempts, grades, gradebook, announcements, calendar,
students/enrollment UI. Course creation is still seed-only, not a UI
flow. See `docs/DECISIONS.md` for why each is out of Milestone 1 scope.

## Blocked on nothing right now

The Supabase connectivity issue from earlier in this session (IPv6-only
direct connection host; a placeholder left unsubstituted in the DB
password) is resolved — migrations, seed, and both provisioning
scripts ran successfully against the hosted project.

## Milestone 3 — multi-course + self-service enrollment + mobile: COMPLETE and live-verified

CSE 1203 preserved exactly (verified: 2 units, 2 lectures, 100
questions, 400 options, the mock test still published/unlocked, both
pre-existing attempts still submitted with scores intact). CSE 1205
added as a genuinely separate course (`supabase/migrations/0009`), not
a duplicate of CSE 1203. `courses.auto_enroll` plus a new
`enrollment_requests` table (distinct from `course_members`) drive
Enroll-vs-Request-to-Join UI state per course; all writes go through
SECURITY DEFINER RPCs (`enroll_in_course`, `approve_enrollment_request`,
`reject_enrollment_request`, `remove_course_member`) — see
`docs/DECISIONS.md` for the security shape and the RLS-visibility bug
this pass found and fixed (`course.ts` queries were missing an explicit
`user_id` filter and could return another user's roster row under
`.maybeSingle()`).

Routing restructured to `student|instructor/courses/[courseId]/...`
with a per-segment `layout.tsx` doing the membership check once (see
`docs/ARCHITECTURE.md`, "Route structure"). The old single-course
`getCurrentMembership()` was removed entirely in favor of
`getCourseMembership(courseId)` / `getMyCourses()` /
`getAllCoursesWithStatus()`.

Verified for real against the hosted project, same standard as
Milestone 2 — real HTTP form submissions (progressive-enhancement
replay via curl, auto-detecting each page's `$ACTION_N` numbering since
it shifts with the number of server-action-bound components rendered
before the target form) for every form-based flow, and direct
authenticated RPC calls for the two click-driven (non-form) actions
`remove_course_member` and `approve/reject_enrollment_request`'s
underlying effects. Confirmed: full signup → Available Courses →
Enroll → mock test completion for a brand-new student; Request-to-Join
→ pending → instructor Approve → access without re-login; Reject →
no access → same student can request again; direct `course_members`
insert blocked by RLS for both student- and instructor-role payloads;
`enroll_in_course` has no role parameter at all, so it can never create
an instructor membership; a CSE-1205-only student gets `Not a member of
this course.` from `start_attempt` on the CSE 1203 mock test and an
empty result from a direct `questions` read; toggling `auto_enroll` off
then back on left an existing pending request `pending` (not
silently approved) while a brand-new student's next `enroll_in_course`
call still enrolled immediately. Full regression also re-run and green:
`npx tsc --noEmit`, `npx eslint .`, `npm run build`, `npm run test`
(16/16, including the PPTX ingestion fixture and the live RLS/auth
integration suite from Milestone 2).

Not independently verified: mobile viewport rendering in an actual
browser/device (no browser automation tool was available in this
environment) — the responsive Tailwind classes were written and code-
reviewed (see `docs/ARCHITECTURE.md`, "Mobile") but not visually
confirmed at a phone width.

## Milestone 4 — Grades, Performance, Gradebook, and production release: COMPLETE

Grades (student), Performance (student + instructor), and Gradebook
(instructor) replace their `ComingLater` placeholders with real
screens, all reading from the existing `attempts`/`attempt_questions`/
`responses` tables — no parallel grading system (`0010`; see
`docs/DECISIONS.md` for the aggregation design and the two real bugs
this pass found and fixed: the `!= 'instructor'` NULL-bypass across
eight SECURITY DEFINER functions, and the `start_attempt()`
check-then-insert race).

Verified for real: the existing 5/10 (dev-student) and 10/10
(labibahm7) CSE 1203 attempts appear correctly on both Grades and the
instructor Gradebook over real HTTP with real session cookies; student
Performance correctly derives lecture/topic breakdowns from the same
attempt (2/5 Lecture 1, 3/5 Lecture 2, topic counts down to 1/1); a
CSE-1205-only (fully removed-from-CSE1203) student gets `Not a member
of this course.` from `get_student_performance(CSE1203)` and, before
the `0011` fix, could call `get_course_gradebook`/`get_course_performance`
directly and get the whole class's data back — confirmed fixed.

Capacity: a 50-synthetic-student concurrency simulation (scoped to a
throwaway question bank + assessment in CSE 1205, fully cleaned up
afterward) exercised concurrent course/roster/assessment reads,
double-tap enrollment, double-tap attempt start, concurrent answer
saves, and double-tap submission. First run surfaced two real findings
(Supabase Auth's default sign-in rate limit under a simultaneous
50-account burst, and the `start_attempt()` race above); second run,
after fixing the race and pacing sign-ins with backoff, completed
50/50 students through the full flow with zero errors and zero
duplicate attempts in ~61 seconds of simulated concurrent load.

Stale Milestone-1-era placeholder copy ("Coming after Milestone 1",
"Not built yet") removed from `ComingLater` in favor of ordinary
product language ("Coming soon"), since it's still shown on the
remaining genuinely-unbuilt sections (Announcements, Calendar,
Materials cross-lecture search).
