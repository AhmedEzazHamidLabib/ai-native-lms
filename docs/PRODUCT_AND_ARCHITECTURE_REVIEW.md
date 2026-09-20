# Product & Architecture Review

Written 2026-09-20, based on direct inspection of the codebase in this
repository — not a generic LMS review. Every "current state" claim
below is backed by a specific file, migration, or test in this repo;
every "limitation" is something the code actually does or doesn't do
today, not a hypothetical.

This document is intentionally critical. Its job is to tell the truth
about where this system is strong, where it's a real prototype rather
than a product, and what it would take to close that gap — not to
flatter the current state.

**How to read the severity labels**: CRITICAL = would embarrass or
harm you if a second real course, or an outside evaluator, hit it
today. HIGH VALUE = the single biggest lever for credibility per unit
of effort. MEDIUM VALUE = real, worth doing, not urgent. LATER = valid
but premature before you have more than one course/instructor to
justify it.

---

## Part 1 — Critical Analysis (24 perspectives)

### 1. Architecture

**Current state**: Next.js 16 App Router, Server Components/Actions,
one Supabase project (Postgres + Auth + Storage) as the only backend.
No queue, no background job runner, no cache layer beyond Next's own
data cache, no separate API service. Authorization logic lives almost
entirely in Postgres (`SECURITY DEFINER` functions), which is unusual
for a Next.js app and is this project's most distinctive architectural
choice.

**Limitation**: everything that isn't a page render or a quick RPC call
runs synchronously inside an HTTP request/Server Action — including
the Course Intelligence rebuild, which makes a real Claude Sonnet call
and blocks the instructor's request until it returns
(`src/lib/domain/course-intelligence-actions.ts`). There is no retry
queue, no way to kick off a long job and poll for completion, and no
protection against a serverless function timeout if source material
gets large.

**Why it matters**: this is fine at one course's scale (a handful of
learning objectives, reprocessed rarely). It stops being fine the
moment there are enough courses/objectives that "someone is always
reprocessing something," or source material grows large enough to
approach a function timeout — the failure mode is a blocked instructor
staring at a spinner with no way to know if it's still working.

**Proposed improvement**: introduce a minimal job table (`status`,
`payload`, `result`, timestamps) + a Vercel Cron or queue-triggered
worker for anything that calls the model outside a chat turn. Doesn't
need to be a full job-queue product (BullMQ, Inngest, etc.) yet — a
`jobs` table with a polling endpoint is enough to remove the "click and
pray" failure mode.

**Difficulty**: Medium. **Dependencies/risk**: none blocking; purely
additive. **Severity: HIGH VALUE.**

---

### 2. Security

**Current state**: Row Level Security enabled on every table; every
authorization-sensitive write goes through a `SECURITY DEFINER`
function that re-derives `auth.uid()`/`current_course_role()` from the
authenticated session, never from client input. This is genuinely
strong practice, and it's tested — over 100 live integration tests
assert the boundary directly against a real database, not mocks.

**Limitation, found and fixed this session, worth stating plainly for
the record**: 32 of those `SECURITY DEFINER` functions had a NULL-check
authorization bug (`current_course_role() != 'instructor'` silently
passes for a caller with zero relationship to the course, because
`NULL != 'instructor'` is `NULL`, which PL/pgSQL's `IF` treats as
false). It had been fixed once already, in one function, back in
`0011_fix_null_instructor_check.sql` — and then reintroduced in every
subsequent migration that added a new instructor-only function,
because nothing enforced the safer `is distinct from` idiom except a
comment. It went undetected because the one dev test account was
*always* a real course member, so the "caller isn't a member at all"
path was never exercised until a real data cleanup removed that
permanent membership.

**Why it matters**: this is the textbook failure mode of a security
convention that lives only in a comment/precedent instead of being
enforced. It's fixed now (`0046_fix_instructor_check_regression.sql`),
but the *pattern* that let it recur — no lint rule, no CI check, no
test that specifically exercises "an authenticated user with zero
relationship to this course" against every instructor-only function —
is still absent.

**Proposed improvement**: a small custom lint rule (or even a CI grep
step) that fails the build on `current_course_role(` followed by `!=`
in the same statement. Pair it with one parameterized integration test
that iterates every instructor-only RPC with a genuinely-unrelated
account, instead of relying on incidental fixture state to catch it.

**Difficulty**: Low (the grep check) to Medium (the parameterized
test). **Dependencies/risk**: none. **Severity: HIGH VALUE** — cheap
insurance against the exact bug class that already bit this project
twice.

---

### 3. Reliability

**Current state**: no error tracking service — failures are logged via
`console.error`/`console.log` (`src/lib/tutor/log.ts`), visible only by
tailing `vercel logs`. No retries on transient AI provider failures
beyond what a user does by re-sending a message. No circuit breaker if
Anthropic is degraded — every request tries and fails independently.
`start_attempt` does have a real, tested race-condition fix (`on
conflict do nothing` + re-select) for the "double-submit" case.

**Limitation**: there is no way to know, right now, whether the AI
Tutor is healthy for real users without manually checking logs. If
Anthropic has a bad five minutes, every affected student sees an error
with no operator alerted.

**Why it matters**: this is invisible at one course's scale (an
instructor would just get a Slack message from a student). It's a real
support-cost and trust problem the moment there are institutions who
expect an SLA, even an informal one.

