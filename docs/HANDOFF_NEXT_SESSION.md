# Handoff — Data Cleanup, Security Fix, Polish Pass, Learn with AI, Production Release (2026-09-20)

Written at the end of a session that: cleaned CSE 1203's real student
data, found and fixed a critical live authorization vulnerability,
repaired the resulting test-suite fallout, fixed three reported product
bugs, restructured the instructor navigation, raised the typography
scale, shipped a new "Learn with AI" front door + non-graded Learning
Diagnostic + explicit Tutor preferences, added real Playwright browser
tests, and deployed to production. See `CLAUDE.md` for the durable
architectural rules this session established (read the "Security:
`!=` vs `is distinct from`" section before writing any new
instructor-only RPC) — this document is the point-in-time status.

Migrations: **0001 through 0048** are applied to the hosted Supabase
project (the same project backs both local dev and the Vercel
production deployment — there is no separate prod database). Run
`node --env-file=.env.local scripts/run-migrations.mjs` first if
picking this up; it no-ops if nothing is pending.

## Production

- **Live URL**: https://university-lms-tiferet.vercel.app (alias of
  https://university-lms-three.vercel.app — both point at the same
  deployment, Vercel project `tiferet/university-lms`).
- **Deployment ID**: `dpl_3mykfLav6NcW4rsAAMSAFG8zoMtN`, deployed via
  `vercel --prod` from this session's final state.
- 11 Playwright tests (login, nav, profile, Calendar, Assessments,
  Roster, Learn with AI, the full Learning Diagnostic flow, and the
  real Lecture 01 PPTX presentation-regression check) were run against
  this exact production URL after deployment and all passed.

## What's VERIFIED WORKING this session (live-tested, not just code review)

- **Real student data cleanup**: CSE 1203's `course_members` is
  exactly the 4 real, currently-enrolled students + 2 instructors
  (see the private ops notes, not this public-facing doc, for the
  actual roster). All course-scoped synthetic
  attempts/practice_attempts/tutor_sessions/enrollment_requests
  cleared for both the removed test accounts and the four real
  students (a clean slate, per the instructor's explicit request).
- **Critical security fix**: 32 SECURITY DEFINER functions had a
  regressed NULL-check bug (`current_course_role() != 'instructor'`
  silently passes for a caller with NO relationship to the course at
  all — see `CLAUDE.md`). Found via the calendar integration test
  after the roster cleanup removed the dev fixture's permanent
  membership; audited the LIVE database (not just migration files,
  since later `create or replace` calls can supersede earlier fixes);
  fixed in `0046_fix_instructor_check_regression.sql`. Verified no
  non-member can reach any of the 32 functions.
- **Full integration test suite repaired**: the roster cleanup broke
  every test file that assumed a fixture account was permanently
  enrolled. Fixed via a shared `ensureCourseMembership`/
  `removeCourseMembershipIfAdded` helper
  (`src/lib/test-support/course-membership.ts`) applied across all
  affected files, plus `fileParallelism: false` in `vitest.config.mts`
  (parallel workers were racing on shared course data). **111/111
  vitest tests pass** (was 101 before this session; +10 new for the
  security fix regression test + Diagnostic/preferences).
- **Profile name display fix**: root cause was `getMyFullName()`
  querying `profiles` without filtering to the caller's own row — an
  instructor's `profiles` RLS visibility also includes their students'
  profiles (`0019_profiles.sql`), so an unfiltered `.maybeSingle()`
  could return the wrong row or error on multiple rows. Fixed in
  `src/lib/supabase/course.ts` and the same pattern in
  `src/lib/tutor/orchestrator.ts`. Separately discovered instructors
  had NO UI path to ever set their own `full_name` (only students did)
  — wired the existing `ProfileCompletionBanner` into the instructor
  Overview page too. Instructor's name is now set to "Ahmed Ezaz Labib".
- **Material delete 404 fix**: root cause was `ContentItemMenu`
  calling `router.refresh()` after every mutation including delete —
  when the current page IS the just-deleted object's own detail page,
  that re-fetches a 404. Added `deleteRedirectTo` prop, used only where
  a menu lives on the deleted item's own page (the Material detail
  page → redirects to its Lecture); list-context deletes (Unit/Lecture
  rows on the Content list page) still just refresh in place, which
  was always correct there.
- **Calendar**: meeting days (Monday/Saturday) were already configured
  from an earlier session; the "no schedule configured" banner
  incorrectly fired even with days set because term start/end dates
  were still null — fixed the banner to say precisely what's missing.
  Timezone set to `Asia/Dhaka`. Term start/end dates are intentionally
  left null — the instructor was asked and chose to enter them later
  via the already-working Settings form.
- **Instructor navigation restructure**: the 12-tab horizontal strip
  collapsed into 6 top-level sections (Overview, Course Content,
  Assessments, Students, Insights, Course Settings) with a second-row
  local sub-nav shown only for the active section
  (`src/components/shell/course-context-bar.tsx`, now section-based
  instead of flat tabs). Purely presentational — every route is
  unchanged, nothing moved. Student nav intentionally left flat (12
  items) — not part of the reported problem, and explicitly told not
  to redesign pages that already look good; "Learn with AI" was added
  to it with a "New" badge.
