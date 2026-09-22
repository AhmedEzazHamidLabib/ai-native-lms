# Architecture Handoff

Written so a fresh Claude Code session with zero conversational memory
can understand this system without re-reading the entire repository.
Describes the architecture **as it exists** at commit `637091a`
(tag `v0.1.0-live-pilot`). Not a design proposal — if something here
looks like it should be improved, it probably is a known limitation;
check `docs/PRODUCT_AND_ARCHITECTURE_REVIEW.md` before "fixing" it.

**Read `CLAUDE.md` first** — it's the short version of this document
plus durable, hard-won lessons (a security bug that was fixed once,
reintroduced, and fixed again; a migration overload trap; RLS
visibility gotchas that recur across nearly every query in this
codebase). This document is the long version.

---

## 1. Product state

**What this currently is**: an AI-native LMS running one real,
currently-taught course — CSE 1203 (Introduction to Computing) at
Premier University, Bangladesh — for a real instructor and real
students, this term. A second real course (CSE 1205) also exists in
the same database, created for isolation-testing purposes but real.

**What's actually deployed and used**: content management (real
PPTX/PDF/DOCX rendering), the assessment engine (MCQ + written, Mock
Test / Class Test / Project), a non-graded Learning Diagnostic, an AI
Tutor grounded in the course's own material and the student's own
evidence, announcements, a deterministic calendar, and — as of this
commit — instructor-initiated course creation.

