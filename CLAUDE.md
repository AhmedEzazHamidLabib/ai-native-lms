@AGENTS.md

# Coursework — durable architectural rules

These rules are project-specific and persist across sessions (unlike
the Next.js block above, which `next dev` regenerates).

## READ THIS FIRST

This is a **live production application** — a real instructor is
teaching a real course (CSE 1203, Premier University) with it, on a
database shared with local development (see "Production safety" below
before running anything that writes to it).

- **Full architecture**: `docs/ARCHITECTURE_HANDOFF.md` — read this
  before touching auth, the database, or the AI Tutor. It's written so
  you don't have to reverse-engineer the repository from scratch.
- **What's safe to do right now**: `docs/SAFE_DEVELOPMENT.md`.
- **Operational issues**: `docs/PRODUCTION_RUNBOOK.md`.
- **Critical self-assessment + roadmap**: `docs/PRODUCT_AND_ARCHITECTURE_REVIEW.md`.
- **External positioning**: `docs/PITCH_STRATEGY.md`.
- **Point-in-time session status**: `docs/HANDOFF_NEXT_SESSION.md` (may
  be stale — `docs/ARCHITECTURE_HANDOFF.md` is the maintained source of
  truth for how the system actually works).
- **Academic domain model**: `docs/COURSEWORK_LEARNING_ARCHITECTURE.md`.

### Branch strategy

- `main` — production-safe, known-good code. Tag `v0.1.0-live-pilot`
  (commit `637091a`) is the frozen baseline used for live teaching;
  redeploy it via `docs/PRODUCTION_RUNBOOK.md` if a later change
  breaks production.
- `develop` — ongoing integration/development, branched from the same
  known-good commit.
- `feature/*` — substantial individual changes, where useful.
- Vercel production deploys are **manual** (`vercel --prod`), **not**
  triggered automatically by pushing to `main` — see
  `docs/ARCHITECTURE_HANDOFF.md` §14. Pushing docs/config to GitHub
  does not affect the live site by itself.

### Production safety — the essential rule

Local dev, every test suite, and production **share one Supabase
database**. Before running any migration, schema change, or script
that uses `SUPABASE_SECRET_KEY`, read `docs/SAFE_DEVELOPMENT.md`. Before
writing or reviewing any new authorization-sensitive SQL, read the
"historical security lesson" in `docs/ARCHITECTURE_HANDOFF.md` §12
(the `!=` vs `IS DISTINCT FROM` NULL trap — it has already caused two
real incidents in this project).

### Commands that must pass before merging to `main`

```bash
npx tsc --noEmit
npx eslint .
npm run test        # live integration tests — see docs/SAFE_DEVELOPMENT.md
npm run build
```

Add `npm run test:e2e` (Playwright, requires `npm run dev` running, or
point `PLAYWRIGHT_BASE_URL` at a deployment) for anything touching
login, navigation, or the assessment-taking flow. There is no CI
pipeline yet — these are run by hand; see
`docs/PRODUCT_AND_ARCHITECTURE_REVIEW.md` #7 for why that's a named gap.

## Migrations

- Apply with `node --env-file=.env.local scripts/run-migrations.mjs`
  (tracked in `_lms_migrations`, transactional, safe to re-run). Never
  `supabase db push` — no Docker/browser OAuth available on this
  machine (see `docs/DECISIONS.md`).
- Changing an existing function's `returns table (...)` shape requires
  `drop function if exists ...;` before `create function` — Postgres
  refuses an in-place return-type change via `create or replace`.
- **`create or replace function` only replaces a function with the
  EXACT SAME parameter list.** Adding a new parameter — even a trailing
  one with a default — creates a SECOND overload instead of replacing
  the first. This broke every `create_assessment()` call site in
  production for real (`0047` added `p_is_diagnostic`, `0048` had to
  `drop function create_assessment(<old 10-arg signature>)` to fix the
  resulting "Could not choose the best candidate function" errors).
  When adding a parameter to an existing function, always pair the
  `create or replace` with an explicit `drop function if exists
  <name>(<old signature>);` in the SAME migration, or do the drop in a
  follow-up migration immediately after.