**Proposed improvement**: a lightweight error-tracking integration
(Sentry's free tier is enough at this scale) wired into the existing
`logTutorFailure`/catch blocks — this is additive, not a rewrite, since
the failure categorization already exists in `log.ts`.

**Difficulty**: Low. **Dependencies/risk**: none.
**Severity: HIGH VALUE.**

---

### 4. Data model

**Current state**: the schema is genuinely well-factored for what it
does — Courses → Units → Lectures → Materials → Material Versions →
Slides is a clean content hierarchy; assessment evidence and practice
evidence are deliberately separate tables that are never merged into
one mutable score, which the codebase enforces consistently
(`docs/AI_TUTOR_ARCHITECTURE.md` §4); `contributes_to_grade` is a
first-class column rather than inferred from `kind`. 48 migrations,
all forward-only, tracked in `_lms_migrations`, genuinely readable as a
design history.

**Limitation**: the model has no institutional layer at all.
`courses` has no `institution_id`; there's no `department`, `term` as
a first-class entity (only a free-text `term` string on `courses`),
no `section`, and `course_members.role` is a two-value enum
(`student`/`instructor`) with no `ta`/`grader`/`auditor` distinction.
Multi-course scale currently means "more rows in the same two tables
that already exist," which works, but institutional features (Part
7/8 below) will require real schema additions, not just more usage of
what's there.

**Why it matters**: this is exactly the right amount of schema for a
single validated course. It is *not* enough schema to onboard a second
department, let alone a second institution, without a real migration
project.

**Proposed improvement**: see the Stage 3 roadmap in Part 4 — add
`institutions`, promote `term` to a real entity, add a `section`
concept, and extend `course_role` before taking on a second real
institution, not before.

**Difficulty**: Medium-High (touches RLS policies broadly).
**Dependencies/risk**: every `current_course_role()`-based policy needs
re-verification against the new shape. **Severity: LATER** — correctly
deferred until there's a second real customer to design it against
concretely, per the project's own stated "don't invent it before you
need it" discipline (visible throughout `docs/DECISIONS.md`).

---

### 5. Authorization / multi-tenancy

**Current state**: single-tenant in the literal sense — one Supabase
project serves the whole application, with `course_id` as the only
isolation boundary, enforced via RLS. There is exactly one `is_owner`
flag (a bootstrap allowlist of two emails,
`0004_instructor_authorization.sql`) — there is no "organization admin"
concept above individual courses.

**Limitation**: "multi-tenant" today means "multiple courses in one
database," not "multiple institutions who can't see each other's
existence." An institution admin role doesn't exist; there's no way to
say "these five instructors and these three hundred students belong to
University X" as a queryable, permission-scoped group.

**Why it matters**: this is the single largest gap between "works for
one real course" and "sellable to a second university." Every
institutional feature (billing per institution, admin dashboards,
bulk enrollment, data export scoped to one institution) depends on
this existing first.

**Proposed improvement**: add an `institutions` table and an
`institution_admin` capability, with courses belonging to exactly one
institution. This is the same architectural pattern already used for
course-scoped RLS (`current_course_role()`), extended one level up —
not a new paradigm, a repetition of the one that already works.

**Difficulty**: Medium. **Dependencies/risk**: touches the
`instructor_allowlist`/bootstrap model, needs a careful migration for
existing data. **Severity: CRITICAL for Stage 3 (institution-ready),
not for today** — see the roadmap; don't build this before there's a
second institution to build it for, but recognize it blocks the
"multiple universities" pitch entirely until it exists.

---

### 6. Scalability

**Current state**: everything reads/writes through RLS-scoped Postgres
queries; the heaviest computed endpoints
(`get_course_performance`/`get_course_gradebook`) aggregate across
`attempt_questions`/`responses` per request rather than maintaining a
materialized rollup. Fine at CSE 1203's real scale (dozens of students,
hundreds of questions).

**Limitation**: no load testing exists at any scale beyond one small
real course. The performance-aggregation queries in
`0010_grades_performance.sql` do multiple joins and `count(*) filter`
aggregations per call — this will get slower, not catastrophically but
noticeably, as attempt volume grows into the thousands per course.
There's no caching layer for anything (every dashboard number is
computed fresh on every page load).

**Why it matters**: not a today problem. It becomes one exactly when
"institution-ready" (Stage 3) starts meaning real enrollment numbers —
hundreds of students across dozens of courses, not one section.

**Proposed improvement**: before it's needed, don't build it. When
it's needed: add `next: { revalidate }` or a small materialized-view
refresh job for the performance aggregations rather than rewriting the
underlying model.

**Difficulty**: Low when the time comes. **Severity: LATER.**

---

### 7. Maintainability

**Current state**: this is one of the codebase's real strengths. 48
migrations each carry a comment explaining *why*, not just *what*;
`docs/DECISIONS.md` and `docs/INVARIANTS.md` exist and are actually
current; the `"use server"` files-may-only-export-async-functions
convention is followed consistently; test files use real accounts
against a real database rather than mocking away the exact thing that
tends to break (RLS).

**Limitation**: a handful of pre-existing lint findings remain
(`src/components/practice/practice-session.tsx` calls `setState`
synchronously inside a `useEffect`, which the current `eslint-config-next`
flags as a real anti-pattern, not stylistic noise) — low risk today,
worth fixing before it's copied as a pattern into new code. There is
also no CI pipeline yet (GitHub Actions or equivalent) — `npm run
test`/`lint`/`build` are run by hand, so nothing stops an untested
commit from landing on `main` once more than one person is
contributing.