- **Typography**: reinterpreted Tailwind's `text-xs/sm/lg/xl/2xl/3xl`
  scale via `@theme inline` tokens in `globals.css` instead of editing
  hundreds of call sites — `text-xs` 12→15px, `text-sm` 14→16px,
  `text-lg` 18→20px, `text-xl` 20→28px, `text-2xl` 24→30px, `text-3xl`
  30→38px, each with a paired line-height. The tiny UI chrome that
  already used explicit `text-[10px]`/`text-[11px]` arbitrary values
  is untouched by design. `--color-muted` darkened from `#747985` to
  `#5f6470` (was ~4.0:1 contrast on the page background, failing WCAG
  AA's 4.5:1 for normal text; now ~5.5:1).
- **Progressive disclosure**: Roster's permanently-visible red "Remove"
  button replaced with a "⋯" menu (`RosterActionMenu`) — removal is
  now a confirmed, contextual action instead of dominating every row.
- **Learn with AI** (`/student/courses/[courseId]/learn-with-ai`): new
  front door, zero new AI/session code — every action links into an
  existing surface (see `CLAUDE.md`). Shows "Review weak areas" +
  "Continue learning" when evidence exists, an honest "complete the
  Diagnostic or some Practice" message when it doesn't — never a
  fabricated recommendation.
- **Learning Diagnostic**: a real, published, unlocked, non-graded
  `assessments` row ("Learning Diagnostic — Practice Test",
  `is_diagnostic = true`, kind `mock_test`), 10 questions randomly
  drawn (5 from Lecture 01, 5 from Lecture 02) from the real
  Practice-visible bank via a new `assessment_rules.visibility_filter`
  mechanism that's enforced inside `start_attempt()` itself, not just
  an accident of how the bank happens to be organized today (verified
  with a throwaway mixed-visibility bank: 4 hidden questions never won
  against 1 practice question across the actual random selection).
  Reuses the exact existing attempt-taking architecture — zero new
  grading code, zero AI provider calls (verified: `ai_generation_events`
  count is unchanged after a full submit). A submitted attempt
  automatically counts toward the student's own evidence (Learn with
  AI) since the existing evidence RPCs aggregate over any submitted
  attempt regardless of kind.
- **Tutor preferences**: `tutor_preferences` table (own-row-only RLS),
  four explicit small-enum fields, never an inferred personality/
  "learning style" label. Collected via a short form on the
  Diagnostic's results page, folded into the Tutor's prompt context as
  one normalized sentence. Verified: invalid enum values rejected,
  another student cannot read or forge-write a different student's row.
- **Real browser verification**: `playwright.config.ts` + `e2e/*.spec.ts`
  are genuinely working (Chrome extension for interactive browsing was
  unavailable this session — Playwright was set up instead). 11 tests
  × 2 projects (desktop 1440×900, mobile ≈390×844) = 16 applicable runs,
  all passing against `next dev`, then all 11 desktop tests re-run and
  passing against the live production deployment. Covers: instructor
  login/nav/profile/Calendar/Assessments/Roster, student login/Learn
  with AI/full Learning Diagnostic flow (start → persisted-on-refresh
  → submit → zero-grade result → preferences save)/real Lecture 01
  PPTX rendering, mobile no-horizontal-scroll, and
  `prefers-color-scheme: dark` staying light (deliberate, per the
  existing `color-scheme: light` decision).
- Typecheck, `next build`, and `next build`-then-deploy all clean.
  Zero leftover synthetic residue confirmed after both the vitest and
  Playwright runs (checked directly: CSE 1203 roster exactly the 4+2,
  zero Diagnostic attempts, zero `tutor_preferences` rows, zero
  `TEST%`-prefixed question banks).

## What's NOT done / explicitly deferred this pass

- **Full manual interactive browser verification** — the Claude in
  Chrome extension was not connected this session, so all "actually
  exercise it in a browser" verification was done via real Playwright
  runs instead (see above), which is real browser automation but a
  narrower slice than a human click-through of every listed page
  (e.g., DOCX rendering, Class Test lock behavior, Project workflow,
  AI Usage page, dark-mode visual inspection beyond the one background-
  color assertion). The underlying pages/RPCs are otherwise covered by
  the vitest integration suite.
- **CSE 1203 term start/end dates** — still null. The instructor was
  asked directly and chose to enter them later via Settings; "verify
  September 2026 visibly" therefore couldn't be checked against the
  real course (the underlying generation logic IS verified correct for
  an arbitrary date range via the calendar integration test's November
  2026 exact-count assertion).
- **Gradebook compact-summary / expand redesign, primary-action-rule
  audit across every page, per-page visual-density pass beyond the
  global typography tokens** — these were listed in an earlier
  checkpoint's "not started" list and remain not started; this
  session's explicit instruction was "do NOT do another major
  information-architecture redesign" and to prioritize the Learning
  Diagnostic release over further aesthetic work.
- **Second Tutor-preferences entry point** — currently only editable
  from the Diagnostic results page, not from a standalone
  profile/settings surface. Acceptable for this pass ("student should
  eventually be able to change them"), worth a dedicated home later.
- No `git commit` was made this session (per standing instructions:
  only commit when explicitly asked) — all changes are in the working
  tree, and the Vercel deployment was built directly from that tree.

## If you pick this up next

1. Run the migration script and the full test suite first
   (`npm run test`, then `npm run test:e2e` against a running
   `next dev`) — both should be fully green with zero setup.
2. If the instructor gives you real Fall 2026 term start/end dates,
   set them via Settings → Course Schedule (or `set_course_schedule`
   directly) and re-verify the Calendar shows September 2026 sessions.
3. Before writing any new instructor-only SECURITY DEFINER function,
   read the "Security: `!=` vs `is distinct from`" section of
   `CLAUDE.md` — grep for `current_course_role(` + `!= '` in whatever
   you write before shipping it.
4. Nothing was committed to git this session. Confirm with the user
   before committing, and before any further production deploys.