- Before trusting migration file history to know what a function
  currently does, check the LIVE definition — a later migration's
  `create or replace` can silently supersede an earlier fix (this is
  exactly how the NULL-authorization-check regression below went
  undetected for years).

## Security: the `!=` vs `is distinct from` NULL-check trap

- **Never write `if current_course_role(p_course_id) != 'instructor'
  then raise exception ... end if;`** in a SECURITY DEFINER function.
  `current_course_role()` returns NULL for a caller with no
  relationship to the course at all, and `NULL != 'instructor'` is
  NULL — which `IF NULL THEN` treats as **false** in PL/pgSQL's
  three-valued logic, silently skipping the exception. A caller who
  isn't even a student in the course sails through as if authorized.
- Always use `is distinct from` instead: `if current_course_role(p_course_id)
  is distinct from 'instructor' then raise exception 'Not authorized.';
  end if;` — this is NULL-safe (`NULL is distinct from 'instructor'`
  is `true`, correctly rejecting).
- This bug was first found and fixed once already, in
  `0011_fix_null_instructor_check.sql`. Every migration written AFTER
  0011 that added a new instructor-only function reused the vulnerable
  `!=` idiom anyway, silently reopening the same hole across 32
  functions — undetected because the dev test fixture account
  (`dev-student@example.test`) was a PERMANENT CSE 1203 member, so the
  "caller has zero relationship to this course" code path never
  actually got exercised by any test. It was only caught on 2026-09-20
  when the real CSE 1203 roster was cleaned to the four real students
  and an integration test's fixture account was, for the first time,
  genuinely a non-member — `set_course_schedule` let it through anyway.
  Fixed in `0046_fix_instructor_check_regression.sql`. **Grep for
  `current_course_role(` and `!= '` before shipping any new
  instructor-only RPC**, and prefer copying an existing `is distinct
  from` check over writing a new authorization check from scratch.

## Content management (Units/Lectures/Materials)

- Soft-delete only: `archived_at` on all three tables. Archiving a
  lecture/material auto-clears `published_at`; restoring never
  auto-republishes (deliberate — avoids silently re-exposing content).
- Never write these tables directly from a Server Action — always go
  through `rename_unit/lecture/material`, `reorder_unit/lecture/material`,
  `set_unit/lecture/material_archived`, `delete_unit/lecture/material_if_unused`
  (all instructor-authorized, dependency-checked SECURITY DEFINER RPCs
  in `0043_content_management.sql`). A hard delete is only ever allowed
  when nothing depends on the row (no children, no evidence, never
  published) — otherwise it raises a human-readable reason to archive
  instead.

## Material rendering

- **PDF**: the uploaded source file *is* the rendered artifact — no
  conversion. The upload route sets `rendered_pdf_path = storagePath`
  immediately; reuses the existing signed-URL viewer.
- **DOCX**: real structured extraction via `mammoth`
  (`src/lib/ingestion/docx.ts` → `material_versions.extracted_html`),
  rendered with `dangerouslySetInnerHTML` in
  `src/components/course/document-viewer.tsx`. This is safe *only*
  because the HTML is server-generated by a fixed converter from an
  instructor's own upload — never do this for user-typed free text.
- Legacy binary `.doc` is **not supported** (mammoth can't parse it) —
  don't advertise it in any UI copy; only `.docx`.
- PPTX is unchanged: `src/lib/ingestion/pptx.ts`, no LLM, no OCR.

## Written Q&A (assessment engine)

- `questions.question_type`: `'single_choice' | 'written'`. A written
  question has **zero** `question_options` rows; use `answer_guide`
  (grading reference, never shown to students pre-grading) and
  `explanation` (shown to everyone once revealed) instead.
- Written responses are **never auto-graded**. `attempts.pending_grading_count`
  tracks how many written answers on that attempt are still ungraded —
  always show "Awaiting grading," never fold an ungraded written answer
  into the score as if it were wrong. Grading goes through
  `grade_written_response()` (instructor-only), which recomputes and
  persists `attempts.score/max_score/pending_grading_count` so the
  gradebook never drifts from individual response grades.
- `save_response()` now takes an optional `p_text_response` — routes to
  `responses.text_response` when the question is written, to
  `selected_option_id` otherwise. Both engines share `start_attempt`/
  `submit_attempt`/`get_attempt_view` — there is deliberately no
  separate "written assessment" code path.

## Gradebook / Project completion

- `get_course_gradebook()` **excludes `kind = 'project'` assessments on
  purpose** — Project completion has no `attempts` row concept at all
  (it's tracked via `project_group_grades`, surfaced through
  `get_course_project_grades()`). Cross-joining students × *all*
  assessments including Project is exactly what produced the "26 not
  started" bug (Project is unconditionally "not started" for everyone,
  every time, since it never gets an attempt). If you touch gradebook
  aggregation again, keep these as two separate, explicitly-merged
  queries — never one blended cross-join.