**Why it matters**: the documentation-as-you-go discipline is rare and
valuable; it will decay the moment there's schedule pressure and more
than one contributor unless something (CI) enforces the checks that
are currently just habit.

**Proposed improvement**: a GitHub Actions workflow running
`typecheck`/`lint`/`test`/`build` on every PR. This repo is now public,
which makes this specifically cheap (GitHub Actions is free for public
repos).

**Difficulty**: Low. **Dependencies/risk**: the integration test suite
needs a live Supabase project's credentials as CI secrets, and running
it in CI has the same "hits a real hosted database" tradeoff the local
suite already has — worth deciding whether CI runs the full live
integration suite or just unit-level checks. **Severity: HIGH VALUE.**

---

### 8. Instructor experience

**Current state**: recently restructured from a 12-tab horizontal
strip into six grouped sections (Overview, Course Content, Assessments,
Students, Insights, Course Settings) with local sub-navigation.
Content management has dependency-aware delete blocking with
human-readable reasons. Destructive actions (Roster removal) live
behind a contextual menu rather than a permanently-visible button.

**Limitation**: the instructor Overview page is still a simple course
list, not the "calm, useful landing page" (next class, recent
announcement, AI status, assessment status at a glance) that would
actually reduce the number of clicks to "is everything OK with my
course right now." Gradebook shows full per-assessment detail rather
than a compact summary with drill-down. There is no bulk workflow for
anything (no bulk-enroll, no bulk-publish, no bulk-question-import
beyond a single structured JSON paste).

**Why it matters**: none of this blocks real use (it's already in real
use); it's the gap between "functional" and "an instructor would
choose this over Canvas/Moodle for reasons beyond the AI."

**Proposed improvement**: see Stage 1/2 of the roadmap — Overview
redesign and Gradebook compaction are both scoped, well-understood UI
work with no architectural risk.

**Difficulty**: Low-Medium. **Severity: MEDIUM VALUE.**

---

### 9. Student experience

**Current state**: real PPTX/PDF/DOCX rendering (not a placeholder),
slide-grounded "Ask about this slide," per-lecture Practice with
immediate AI-explained feedback, a Learning Diagnostic, and a new
evidence-based "Learn with AI" entry point that explicitly refuses to
fabricate a recommendation when there's no evidence yet.

**Limitation**: navigation is still a flat 12-item strip (deliberately
not restructured this pass, since the reported crowding was
instructor-side) — it will eventually have the same "too many peer
tabs" problem the instructor side had. There's no student-facing
notification system (a new grade, a new announcement, an upcoming
deadline currently require the student to check).

**Why it matters**: the core academic workflows are real and tested;
what's missing is the retention/habit layer (notifications) that turns
"a tool I use because it's assigned" into "a tool I check because it
tells me something."

**Proposed improvement**: notifications are a genuinely new subsystem
(delivery, preferences, read state) — don't build it speculatively;
build it when there's a second real course to validate whether
students actually want it over just checking the site.

**Difficulty**: Medium. **Severity: MEDIUM VALUE (nav polish) /
LATER (notifications).**

---

### 10. Mobile experience

**Current state**: verified via real Playwright browser tests at
iPhone-class viewport width — no horizontal scroll on primary
navigation, the shell correctly switches to a slide-over drawer below
`sm`. Typography was recently raised (14px body → 16px) specifically
for phone readability.

**Limitation**: there is no installable PWA (no manifest, no service
worker, no offline capability at all). Given the explicit Bangladesh
context — mobile-first usage on inexpensive Android devices, often on
inconsistent connectivity (see Part 3 below) — "works in a mobile
browser" is necessary but not sufficient; a flaky connection currently
means a fully broken page, not a degraded-but-usable one.

**Why it matters**: this is the single most consequential gap given
the stated go-to-market (Part 3). A student on a low-cost Android
phone with an intermittent connection is the primary persona, not an
edge case.

**Proposed improvement**: a PWA manifest + basic service-worker caching
for static assets and the last-viewed material is a bounded, well-
understood project — not full offline-first, just "the app shell loads
and previously-viewed material is available even when the network
briefly drops."

**Difficulty**: Medium. **Severity: HIGH VALUE** given the stated
market — this is where the Bangladesh-specific product thinking should
show up first.

---

### 11. Accessibility

**Current state**: some real attention exists — visible focus rings
(`:focus-visible` in `globals.css`), semantic `role="tab"`/`aria-selected`
on the login role switcher, `aria-current="page"` on nav links, a
`prefers-reduced-motion` media query. Muted-gray text contrast was
specifically fixed this session after failing WCAG AA (4.0:1 → 5.5:1).

**Limitation**: no systematic accessibility audit has been done (no
axe-core/Lighthouse-CI pass, no screen-reader walkthrough). Several
interactive elements (the `<details>`-based contextual menus, the
custom radio-styled MCQ option buttons) haven't been verified with a
real screen reader, only with sighted browser automation.

**Why it matters**: accessibility is both a legal requirement in most
institutional procurement (Part 7) and directly affects real students.
It's currently "reasonably careful," not "verified."

**Proposed improvement**: run axe-core against the Playwright suite
(a few lines added to existing specs, not a new test framework) as a
first pass, then a manual screen-reader pass on the assessment-taking
flow specifically (the highest-stakes interaction).