**What remains experimental / in development**: embeddings-based
retrieval (currently full-text search — see §8), AI-assisted question/
assessment authoring (not built), multi-instructor role distinctions
beyond a flat instructor/owner split (every authorized instructor
currently has access to every course), any institutional/multi-tenant
layer (doesn't exist yet).

See `README.md` for the externally-facing version of this same
status, and `docs/PRODUCT_AND_ARCHITECTURE_REVIEW.md` for a critical
assessment of exactly where this falls short of "institution-ready."

---

## 2. Tech stack

- **Framework**: Next.js 16 (App Router, Turbopack, Server Components
  and Server Actions), React 19.
- **Database/auth/storage**: Supabase — Postgres with Row Level
  Security, Supabase Auth, Supabase Storage. One project serves both
  the application and all admin/ingestion tooling.
- **AI provider**: Anthropic's Messages API, called via a direct
  `fetch()` in `src/lib/tutor/provider.ts` — no SDK dependency. Claude
  Haiku for interactive Tutor turns, Claude Sonnet for the one-time
  Course Intelligence compile step.
- **Styling**: Tailwind CSS v4, a small custom typography/color token
  layer in `src/app/globals.css`, Fraunces (display) + Geist (UI) fonts
  via `next/font`.
- **Testing**: Vitest (unit + live integration, no mocked database),
  Playwright (real browser, desktop + mobile viewports).
- **Deployment**: Vercel, deployed via the CLI (`vercel --prod`) — see
  §14, this is **not** currently wired to auto-deploy from GitHub.
- **Package manager**: npm.

---

## 3. Application architecture

```
src/app/                      Next.js App Router
  instructor/                 Instructor-facing routes (role-gated)
  student/                    Student-facing routes (role-gated)
  login/                      Auth entry point (role-toggle form)
  auth/confirm/                Email-verification landing page (instructor OTP flow)
  api/                        A few REST-style routes (signed file downloads, uploads)
src/components/                UI, grouped by feature area (assessment/, calendar/,
                               course/, instructor/, shell/, tutor/, ui/, ...)
src/lib/
  domain/                     Course/assessment/content/roster business logic +
                               matching *.integration.test.ts files
  supabase/                   Auth actions, server/admin/browser Supabase clients,
                               database.types.ts (hand-maintained, see §5)
  tutor/                      AI Tutor: orchestrator, retrieval, evidence,
                               preferences, provider, cost governor
  ingestion/                  PPTX/DOCX parsing (no LLM in this path)
  intelligence/                Course Intelligence compile-step client (uses the model)
  test-support/                Shared test helpers (course-membership ensure/cleanup)
supabase/migrations/          Full, ordered, forward-only schema history (0001–0049)
scripts/                      Migration runner, seed, dev-account provisioning,
                               ingestion CLIs — all Node scripts run with
                               `--env-file=.env.local`
e2e/                          Playwright specs + global setup/teardown
docs/                         This handoff, the review, decisions, invariants, runbook
```

**Server/client boundary**: pages and most components are Server
Components by default; anything interactive (`useState`, event
handlers, `useActionState`) is an explicit `"use client"` file, kept
as small and leaf-level as possible — a page fetches data server-side
and passes it down, rather than a client component re-fetching.

**Important abstraction**: every mutation goes through either a Next.js
Server Action (`"use server"` file — see the convention note below) or
a Postgres `SECURITY DEFINER` RPC, never a raw client-side `.insert()`/
`.update()` for anything authorization-sensitive. Read-only pages call
plain `server-only` functions in `src/lib/supabase/` or `src/lib/domain/`
that wrap RLS-scoped Supabase queries.

**`"use server"` file convention** (hit repeatedly across sessions,
worth restating): a file with `"use server"` at the top may only
export **async functions** — no plain constants, interfaces, or
initial-state objects. Every actions file in this codebase has a
sibling `*-client-types.ts` file for those (e.g.
`profile-actions.ts` / `profile-client-types.ts`,
`course-actions.ts` / `course-client-types.ts`).

**Data flow for a typical instructor mutation**: Client component
(`useActionState`) → Server Action (`"use server"`, in `src/lib/domain/*-actions.ts`
or `src/lib/supabase/*-actions.ts`) → `createClient()` (RLS-scoped,
per-request) → `supabase.rpc(...)` → a `SECURITY DEFINER` Postgres
function that re-derives `auth.uid()` and re-checks authorization
internally → `revalidatePath()` on success, or a typed error state
back to the client.

---

## 4. Authentication

- **Provider**: Supabase Auth, email + password. Students sign up and
  get in immediately (`email_confirm: true` at creation — no OTP).
  Instructors must verify email ownership via a one-time OTP before
  their account is usable (`instructorSignUp`/`instructorSignIn` in
  `src/lib/supabase/actions.ts`).
- **Roles**: `student` | `instructor`, stored per-course in
  `course_members.role` — **not** a global user attribute. A user's
  "role" is really "their role in a specific course"; `isInstructorAnywhere()`
  (`src/lib/supabase/course.ts`) checks whether they have an
  `instructor` row in *any* course, which is currently equivalent to
  "are they an authorized, verified instructor at all" because every
  authorized instructor is automatically a member of every course (see
  §6 and §12's invariants).
- **Owner/admin**: one extra boolean, `instructor_allowlist.is_owner`.
  Not a third role — an owner is an instructor with one extra capability
  (managing the instructor allowlist itself), resolved via
  `current_user_is_owner()`.
- **Identity assumption, load-bearing**: `auth.uid()`, read inside a
  `SECURITY DEFINER` Postgres function, is the *only* thing any
  authorization decision is based on. Nothing trusts a client-supplied
  user ID, email, or role for any decision that matters.
- **Instructor eligibility vs. instructor access — two different
  things, this is the subject of this commit's bug fix**: being on
  `instructor_allowlist` only makes an email *eligible* to become an
  instructor. Actual access is a `course_members(role='instructor')`
  row, granted either by a one-time email-verification trigger (brand
  new accounts) or, as of this commit, immediately by
  `add_instructor_email()` itself when the email already has a
  verified Auth account (returning instructors). See
  `supabase/migrations/0049_instructor_lifecycle_and_course_creation.sql`
  for the full writeup and `CLAUDE.md` for the short version.
- **Route-level gating** (`src/proxy.ts`): redirects unauthenticated
  users away from `/student`/`/instructor`, and redirects a non-
  instructor away from `/instructor` specifically. This is a **UX
  convenience only** — the actual authorization boundary is RLS,
  unconditionally, regardless of what this middleware does or misses.

No private emails or credentials are reproduced in this document —
see `scripts/.dev-credentials.json` (gitignored) for local dev/test
account credentials if you need them.

---

## 5. Database

- **Migrations**: `supabase/migrations/0001` through `0049`, applied
  in order via `node --env-file=.env.local scripts/run-migrations.mjs`,
  tracked in a `_lms_migrations` bookkeeping table so re-running is
  safe (already-applied files are skipped). Forward-only — no down
  migrations exist or are expected.
- **`database.types.ts` is hand-maintained**, not generated (no
  Supabase CLI project link on this machine — see
  `docs/DECISIONS.md`). When a migration changes a table or RPC
  signature, `src/lib/supabase/database.types.ts` must be updated by
  hand in the same change, or TypeScript will silently allow calls
  that don't match the real schema.
- **RLS is the security boundary**, not a convenience layer. Every
  table has RLS enabled. Two patterns dominate:
  1. Plain RLS policies (`using`/`with check` referencing
     `current_course_role(course_id)`) for ordinary reads/writes scoped
     to course membership.
  2. `SECURITY DEFINER` Postgres functions for anything that needs to
     cross a boundary RLS alone can't express cleanly — cross-table
     writes, admin-only allowlist management, anything needing to read
     `auth.users` (never exposed to PostgREST directly).
- **Core identity/authorization tables**: `auth.users` (Supabase-
  managed), `instructor_allowlist` (email → eligible, `is_owner`),
  `course_members` (user × course × role — the actual access-control
  table), `profiles` (display-only `full_name`, never used for
  authorization).
- **Core course-content tables**: `courses` → `units` → `lectures` →
  `materials` → `material_versions` → `slides`, plus `material_chunks`
  (one row per slide, used for Tutor retrieval).
- **Core assessment tables**: `question_banks` → `questions` (+
  `question_options`) → `assessments` → `assessment_rules` (selection
  criteria) → `attempts` → `attempt_questions` → `responses`.
- **Key functions to know by name** (all `SECURITY DEFINER`):
  `current_course_role(course_id)` (the one identity-check every
  policy and function calls), `start_attempt`/`save_response`/
  `submit_attempt`/`get_attempt_view` (the entire assessment engine,
  shared by every assessment kind and the Learning Diagnostic — no
  separate code path), `add_instructor_email`/`remove_instructor_email`
  (the lifecycle this commit fixed), `create_course` (new this
  commit), `get_course_instructors` (new this commit, name-only
  display).
- **Migration strategy discipline**: `CREATE OR REPLACE FUNCTION` only
  replaces a function with the *exact same parameter list* — adding a
  parameter creates a second overload instead (this broke
  `create_assessment` in production once; see `0048`). Read the
  *live* function definition (via `pg_get_functiondef`) before writing
  a migration that touches an existing function, not just the
  migration file history — a later migration can silently supersede an
  earlier one.

This section explains the shape, not every column — see the
migrations themselves (each carries a comment explaining *why*, not
just *what*) for exact detail.

---

## 6. Course model

- A `course` has `code`/`title`/`term` (free text), scheduling fields
  (`meeting_days`, `start_date`/`end_date`, `timezone`), an
  `auto_enroll` toggle, and, as of this commit, `created_by` (nullable
  — attribution only, never access control).
- **Enrollment**: a student either self-enrolls immediately
  (`auto_enroll = true`) or submits an `enrollment_requests` row an
  instructor approves/rejects. `enroll_in_course()` hardcodes
  `role = 'student'` unconditionally — there is no parameter path for
  a client to request a different role.
- **Instructor access is currently global, not per-course**: every
  authorized, verified instructor automatically has a
  `course_members(role='instructor')` row for *every* course —
  granted on email verification (brand new instructors), on
  re-authorization (returning instructors, this commit's fix), and on
  course creation (every current instructor gets the new course too,
  this commit's feature). This is a documented Milestone-1
  simplification (see `docs/DECISIONS.md`), not an oversight — see
  §15 before "fixing" it into a real per-course ACL.
- **Course creation** (`create_course()`, new this commit): any
  currently-authorized instructor can create a course from
  `/instructor` ("+ Create course"). Ownership (`created_by`) comes
  only from `auth.uid()` inside the function — never client-supplied.
  A student calling the RPC directly is rejected.
- **"Who teaches this course" display** (`get_course_instructors()`,
  new this commit): a name-only (never email) attribution shown on
  course cards for both roles, falling back from the recorded creator,
  to the allowlist owner (if a member), to whichever instructor has
  been a member longest — written to avoid NULL-comparison surprises
  (see §12).

---

## 7. Material ingestion

1. Instructor uploads a file (PPTX/PDF/DOCX) through the Materials UI.
2. **PPTX**: parsed deterministically from its own XML
   (`src/lib/ingestion/pptx.ts`, using `fast-xml-parser`/`jszip`) into
   one `slides` row per slide with structured `title`/`text`/
   `speaker_notes`. No OCR, no LLM in this path.
3. **DOCX**: structured extraction via `mammoth`
   (`src/lib/ingestion/docx.ts`) into `material_versions.extracted_html`,
   rendered with `dangerouslySetInnerHTML` — safe *only* because this
   HTML is server-generated by a fixed converter from an instructor's
   own upload, never from user-typed free text.
4. **PDF**: the uploaded file *is* the rendered artifact — no
   conversion; `rendered_pdf_path` is set directly to the storage path.
5. **For the AI Tutor**: once a lecture/material is *published*,
   `scripts/backfill-material-chunks.mjs` (re-runnable) creates one
   `material_chunks` row per slide, with full provenance
   (`course_id`/`lecture_id`/`material_id`/`slide_id`) and a best-effort
   `learning_objective_id` (keyword-matched, nullable — a miss just
   means "no objective filter," never a fabricated one). This
   mirrors the exact published/draft visibility rule already enforced
   by RLS on `slides`, so retrieval can never surface draft content a
   student couldn't otherwise see.

---

## 8. AI/Tutor architecture

This is the most architecturally distinctive part of the system —
read `docs/AI_TUTOR_ARCHITECTURE.md` for the full decision record;
this is the summary.

- **Learning objectives are the spine**: `learning_objectives`
  (course-scoped) connect material chunks, assessment questions
  (`questions.learning_objective_id`), and practice into one model.
- **Offline compilation ("Course Intelligence")**: an instructor-
  triggered, per-objective rebuild (`reprocessLearningObjective()` in
  `src/lib/domain/course-intelligence-actions.ts`) calls Claude Sonnet
  *once* to produce a canonical explanation, common misconceptions,
  analogies, and a teaching progression, stored in
  `learning_objective_intelligence` and reused cheaply by every
  subsequent Tutor turn touching that objective. This call is
  **synchronous within the request** — no job queue exists yet (a
  named gap in `docs/PRODUCT_AND_ARCHITECTURE_REVIEW.md` §1).
- **Retrieval/grounding**: Postgres full-text search
  (`tsvector`/`ts_rank`) over `material_chunks`, **not embeddings** —
  Anthropic doesn't serve an embeddings endpoint, and the retrieval
  interface (`searchCourseMaterial`) is written provider-agnostically
  so swapping in `pgvector` later (the `embedding` column is reserved,
  unpopulated) means changing the function body, not any caller. This
  is a real, current quality ceiling: full-text search matches lexical
  overlap, not semantic similarity.
- **Entry contexts** (`TutorEntrySource` in `src/lib/tutor/orchestrator.ts`):
  `direct` (general course Tutor), `slide` ("Ask about this slide" —
  the exact slide's content is retrieved), `assessment_review`
  (reviewing a submitted attempt), `question_bank_practice` (explaining
  a practice answer), `performance` (objective-scoped, from evidence
  or "Learn with AI"). Each has its own authorization precondition
  (e.g. `assessment_review` requires the attempt to actually be
  submitted) re-checked on *every* turn, not just at session creation.
- **Runtime Tutor**: `src/lib/tutor/orchestrator.ts` assembles four
  explicitly labeled, separately-scoped prompt sections per turn —
  system policy, retrieved material (marked as *data, not
  instructions* — a real prompt-injection boundary), a student
  evidence summary, and bounded session history — then calls
  `getTutorProvider().generateTurn()`.
- **Model usage**: Claude Haiku 4.5 for interactive turns, Claude
  Sonnet 5 for the Course Intelligence compile step
  (`src/lib/tutor/provider.ts`, model names centralized there).
- **Fallback behavior**: if `ANTHROPIC_API_KEY` isn't configured, the
  Tutor reports itself unavailable rather than failing — the rest of
  the app (content, assessments, grades) works with zero AI
  dependency. See `docs/PRODUCTION_RUNBOOK.md` for what to do if the
  AI provider itself is degraded.
- **Cost-control architecture ("AI Usage Governor",
  `src/lib/tutor/governor.ts`)**: `reserve_ai_generation()`, a
  `SECURITY DEFINER` function with an advisory lock against races,
  enforces per-student-daily (8), per-course-daily (75), global-daily
  (100) limits and a 9-second per-request cooldown, plus course-level
  and global pause switches — all server-side, never a client-trusted
  check. Every AI-adjacent feature (Tutor, Practice explanations, Learn
  with AI's links into them) routes through this same reservation;
  nothing bypasses it.
- **Evidence vs. preferences — kept structurally and philosophically
  separate**: `get_student_objective_evidence`/`get_student_practice_evidence`
  (observed correctness, per objective, assessment vs. practice never
  blended) vs. `tutor_preferences` (four explicit small-enum fields a
  student sets directly — `explanation_style`/`correction_style`/
  `detail_level`/`practice_pacing` — **never** an inferred personality
  or "learning style" label; see §15). The orchestrator folds a
  one-sentence, normalized preference summary into context alongside
  the evidence summary — never the raw enum values, never forced in
  when nothing was set.
- **Citations/provenance**: retrieved material carries full source
  provenance (course/lecture/material/slide) internally for
  correctness and debugging; the current UI does not surface inline
  citations to the student. Worth noting as a gap, not a claim of
  existing functionality.
- **Zero-AI-cost features, deliberately**: the Learning Diagnostic
  (deterministic MCQ selection/grading) and Tutor preference collection
  both make **zero** provider calls — verified by an integration test
  asserting `ai_generation_events` doesn't grow after a full Diagnostic
  submission.

---

## 9. Assessments

- **One engine, every kind**: Mock Test (`kind='mock_test'`, never
  contributes to grade), Class Test (`kind='class_test'`, contributes
  to grade, questions must be `visibility='hidden'` — enforced server-
  side, not just a UI convention), Project (its own subsystem, no
  `attempts` row concept at all — see below), and the Learning
  Diagnostic (`is_diagnostic=true` on a `mock_test`, see §15's
  invariant about not touching the hidden pool). All non-Project kinds
  share `start_attempt`/`save_response`/`submit_attempt`/
  `get_attempt_view` — there is no separate code path per kind.
- **Selection**: `fixed` (instructor-picked exact questions) or
  `random` (rule-based, `assessment_rules` — source lecture/topic/
  difficulty/question-type/`visibility_filter` constraints, sampled
  fresh at `start_attempt` time and then **persisted** — a refresh
  never reshuffles an in-progress attempt).
- **Grading**: MCQ is auto-graded deterministically at
  `submit_attempt`. Written responses are **never auto-graded** —
  `attempts.pending_grading_count` tracks how many are still awaiting
  an instructor's `grade_written_response()` call, which recomputes
  and persists score/max_score/pending count so the gradebook never
  drifts from individual response grades.
- **Question banks**: `questions.visibility` is `'practice'` or
  `'hidden'`. Students have **zero** RLS read policy on `questions`/
  `question_options` at all — the only path to question content is
  `get_attempt_view()`, which withholds `is_correct` until
  `submitted_at is not null`. Practice (the ungraded, per-lecture
  self-quiz feature) and the Learning Diagnostic are both hard-scoped
  to `visibility='practice'` questions only.
- **Project grading**: entirely separate — `project_groups`,
  `project_group_members`, `project_deliverables`,
  `project_submissions`, `project_group_grades`. No `attempts` row.
  `get_course_gradebook()` **deliberately excludes** `kind='project'`
  assessments; `get_course_project_grades()` surfaces Project scores
  separately, merged in the UI, never cross-joined in one query (a
  cross-join here previously produced a real, documented "26 not
  started" bug — see `CLAUDE.md`).

---

## 10. Instructor experience

Six top-level workspaces: **Overview** (course list + "+ Create
course", new this commit), **Course Content** (Materials, Calendar,
Announcements), **Assessments** (Tests, Question Bank, Project),
**Students** (Roster, Gradebook), **Insights** (Performance, AI Tutor/
Course Intelligence status, AI usage), **Course Settings** (schedule,
enrollment, instructors, AI controls). Content management has
dependency-aware delete blocking (a Unit with lectures, a Lecture with
materials, or an ever-published material can't be hard-deleted —
archive instead, with a human-readable reason). Destructive actions
(Roster removal) live behind a contextual "⋯" menu, not a permanently-
visible button.

---

## 11. Student experience

Course Home, real slide-by-slide presentation viewing, "Ask about this
slide," per-lecture Practice with an AI explanation on a wrong answer,
"Learn with AI" (evidence-based recommendations or an honest "not
enough evidence yet" state), the Learning Diagnostic, assessments,
grades, a personal performance breakdown, announcements, calendar, and
a name-only classmates directory (opt-in per course).

---

## 12. Security model

- **RLS is the sole authorization boundary.** The UI hiding a button
  proves nothing; every meaningful check is re-derived server-side,
  inside Postgres, from `auth.uid()`.
- **Course isolation**: `current_course_role(course_id)` is checked
  (correctly — see the invariant below) everywhere a query needs to
  know "does this caller belong to this specific course, and as
  what." Cross-course access attempts are denied at this layer, not
  the application layer.
- **Instructor permissions**: never degrade into a client-side-only
  check anywhere in this codebase — every instructor-only RPC re-checks
  `current_course_role(...)` or `current_user_is_owner()` itself.
- **Student permissions**: students have zero RLS visibility into
  `questions`/`question_options` at all (see §9); an unrelated
  student cannot read another student's attempt, practice data, or
  Tutor session (each has an explicit `user_id = auth.uid()` scoping,
  verified by dedicated integration tests).

### The historical security lesson every future change must not reintroduce

A `SECURITY DEFINER` function's authorization check must use
`current_course_role(course_id) IS DISTINCT FROM 'instructor'`, **never**
`current_course_role(course_id) != 'instructor'`. The reason: this
function returns `NULL` for a caller with *no* relationship to the
course at all, and in PL/pgSQL's three-valued logic, `NULL != 'instructor'`
evaluates to `NULL` — which `IF ... THEN` treats as **false**, silently
skipping the `raise exception` and letting a completely unrelated
caller through as if authorized. `IS DISTINCT FROM` is NULL-safe and
always evaluates to a real boolean.

This exact bug was found and fixed once (an early migration), then
**reintroduced across 32 functions** by every later migration that
added a new instructor-only RPC and reused the unsafe `!=` idiom
instead of copying the fixed pattern — undetected for a long time
because the one dev test account was always a permanent course member,
so the "caller has zero relationship to this course" path was never
actually exercised. It was caught and fixed again (a dedicated
migration) only once real production data was cleaned up and a test
account's incidental permanent membership went away.

**When writing or reviewing any new authorization-sensitive SQL**:
grep for `current_course_role(` followed by `!=` before shipping it.
The same three-valued-logic trap applies to any boolean expression
built from a value that can be NULL — not just `IF` gates, but
`ORDER BY` tie-breakers and anything else — see
`get_course_instructors()` (this commit) for an example written
explicitly to avoid it (`c.created_by IS NOT NULL AND cm.user_id = c.created_by`,
never a bare `cm.user_id = c.created_by` that would silently evaluate
to NULL when `created_by` is unset).

---

## 13. Testing

- **`npm run test`** (Vitest): unit tests plus **live integration
  tests** — real accounts against the real hosted Supabase project,
  no mocked database. 119 tests across 15 files as of this commit,
  covering authorization boundaries (a student can't escalate, can't
  cross courses, can't read another student's data), the assessment
  engine, the AI Tutor's evidence/preference/quota model, and the
  instructor lifecycle fixed in this commit. Every file uses isolated,
  `TEST`-prefixed fixtures and cleans up in `afterAll` — see
  `CLAUDE.md`'s testing-conventions section, including why
  `vitest.config.mts` sets `fileParallelism: false`.
- **`npm run test:e2e`** (Playwright): real-browser tests, desktop
  (1440×900) and mobile (~390×844) viewports, against a running
  `npm run dev` (or, by setting `PLAYWRIGHT_BASE_URL`, against a live
  deployment). Covers login, navigation, the full Learning Diagnostic
  flow, course creation, and the real Lecture 01 PPTX presentation
  rendering. `e2e/global-setup.ts`/`global-teardown.ts` manage a
  synthetic dev-student's temporary course membership.
- **`npx tsc --noEmit`** — typecheck.
- **`npx eslint .`** — lint. One pre-existing, documented,
  low-risk finding remains (`practice-session.tsx`, a `setState`-in-
  `useEffect` pattern) — see `docs/PRODUCT_AND_ARCHITECTURE_REVIEW.md` #7.
- **`npm run build`** (`next build`) — production build.
- **Both test layers write to and read from the live, shared database**
  (see §14 and `docs/SAFE_DEVELOPMENT.md`) — this is a deliberate,
  long-standing choice (RLS is the thing actually being tested; a
  mocked database would test nothing real), not an oversight, but it
  means running the suite is not a "safe by default" action the way it
  would be against an isolated test database.

---

## 14. Deployment

- **Vercel project**: `tiferet/university-lms`. **Not connected to
  GitHub for automatic deployments** — confirmed by inspecting deploy
  history (every deployment's origin is the CLI user, none show a git
  commit reference). Every deployment so far has been a manual
  `vercel --prod` run from local code. Pushing to `main` on GitHub
  does **not** trigger a Vercel rebuild.
- **Function region: `syd1` (Sydney)**, pinned via a committed
  `vercel.json` (`{"regions": ["syd1"]}`) as of 2026-09-22 —
  deliberately co-located with Supabase (`ap-southeast-2`), not the
  Vercel default (`iad1`/Virginia). Measured cause: median per-call
  Supabase latency dropped from ~284ms (`iad1`) to ~26ms (`syd1`) for
  identical code in a controlled Preview-vs-Preview experiment; see
  `docs/PERFORMANCE_OPTIMIZATION_2026-09-22.md` Phase 4 for the full
  investigation and `docs/HANDOFF_NEXT_SESSION.md` for the cutover
  narrative. Rollback reference (previous known-good `iad1` production
  deployment): `dpl_CUUN61wSmPnwzpwCjjT1xvMbnZxR` — `vercel rollback`
  or `vercel promote dpl_CUUN61wSmPnwzpwCjjT1xvMbnZxR` restores it
  instantly, no rebuild, no Supabase involvement either direction.
- **Environment variables**: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
  `ANTHROPIC_API_KEY` — configured **only** for the "Production"
  environment in Vercel; no Preview/Development environment variables
  exist. A manual non-production (`vercel`, no `--prod`) deploy would
  therefore have zero database access rather than touching real data —
  a lucky accident of the current config, not a designed safeguard.
- **Database**: one Supabase project, used by local development,
  every test suite, and the Vercel production deployment alike. No
  staging database exists yet — see `docs/SAFE_DEVELOPMENT.md` and
  `docs/PRODUCT_AND_ARCHITECTURE_REVIEW.md` #20.
- **Production deployment process**: `npx vercel --prod --yes` from a
  verified, clean working tree — see `docs/PRODUCTION_RUNBOOK.md` for
  the full checklist (verify locally first, review the diff, confirm
  migrations if any, deploy, verify against the live URL).
- **Migrations are applied directly against the live database**
  (`node --env-file=.env.local scripts/run-migrations.mjs`) —
  there is no separate migration-deploy step tied to the Vercel
  deployment; schema changes and code changes are deployed
  independently, in whichever order the change requires (usually
  migration first, then code that depends on it).

No secrets are reproduced in this document.

---

## 15. Architectural invariants — do not casually change these

- **RLS is the security boundary.** Never implement an authorization
  check only in a Server Action or client component; every check must
  be re-derivable and re-verified inside Postgres.
- **`auth.uid()` is the only canonical identity.** Never trust a
  client-supplied user ID, email, or role for anything that gates
  access.
- **`current_course_role()` comparisons must use `IS DISTINCT FROM`,
  never `!=`** — see §12. This has bitten this project twice already.
- **Grading is deterministic where it's supposed to be.** MCQ grading
  is pure SQL, no model call, ever. Written responses are graded by a
  human, never automatically — if this is ever revisited, it must be
  "AI suggests, instructor confirms," never fully automatic.
- **The AI is never the source of truth for a grade.** It can explain,
  tutor, and practice; it does not decide `score`/`max_score` on any
  assessment.
- **Course-scoped retrieval must stay course-scoped.** The Tutor's
  material search must never cross a `course_id` boundary, and must
  never surface unpublished content — both are currently enforced by
  construction (RLS on `slides`, the chunking backfill's own
  published-only filter).
- **The published/unpublished (draft) boundary must remain respected**
  everywhere content visibility is decided — retrieval, the student
  content pages, and the RLS policies on `lectures`/`materials`/`slides`.
- **The AI cost-governance architecture is intentional, not
  incidental** — every AI-adjacent feature must route through
  `reserve_ai_generation()`. A new feature that calls the model without
  going through the governor is a bug, not a shortcut.
- **Instructor permissions must never degrade into a client-side-only
  check.** Every instructor-only RPC re-derives authorization itself.
- **Migrations must remain forward-only and reproducible** — no
  editing an already-applied migration file; a correction is a new
  migration (see `0048` fixing `0047`'s overload mistake, and this
  commit's `0049`).
- **Real student data must never enter tests, fixtures, or public
  source.** Every integration test uses synthetic, clearly-named,
  cleaned-up fixtures. A real secret-scanning pass was done before this
  repository went public — see the commit history for what was found
  and excluded (`Class Materials CSE 1203/`, the real question bank
  with its answer key, and real student PII that had leaked into an
  internal handoff doc and a test file were all found and removed
  before the first public push).
- **Instructor authentication identity and instructor authorization
  are separate concepts** (this commit's fix, made explicit as an
  invariant): revoking instructor access must never delete a
  Supabase Auth identity, and re-authorizing must never require
  creating a duplicate account.

---

## 16. Known limitations

Documented honestly, not to be silently "fixed" without reading
`docs/PRODUCT_AND_ARCHITECTURE_REVIEW.md` first — most of these are
deliberate sequencing decisions, not oversights:

- No staging/isolated database — local dev, tests, and production
  share one Supabase project (see §14, `docs/SAFE_DEVELOPMENT.md`).
- No CI pipeline — `typecheck`/`lint`/`test`/`build` are run by hand.
- No error-tracking/observability platform — failures are
  `console.error`, visible via `vercel logs` only.
- No institutional/multi-tenant layer — every instructor currently has
  access to every course (a Milestone-1 simplification, not a bug).
- Full-text search retrieval, not embeddings (a real quality ceiling,
  not a correctness bug).
- No SSO, no bulk enrollment, no weighted grading, no rubrics, no
  accessibility audit/VPAT, no written privacy policy.
- No PWA/offline resilience, despite a mobile-first, connectivity-
  constrained target market.
- English-only UI (no Bangla localization).
- One pre-existing lint finding in `practice-session.tsx` (a
  `setState`-in-effect pattern) — low risk, not yet fixed.

See `docs/PRODUCT_AND_ARCHITECTURE_REVIEW.md` for severity
classification (CRITICAL/HIGH VALUE/MEDIUM VALUE/LATER) and proposed
fixes for each of these.

---

## 17. Next recommended work

Do not duplicate the full roadmap here — see
`docs/PRODUCT_AND_ARCHITECTURE_REVIEW.md` Part 4 for the staged plan
(Stage 0 through Stage 5) and its "smallest sequence that increases
credibility the most" recommendation (CI, error tracking, a staging
environment, grade categories + CSV export, the security-lint check).
`docs/PITCH_STRATEGY.md` covers how to talk about this system
externally with the same honesty this document tries to maintain
internally.