## Announcements

- Body is **plain text, always** — `src/components/ui/formatted-text.tsx`
  does a small, fully-controlled bold/italic/bullet parse into React
  elements directly (no HTML, no `dangerouslySetInnerHTML`). This *is*
  the sanitization strategy: there's no HTML parser in the loop, so
  there's nothing to sanitize. Don't introduce a rich-text/HTML editor
  for this without re-deciding that tradeoff deliberately.

## Calendar

- Recurring class sessions are **never stored as rows** — computed
  deterministically in `get_course_calendar()` from
  `courses.meeting_days/start_date/end_date/timezone`. Only per-date
  instructor annotations (`course_session_notes`, one row per
  *annotated* date) and one-off `course_events` are persisted.
- An event/session's linked announcement (`announcement_id`) is
  **updated in place** on re-edit, never re-created — see
  `syncLinkedAnnouncement()` in `src/lib/domain/calendar-actions.ts`.
- The real CSE 1203 course has `meeting_days: ['monday','saturday']`
  and `timezone: 'Asia/Dhaka'` set, but **still no `start_date`/`end_date`**
  as of 2026-09-20 — those were never given and must not be invented;
  the instructor was asked and chose to enter them later via
  Settings → Course Schedule (the form already exists and works,
  `src/components/instructor/course-schedule-form.tsx`). Until they're
  set, the Calendar page correctly shows a "meeting days are set, but
  no term range" notice rather than claiming nothing is configured.

## Settings

- Course schedule / timezone / roster-visibility live directly on
  `courses`, written only via `set_course_schedule()` /
  `set_course_roster_visibility()` (validation lives in the RPC, not
  scattered across callers).

## Testing conventions (live integration tests)

- Tests hit the **real hosted Supabase project** via
  `scripts/.dev-credentials.json` — there is no local/mocked DB.
  Always use isolated fixtures with a `TEST` prefix and clean them up
  in `afterAll`; never assume a `beforeAll` insert succeeded without
  checking — a leftover row from a previously-crashed run can collide
  on a unique constraint and return `null` silently, cascading into a
  confusing null-pointer failure much later. Sweep for orphaned
  `TEST%`-prefixed rows across affected tables if a suite ever times
  out or crashes mid-`beforeAll`.
- Running the full suite repeatedly in a short window can trip
  Supabase Auth's rate limiter (`"Request rate limit reached"`). Treat
  that specific error as transient — re-run the single failed file in
  isolation before concluding it's a real regression.
- **No fixture account is a permanent CSE 1203 member anymore** (the
  real roster is exactly the instructor's 4 real students, as of the
  2026-09-20 cleanup). Every integration test that needs a student in
  a real course must call `ensureCourseMembership`/
  `removeCourseMembershipIfAdded` from
  `src/lib/test-support/course-membership.ts` in its own
  `beforeAll`/`afterAll` — never assume `credentials.student` etc. is
  already enrolled. `ensureCourseMembership` reports whether IT added
  the row, so cleanup never removes a real, pre-existing enrollment.
- `vitest.config.mts` sets `fileParallelism: false`. These integration
  files all share ONE live course's data (schedule, course_members,
  even the same fixture accounts) — running them in parallel worker
  processes raced on inserts/deletes. Do not re-enable parallelism
  without re-solving that.

## Playwright (e2e, real browser against `next dev` or a live deployment)