**Difficulty**: Low (automated pass) to Medium (manual audit + fixes).
**Severity: MEDIUM VALUE** now, **CRITICAL before any institutional
procurement conversation** — most universities require an accessibility
statement or VPAT.

---

### 12. Assessment integrity

**Current state**: genuinely solid. Hidden vs. Practice question
visibility is enforced at the RLS/RPC layer, not the UI (`questions`/
`question_options` have zero student-readable RLS policy at all — the
only path is through `get_attempt_view`, which withholds `is_correct`
until submission). The new Learning Diagnostic's random selection is
provably scoped to Practice-visible questions via a dedicated
`visibility_filter` mechanism, verified with a test that stacks 4
hidden questions against 1 practice question and confirms the hidden
ones never win.

**Limitation**: there's no proctoring, no tab-switch detection, no
time-boxing beyond "one attempt, no re-shuffle" for graded assessments,
and no plagiarism/similarity detection for written responses. A
determined student can still have a second device open.

**Why it matters**: for a low-stakes practice/mock-test context this
is a non-issue. For a real graded Class Test used for actual grades,
"no proctoring at all" is a real gap institutions will ask about
directly.

**Proposed improvement**: don't build proctoring speculatively — it's
expensive, invasive, and a genuinely different product surface (camera
access, browser lockdown). If/when a Class Test's stakes justify it,
start with the cheap options (time limits, single-tab enforcement via
`visibilitychange`) before camera-based proctoring.

**Difficulty**: Low (time limits) to High (proctoring).
**Severity: MEDIUM VALUE** (time-boxing) / **LATER** (proctoring) —
don't let this block anything until a real Class Test's stakes demand
it.

---

### 13. Gradebook architecture

**Current state**: correctly excludes `kind = 'project'` from the
assessment gradebook (`get_course_gradebook()`), merging in
`get_course_project_grades()` separately — this fixed a real,
documented bug (the "26 not started" incident in `CLAUDE.md`) caused
by exactly the cross-join mistake this architecture now explicitly
avoids. `pending_grading_count` correctly distinguishes "ungraded" from
"graded zero" for written responses.

**Limitation**: no weighted grade categories (everything is implicitly
equal-weighted unless an instructor manually interprets `points_possible`
themselves), no letter-grade mapping, no "drop lowest N" or similar
common academic policies, no export to a spreadsheet/CSV.

**Why it matters**: the current model is correct for what it computes;
it computes less than a real course's grading policy usually requires.
CSE 1203 today likely tolerates this because the instructor is also
the developer and can reason about raw numbers directly — a
third-party instructor would not accept this.

**Proposed improvement**: a `grade_categories` table (name, weight) and
a CSV export are both bounded, well-scoped additions that don't require
touching the existing correct aggregation logic, only extending it.

**Difficulty**: Medium. **Severity: HIGH VALUE** — this is squarely in
"table stakes any real instructor will ask for in week one" territory
(see Part 2).

---

### 14. Course/material management

**Current state**: a real strength. Soft-delete via `archived_at`
everywhere, dependency-aware hard-delete blocking with human-readable
reasons, real DOCX/PDF/PPTX rendering (not converted-to-generic-text),
version history on materials. This is more careful than many
production LMS content models.

**Limitation**: no bulk upload (one material at a time), no content
versioning beyond material re-upload (no "restore a previous version"
UI, even though `material_versions` as a table already supports it
structurally), no folder/tagging system beyond the fixed Unit→Lecture
hierarchy.

**Why it matters**: fine for one instructor building one course
incrementally; a real content-migration workload (an instructor
porting years of existing material) would find the one-at-a-time
upload flow slow.

**Proposed improvement**: a "restore this version" button is a small,
low-risk UI addition on top of data that already exists. Bulk upload
is a genuinely bigger UI project — defer until real demand shows up.

**Difficulty**: Low (version restore) / Medium (bulk upload).
**Severity: MEDIUM VALUE.**

---

### 15. AI architecture

**Current state**: the most differentiated part of the product, and
it's real, not aspirational. A learning-objective model connects
material chunks (`material_chunks`, one row per slide, full
provenance), assessment questions, and practice into one spine.
Retrieval is scoped to *published* content only, mirroring the exact
RLS visibility rule already enforced on `slides` — retrieval cannot
surface draft content a student couldn't otherwise see. The
orchestrator (`src/lib/tutor/orchestrator.ts`) assembles four
explicitly labeled prompt sections (system policy, retrieved material,
evidence summary, bounded history) and treats retrieved content as
*data, not instructions* — a real prompt-injection boundary, not just
a comment about one.

**Limitation**: single-provider (Anthropic only) with no abstraction
layer for a second provider — `provider.ts` calls
`https://api.anthropic.com/v1/messages` directly. If Anthropic has an
outage or changes pricing unfavorably, there's no fallback.

**Why it matters**: acceptable risk for a single-course validation;
becomes a real business continuity question the moment revenue depends
on availability.

**Proposed improvement**: extract a small `TutorProvider` interface
(the file is already structured close to this — model selection is
already centralized) so a second provider is an implementation, not a
rewrite. Don't actually add a second provider until there's a concrete
reason (cost, outage, or a customer requirement) to justify the
maintenance cost of testing two providers' behavior.

**Difficulty**: Low (interface extraction) — do this even before it's
needed, since it costs little now and a lot more later.
**Severity: MEDIUM VALUE now, HIGH VALUE the day it's needed.**

---

### 16. AI cost efficiency

**Current state**: genuinely well thought out. Model tiering (cheap
Haiku for interactive turns, Sonnet only for the one-time-per-objective
Course Intelligence compile) is real cost engineering, not
accidental. The AI Usage Governor enforces per-student daily (8),
per-course daily (75), and global daily (100) generation limits plus a
9-second cooldown and pause switches at both course and global level —
all enforced server-side in a `SECURITY DEFINER` function with an
advisory lock against races, not a client-trusted check. The Learning
Diagnostic and Tutor-preference collection were both built to cost
**zero** AI calls, verified by a test asserting `ai_generation_events`
doesn't grow after a full diagnostic submission.

**Limitation**: the limits themselves (8/75/100/9s) are hardcoded
defaults in one config row (`ai_usage_config`), not yet exposed as
something an institution could tune per their own budget without a
direct database edit — there's a `set_course_ai_paused` toggle but no
UI for adjusting the numeric limits themselves.

**Why it matters**: the *mechanism* is exactly right; the *interface*
for someone other than the developer to operate it isn't built yet.

**Proposed improvement**: expose the existing `ai_usage_config` row
through a simple owner-only settings form — the validation and storage
already exist, this is purely surfacing what's there.

**Difficulty**: Low. **Severity: MEDIUM VALUE.**

---

### 17. Retrieval/grounding quality

**Current state**: honestly documented as full-text search
(`tsvector`/`ts_rank`), explicitly not embeddings, with the reasoning
recorded (`docs/AI_TUTOR_ARCHITECTURE.md` §3) — Anthropic doesn't serve
an embeddings endpoint, and adding a second provider purely for vectors
was judged not worth the complexity at this scale. The `embedding
vector` column is reserved in the schema but unpopulated. Retrieval is
scoped to published content, with full provenance per chunk.

**Limitation**: full-text search matches on lexical overlap, not
semantic similarity — a student asking about "the brain of the
computer" won't retrieve a slide that only says "CPU" unless the
learning-objective/topic mapping happens to bridge the gap. This is a
real quality ceiling, not a implementation bug.

**Why it matters**: this is the single most consequential "in
development, not implemented" item for the AI's actual usefulness —
retrieval quality directly determines whether the Tutor's answers are
genuinely grounded or subtly generic.

**Proposed improvement**: adding an embeddings provider (Voyage AI or
OpenAI's embeddings endpoint, used *only* for embeddings, keeping
Anthropic for generation) behind the existing provider-agnostic
retrieval interface is the correct next step — the codebase is
deliberately shaped to make this a swap, not a rewrite.

**Difficulty**: Medium. **Dependencies/risk**: a second provider
relationship/API key, plus a backfill job for existing chunks.
**Severity: HIGH VALUE** — this is the highest-leverage AI-quality
investment available, and the architecture is already prepared for it.

---

### 18. Observability

**Current state**: `console.error`/`console.log` via a small typed
helper (`src/lib/tutor/log.ts`), visible through `vercel logs`. Latency
instrumentation exists for Tutor turns (stage-by-stage timing), logged
but not aggregated anywhere.