- `playwright.config.ts` + `e2e/*.spec.ts` are real, working browser
  tests — not aspirational. Run with `npm run test:e2e` (desktop +
  mobile projects) while `next dev` is running on :3000, or against
  a live deployment with `PLAYWRIGHT_BASE_URL=https://... npx
  playwright test`. `e2e/global-setup.ts`/`global-teardown.ts` ensure
  and then remove `dev-student@example.test`'s CSE 1203 membership and
  clean up any Diagnostic attempt / tutor_preferences row it created —
  same "no permanent membership" reality as the vitest suite above.
- `waitForLoadState("networkidle")` right after a Server-Action-driven
  form submit can resolve **before** the resulting client-side redirect
  actually happens — use `page.waitForURL(...)` for login/submit flows.
- Navigating to the same URL twice in a row (e.g. `/login` → screenshot
  → `/login` again) can leave a form stuck in a "Please wait…" state.
  Reuse the already-loaded page instead of re-navigating to it.
- Next.js's own dev-tools button has the accessible name **"Next"**
  (and, confusingly, some MCQ options in the real question bank
  literally start with "The next..."). `getByRole("button", { name:
  "Next" })` needs `exact: true` AND to be scoped to `page.locator("main")`
  or it will strict-mode-fail against either. Same caution applies to
  any other single-word button name.
- Attempts are one-per-user: rerunning a spec that starts a real
  assessment (e.g. the Learning Diagnostic) against the same fixture
  account without resetting first lands on the results page instead of
  the start screen the second time. `e2e/helpers.ts`'s
  `resetDiagnosticAttempt()` deletes the fixture's prior attempt before
  each run — reuse this pattern for any other spec that starts an
  assessment attempt.

## Learn with AI / Learning Diagnostic / Tutor preferences (2026-09-20)

- **Learn with AI** (`/student/courses/[courseId]/learn-with-ai`) is a
  pure front door — zero new AI/session code. Every action on it links
  into an already-shipped surface: "Review with AI" →
  `/tutor?entry=performance&objective=<id>` (pre-existing `TutorEntrySource`),
  "Practice with AI" → the existing `/practice` catalog, "Ask about the
  course" → the existing `/tutor`. It reads evidence via the existing
  `get_student_objective_evidence`/`get_student_practice_evidence` RPCs
  (`src/lib/tutor/evidence.ts`) — never a new evidence table.
- **Learning Diagnostic** ("Learning Diagnostic — Practice Test",
  `assessments.is_diagnostic = true`) is a REAL `assessments` row, kind
  `mock_test` (already non-grading by construction —
  `contributes_to_grade := (p_kind = 'class_test')` in
  `create_assessment`), going through the exact same
  `start_attempt`/`save_response`/`submit_attempt`/`get_attempt_view`
  path as every other assessment. `assessment_rules.visibility_filter`
  (`'practice' | 'hidden' | null`) is the new mechanism that keeps its
  random selection scoped to Practice-visible questions only, enforced
  inside `start_attempt` itself (`0047_diagnostic_and_tutor_preferences.sql`)
  — not just an accident of today's bank layout. A submitted Diagnostic
  attempt counts toward the student's own evidence automatically
  (the evidence RPCs aggregate over any submitted attempt in the
  course, regardless of kind) — no separate evidence-writing code.
  Zero AI provider calls occur for MCQ selection or grading.
- **Tutor preferences** (`tutor_preferences` table, one row per user,
  RLS own-row-only) are four explicit small-enum fields —
  `explanation_style`/`correction_style`/`detail_level`/`practice_pacing`
  — never an inferred personality or "learning style" label. Set via
  `upsert_my_tutor_preferences()`, read via
  `src/lib/tutor/preferences.ts`, folded into the Tutor's context as
  one normalized sentence (`formatTutorPreferenceSummary`) appended
  next to the existing evidence summary in `orchestrator.ts` — never
  the raw enum values, never forced in when nothing was set. Collected
  on the Diagnostic's results page (`DiagnosticSummary` component,
  above the untouched `AttemptResults`) and editable there anytime.

## `"use server"` files

- May only export **async functions**. Any plain constant, interface,
  or initial-state object must live in a sibling `*-client-types.ts`
  file, imported separately by the actions file and any client
  component that needs it. Hit repeatedly across sessions — this is
  now the standard pattern for every new actions file.