**Limitation**: no dashboards, no alerting, no persistent error store,
no way to answer "how many Tutor failures happened this week" without
manually grepping logs. This is the same underlying gap as Reliability
(#3) viewed from the "can you see it happening" angle rather than the
"does it recover" angle.

**Why it matters**: identical reasoning to #3 — invisible at one
course's scale, a real operational blind spot beyond it.

**Proposed improvement**: same fix as #3 (Sentry or equivalent) plus,
separately, a simple scheduled job that aggregates the existing latency
logs into a daily summary — cheap, and the data is already being
produced, just not collected.

**Difficulty**: Low. **Severity: HIGH VALUE** (bundled with #3 — same
underlying investment).

---

### 19. Testing

**Current state**: a genuine strength, unusual for a project this
young. 111 integration tests run against a real, live Supabase
project — no mocked database — asserting authorization boundaries
directly (a student cannot read another student's attempt, cannot
escalate via direct RPC calls, cross-course isolation, etc.). A real
Playwright browser suite (11 tests × desktop/mobile) exercises actual
login, navigation, the full Learning Diagnostic flow, and the real
PPTX presentation rendering — not synthetic smoke tests.

**Limitation**: no CI enforcement (see #7) — tests are run by hand.
Coverage is authorization- and correctness-focused, not
performance/load-focused (no test asserts response time under
concurrent load). Test data hygiene relies on disciplined manual
cleanup (`TEST%`-prefixed fixtures, documented conventions in
`CLAUDE.md`) rather than an isolated test database/schema per run.

**Why it matters**: the *quality* of what's tested is high; the
*process* around running it (manual, no gate) is the weak point.

**Proposed improvement**: CI (#7) is the single highest-leverage fix
here — it turns an excellent test suite that depends on someone
remembering to run it into one that actually gates changes.

**Difficulty**: Low (bundled with #7). **Severity: HIGH VALUE.**

---

### 20. Deployment/operations

**Current state**: Vercel, deployed directly from this repository, one
shared Supabase project for both development and production (an
explicit, documented tradeoff — see `docs/DECISIONS.md` — chosen
because this machine has no Docker/browser-OAuth for the Supabase CLI's
usual local-development flow).

**Limitation**: no staging environment. A schema migration or a risky
feature is tested against the *same* database real students use,
mitigated only by careful migration discipline and live integration
tests. There is also no automated database backup/restore procedure
documented beyond whatever Supabase's platform provides by default.

**Why it matters**: this is the single riskiest operational fact about
the current setup. It has worked because of unusually careful practice
(transactional, tracked migrations; live tests before any schema
change), not because the risk isn't real. One bad migration against
production data is one bad migration away from a real incident.

**Proposed improvement**: a second, cheap Supabase project as a
staging environment — even without solving the Docker/OAuth
constraint that motivated the current single-project setup, migrations
could be tested against a staging project's own copy of the schema
(not real data) before touching production.

**Difficulty**: Low-Medium (mostly process, not code).
**Severity: CRITICAL** — this is the finding most likely to cause real
harm if left unaddressed, precisely because nothing has gone wrong yet
and that can create false confidence.

---

### 21. Institutional administration

**Current state**: does not exist as a concept. There is no
institution-level admin view, no way to see "all courses at this
university," no per-institution branding/configuration, no billing
concept at all.

**Limitation**: this is a restatement of #5 (Authorization/multi-tenancy)
from the product/administration angle rather than the data-model angle.

**Why it matters**: see #5.

**Proposed improvement**: see #5 and the Stage 3 roadmap.

**Difficulty**: Medium-High. **Severity: CRITICAL for institutional
sales, correctly not-yet-built for a single-course validation.**

---

### 22. Privacy/data governance

**Current state**: real, working discipline exists — this session's
own audit found and fixed exposed student PII before a public release
(see the accompanying commit), which is itself evidence the team takes
this seriously in practice. `profiles.full_name` is deliberately
separate from identity/authorization (never used for access control).
Classmate directory shows names only, never emails, and only if an
instructor opts in. No student data was ever committed to source
control.

**Limitation**: there is no written data retention policy (how long is
a withdrawn student's data kept?), no documented data-export capability
for a student who wants their own records, and no formal privacy
policy/terms of service exists anywhere in the product — necessary
before any institution can approve using it with real students'
data as a matter of policy, not just good faith.

**Why it matters**: "we handle data carefully" (true, demonstrated) and
"we have a privacy policy an institution's legal/compliance office can
review" (not true yet) are different bars, and institutional
procurement requires the second one.

**Proposed improvement**: a real privacy policy and a documented data
retention/deletion procedure — this is a writing/policy project more
than an engineering one, but it blocks institutional conversations
until it exists.

**Difficulty**: Low (writing) but requires actual policy decisions, not
just documentation. **Severity: CRITICAL before any institutional
pitch; not urgent for continued single-course use.**

---

### 23. Internationalization

**Current state**: English-only, hardcoded throughout (no i18n
library, no string extraction, no locale routing). Timezone handling
exists at the course-schedule level (`courses.timezone`, e.g.
`Asia/Dhaka`) — a real, working piece of internationalization
infrastructure, just not extended to UI text.

**Limitation**: given the stated Bangladesh-first strategy, the
absence of Bangla anywhere in the UI is a real gap, not a
nice-to-have — English fluency varies significantly among the actual
student population this is meant to serve.

**Why it matters**: this is a genuine product-market fit question, not
just a translation task — see Part 3.

**Proposed improvement**: don't retrofit i18n library infrastructure
speculatively. If Bangla support becomes a real near-term priority,
introduce a proper i18n library (`next-intl` or similar) at that point
rather than hand-rolling string swaps — but the *decision* of whether
this is next-quarter or next-year work belongs in Part 3/4, not here.

**Difficulty**: Medium (once decided to do it). **Severity: HIGH VALUE**
strategically, but sequencing depends on the Bangladesh-strategy
decision in Part 3.

---

### 24. Product competitiveness

**Current state**: see Part 2 for the full competitive analysis. In
short: strong on AI-native grounding (a real differentiator, not
marketing), weak on the institutional-administration table stakes
(#5/#21) that established platforms have had for years.

**Why it matters / proposed improvement**: see Part 2.

**Severity: see Part 2's individual gaps.**

---

## Part 2 — Competitive Analysis: Table Stakes vs. Genuine Differentiation

### What's genuinely table stakes for institutional LMS software that this platform doesn't yet support

These aren't "nice to haves" — they're the reason a department head
would say no today, independent of how good the AI is:

- **Multiple instructors/TAs per course** with distinct capabilities
  (grade but not delete content; see content but not grade). Today:
  `course_role` is binary (student/instructor); any instructor on a
  course can do everything an instructor can do.
- **Bulk enrollment / SIS import.** Today: enrollment is one student
  at a time (self-enrollment or an approval queue) — no CSV import, no
  SIS (student information system) integration of any kind.
- **SSO (SAML/OIDC).** Today: email/password only via Supabase Auth.
  Most universities require institutional SSO for any system handling
  student data.
- **Weighted grade categories, rubrics.** Covered in #13 above.
- **Deadlines with per-student accommodation** (extended time,
  late-submission grace) — doesn't exist; every student has identical
  timing.
- **Notifications/email.** Doesn't exist (#9 above) — a real gap
  relative to every mainstream LMS.
- **Audit trail for grade changes.** `grade_written_response()`
  overwrites; there's no history of "who changed this grade and when"
  beyond whatever's in `updated_at`.
- **Data export / backup for the institution's own records.** Doesn't
  exist — an institution cannot currently extract "everything about
  this course" in a portable format.
- **Accessibility conformance statement (VPAT).** See #11 — not
  audited yet.

None of these are hard, individually. Together, they're the actual
distance between "a real, working platform" and "something a
university's procurement process can approve."

### Where an AI-native architecture can be genuinely better — evaluated critically, not just listed

Being deliberately skeptical about which of these are real
differentiators versus AI-gimmick territory:

- **Course-aware, slide-aware tutoring grounded in retrieved material,
  never generic subject knowledge.** *Real and already built.* This is
  the platform's actual, demonstrable differentiator today — most
  LMS+AI integrations bolt on a general-purpose chatbot with course
  context stuffed into a system prompt at best. This system retrieves
  from the instructor's actual published slides and withholds anything
  from unpublished content, which is a genuinely different (and
  harder) architecture than "chat with an LLM about your course."
- **Explicit separation of learning evidence from stated preferences,
  with an explicit refusal to infer personality/learning-style
  labels.** *Real, built this session, and worth keeping as a stated
  product principle.* Most "personalized learning" products conflate
  "the student got 3/10 on Operating Systems" (evidence) with "the
  student is a visual learner" (an unfalsifiable, largely
  discredited category). This platform's data model won't let those
  get confused even by accident — that's a genuine, defensible
  position, not a gimmick.
- **Instructor-controlled, cost-bounded AI (the Usage Governor).**
  *Real and built.* Most competitors either don't expose AI cost
  controls to instructors at all, or don't have the problem because
  their "AI" is a thin wrapper with no real usage volume. A real
  per-student/course/global governor with a pause switch is
  operationally serious, not a marketing checkbox.
- **Course Intelligence as a pre-compiled teaching asset** (canonical
  explanations, common misconceptions, analogies, generated once per
  objective and reused cheaply forever). *Real, and a genuinely good
  cost/quality tradeoff* — most systems either re-derive this on every
  request (expensive, slow) or don't have it at all (generic answers).
- **Automatic learning-objective extraction from the instructor's own
  material.** *Not built — currently manual* (objectives are
  hand-authored, mapped to topics via an explicit table). This is a
  legitimate future differentiator (reduce instructor setup burden)
  but should stay manual until there's evidence auto-extraction is
  reliable enough that instructors trust it without review — a wrong
  auto-extracted objective is worse than a manually-authored one.
- **AI-assisted question/assessment generation with instructor
  approval.** *Not built.* Legitimate direction (Part "in
  development" above), genuinely useful if the approval step is real
  and instructors actually use it, a gimmick if it becomes "AI writes
  your test, click accept" without real review friction. Worth
  building carefully, not quickly.
- **A "course knowledge graph" / student learning model beyond what
  exists today.** *Skeptical.* The current evidence model (per-
  objective correct/attempted, assessment vs. practice) is honest and
  legible. A more elaborate "learning model" risks becoming an opaque
  black box that's harder to explain to an instructor than it is
  useful — resist this unless a specific, concrete use case demands
  it, not because "knowledge graph" sounds sophisticated.
- **AI-assisted grading of open-ended responses.** *Not built, and
  worth real caution.* Written responses are explicitly, deliberately
  never auto-graded today (`docs/DECISIONS.md`,
  `CLAUDE.md`) — an instructor grades every one. This is a correct,
  conservative choice for a system handling real grades. If this ever
  changes, it should be "AI suggests a grade, instructor confirms,"
  never fully automatic — the current manual-grading discipline is a
  feature, not a gap, and should be defended, not "fixed."

---

## Part 3 — Bangladesh + International Strategy

### Starting in Bangladesh — what the current architecture already fits, and what it doesn't yet

**Fits well already**: the RLS-as-security-boundary architecture is
genuinely cheap to run (one small Supabase project, one Vercel
deployment) — appropriate for an early-stage institution unwilling to
commit to expensive infrastructure. Timezone-aware scheduling
(`Asia/Dhaka` is already a real, working value in the schema, not a
placeholder) shows the groundwork is already locale-aware where it
matters functionally.

**Doesn't fit yet, and matters concretely for this market**:

- **Mobile-first + inconsistent connectivity** (#10 above) is the
  single most consequential gap. A Bangladeshi student population is
  overwhelmingly on Android, often on limited data plans, with
  connectivity that drops mid-session more often than a North American
  campus network would. "Works in a mobile browser" (true today) and
  "tolerates a dropped connection gracefully" (not true today) are
  different bars, and this market needs the second one specifically.
- **Bangla language support** (#23 above) is a real product decision,
  not a checkbox — whether it's needed depends on the specific
  institution/student population (English-medium universities like
  Premier University may need less of it than a Bangla-medium public
  university would). Don't build it speculatively; ask the next 2-3
  real instructor conversations directly whether it's a blocker.
- **AI inference cost at scale** matters more here than in a
  well-funded market — the existing Usage Governor (#16) is exactly
  the right instinct, and should be treated as a permanent architecture
  principle, not a temporary safeguard, as this scales to
  price-sensitive institutions.
- **Faculty technical comfort and onboarding difficulty**: the current
  system requires an instructor to trust an AI-native workflow that's
  unfamiliar even to faculty comfortable with a traditional LMS. The
  single real deployment so far (this session's user, who is also the
  developer) hasn't tested this with an instructor unfamiliar with the
  system's internals. This is a genuine unknown, not a solved problem
  — the honest answer is "we don't know yet how hard onboarding a
  cold-start instructor is," and that should be tested directly before
  assuming it's easy.
- **Support requirements**: there is currently no support channel,
  ticketing, or SLA of any kind — fine for one instructor who is also
  the developer, not fine for a second real institution.

### What's required before pitching internationally

- Everything in the "table stakes" list in Part 2 — SSO, bulk
  enrollment, multi-instructor roles are effectively required for any
  institution outside a founder's direct relationship with an
  instructor, regardless of country.
- A second validated deployment *of any kind* — one real course at one
  real university, with no other evidence, is not yet a case study; a
  second, independently-run course is the first real evidence the
  product works beyond its own creator's direct involvement.
- Data residency/compliance clarity — different jurisdictions
  (GDPR-adjacent regions especially) will ask where student data is
  stored and under what legal terms; Supabase's hosting region and data
  processing terms need to be an explicit, documented answer, not
  "wherever the default project region was."
- The privacy policy and accessibility conformance work from #22/#11
  above — these become non-negotiable, not optional, for most
  Western/international institutional procurement.

**Do not assume Bangladesh-first limits the ceiling.** A genuinely
better AI-grounding architecture, validated cheaply in a
lower-cost-of-experimentation market first, is a legitimate path to an
internationally credible product — several successful education
technology companies followed exactly this sequence. **Do not assume
the current prototype is close to that ceiling either** — the gap
described throughout Part 1 is real and needs closing regardless of
which market comes next.

---

## Part 4 — Product Roadmap

### Stage 0 — Current: single-course real-world validation *(where this is today)*

**Objective**: prove the AI-native approach works in a real classroom,
not a demo. **Features**: everything in "Implemented Now" (README).
**Success criteria**: CSE 1203 completes a term using the platform for
real coursework, assessments, and AI tutoring, with the instructor
choosing to continue using it — the strongest available evidence right
now is "a real instructor kept using it," not a feature count.

### Stage 1 — Robust teaching platform

**Objective**: make the single-course experience trustworthy enough to
hand to a second instructor without the developer in the room.
**Features**: CI enforcement (#7/#19), error tracking/observability
(#3/#18), a staging environment (#20), the security-lint check (#2),
grade categories + CSV export (#13), PWA/offline resilience (#10).
**Architectural changes**: none structural — this stage is entirely
about closing operational gaps in the existing architecture, not
changing it. **What NOT to build yet**: institutions/multi-tenancy,
SSO, notifications — none of these matter until there's a second real
course. **Success criteria**: a second instructor (even a colleague of
the current one) runs a course on the platform without the developer
directly intervening when something breaks.

### Stage 2 — Multi-course / multi-instructor product

**Objective**: support several courses and instructors who don't
already know each other, still within one institution.
**Features**: multi-instructor/TA roles (#24), bulk enrollment,
notifications, Overview/Gradebook UX polish (#8/#9). **Architectural
changes**: extend `course_role` beyond binary; the institution-layer
schema work from #5 can start here even before a second institution
exists, since it's needed for department-level organization within
one institution too. **What NOT to build yet**: SSO, billing, a
polished admin dashboard — premature before there's more than one
paying/committed institution. **Success criteria**: 3-5 courses running
concurrently with instructors who didn't need the developer's direct
help to set up their course.

### Stage 3 — Institution-ready LMS

**Objective**: sellable to a second real institution. **Features**:
the full "table stakes" list from Part 2 — SSO, bulk/SIS-style import,
audit trails, weighted grading, accessibility conformance, a real
privacy policy. **Architectural changes**: the `institutions` schema
layer (#5/#21) is now required, not optional. **What NOT to build
yet**: deep AI-native differentiation beyond what already exists (Part
2's "real" items) — an institution evaluating this stage cares more
about "does this meet our compliance/procurement bar" than "how
sophisticated is the AI." **Success criteria**: a second institution,
independent of the founding relationship, signs up and onboards
without a bespoke, hand-held setup process.

### Stage 4 — AI-native differentiation

**Objective**: make the AI architecture the reason institutions choose
this over an established platform with an AI feature bolted on, not
just a reason it's tolerable. **Features**: embeddings-based retrieval
(#17 — this is the single highest-leverage AI-quality investment
identified in this review), AI-assisted (instructor-approved)
assessment authoring, a provider-abstraction layer (#15) validated
with a real second provider. **What NOT to build**: anything from the
"skeptical" list in Part 2 (course knowledge graphs, auto-inferred
learning-style personalization) without concrete evidence a specific
use case needs it. **Success criteria**: an institution can articulate,
specifically, why the AI here is better than a competitor's — not just
that it exists.

### Stage 5 — Internationally competitive platform

**Objective**: credible outside the initial market. **Features**:
localization infrastructure (proper i18n, not hand-rolled), data
residency options, whatever compliance certifications the target
markets require. **What NOT to build**: don't chase international
credibility before Stage 3's institutional bar is met domestically —
international procurement is at least as demanding as domestic, not
less. **Success criteria**: a serious evaluation conversation with an
institution outside the original market, on the platform's technical
and product merits rather than an introduction/relationship alone.

### The smallest sequence that increases credibility the most, right now

If forced to pick five things before anything else: **CI (#7)**,
**error tracking (#3/#18)**, **a staging environment (#20)**, **grade
categories + CSV export (#13)**, and **the security-lint check (#2)**.
All five are low-to-medium effort, all five are things a technically
sophisticated evaluator (an engineer at a university's IT department,
or a technical co-founder candidate) would specifically check for and
notice the absence of, and none of them require a product decision
that isn't already obviously correct.
