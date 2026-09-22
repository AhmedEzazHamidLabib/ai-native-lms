# Performance Optimization Pass — 2026-09-22

Empirical, phased follow-up to `docs/PERFORMANCE_DIAGNOSTIC_2026-09-21.md`.
This document is written incrementally, one phase at a time, and only
after each phase's measurements are in hand — per instruction, measured
results take precedence over the prior diagnostic's code-reading
estimates wherever they disagree.

**Status: COMPLETE. Production is cut over to `syd1` (Sydney), verified
healthy, and load-tested through 1→5→10→25→50 concurrent authenticated
navigations.** Phases 1 through 6 (measure, prefetch control, auth
dedup, query collapse, harness hardening, geography experiment,
production cutover, and staged load test) are all done, measured, and
committed. Supabase was never touched at any point — no migration, no
region change, no credential rotation, no schema/RLS change. No
student/course data was mutated (the one recurring write — a temporary
`course_members` row for the `dev-student` fixture — was added and
removed within every script run across every phase, independently
verified by direct database query after each one, including every run
in the final production/load-test phase). See "Phase 6" near the end
of this document for the production cutover and load-test results.

---

## Phase 1 — Baseline measurement

### Method

Built a small, isolated, env-gated instrumentation hook
(`src/instrumentation.ts`, Next.js's standard `instrumentation.ts`
convention) that wraps `globalThis.fetch` to log every request this
server makes to the Supabase project — method, path, duration, status —
as one JSON line per call. **Completely inert unless `PERF_DIAG=1` is
set**; does not touch, wrap, or modify any of the actual call sites in
`src/lib/supabase/*` or `src/lib/domain/*`, and has no effect on default
`next dev`/production behavior. Left in place (harmless by default) so
later phases can reuse it without rebuilding it — see "What's left in
the tree" below if you'd rather it were removed.

Ran a real, local `next build && next start -p 3100` (production mode,
not dev mode — no dev-only overhead) with `PERF_DIAG=1`, on this
machine, against the **same live Supabase project** production uses
(there is no staging database — see `docs/SAFE_DEVELOPMENT.md`). This
deliberately measures the application/database layer in isolation from
the Vercel-edge/geography layer, which `PERFORMANCE_DIAGNOSTIC_2026-09-21.md`
§5 already measured separately (revisited in Phase 4).

A Playwright script (`scripts/perf/measure-baseline.mjs`) drove a real
authenticated browser session as `dev-student@example.test`:
- Reused the exact fixture-membership pattern already used by
  `e2e/global-setup.ts`/`src/lib/test-support/course-membership.ts` —
  ensured `dev-student` was a CSE 1203 member for the run, tracked
  whether the row already existed, and removed it afterward only if
  this run added it. **Verified clean afterward** (see transcript —
  `dev-student CSE1203 membership present after cleanup: false`).
- Logged in through the real `/login` form (same as
  `e2e/helpers.ts`'s `loginAs`), then navigated to 8 representative
  authenticated pages, sequentially, each preceded by a 200ms gap so
  server-log windows don't blend together.
- Never opened an assessment attempt, never called the AI Tutor, never
  submitted anything.

Pages measured: dashboard (`/student`), available courses
(`/student/courses`), course home, materials, course/lecture list,
assessments list, grades, announcements (all under
`/student/courses/{CSE1203}`).

### Result 1 — the numbers are real, and they're worse than the prior
### diagnostic's code-reading estimate predicted, for a specific,
### identified reason

| Page | Wall (ms) | TTFB (ms) | Total Supabase calls | `auth.getUser()` calls | Total Supabase time (ms, incl. overlap) |
|---|---:|---:|---:|---:|---:|
| dashboard | 4350 | 2182 | 17 | 15 | 9930 |
| available-courses | 3395 | 1884 | 14 | 9 | 6436 |
| **course-home** | 6779 | 2808 | 37 | 29 | 17120 |
| materials | 7140 | 2873 | 38 | 31 | 17033 |
| course-content | 6842 | 2801 | 38 | 31 | 16521 |
| assessments-list | 5631 | 1464 | 37 | 33 | 16007 |
| grades | 4960 | 1335 | 31 | 27 | 13210 |
| announcements | 4895 | 1297 | 30 | 27 | 12935 |

Raw output: `scripts/perf/baseline-results.json`.

The prior diagnostic estimated ~8–9 sequential Supabase calls per page
from reading the source. The measured number is **3–4x higher** for
every course-scoped page (30–38 calls, 27–33 of them `auth.getUser()`).
Per the standing instruction to trust measurements over the existing
hypothesis when they disagree, this was investigated rather than
written off.

### Root cause, verified with a controlled A/B, not inferred

Looked at the raw call timeline: `auth.getUser()` calls arrive in
clusters of ~4, roughly 400–450ms apart, continuing for **several
seconds after the page has already rendered and sent its response**
(e.g. `course-content`: TTFB 2801ms, but `getUser()` calls continue
until the 6842ms mark). That's not consistent with anything the page's
own server render does — it's consistent with **background activity
triggered after hydration**.

`src/app/student/courses/[courseId]/layout.tsx` renders a course sidebar
with **13 `next/link` nav items** (Home, Announcements, Calendar,
Course, Materials, Practice, Assessments, Project, Grades, Performance,
AI Tutor, Learn with AI, Classmates), present on every course page.
Next.js App Router's `<Link>` prefetches its target route automatically
once visible, by default — and prefetching a route re-runs that route's
server-side layout chain, including the `getUser()` calls inside
`StudentLayout` and `StudentCourseLayout`.

**Verified directly**: re-ran the exact same navigation
(`/student/courses/{CSE1203}/course`) with client JavaScript disabled
(`scripts/perf/verify-prefetch.mjs`, `newContext({ javaScriptEnabled:
false })`) — which makes Next.js's client-side prefetching impossible,
since it's JS-driven. Login still worked (the login form is a real
`<form action={...}>` Server Action, works without JS).

| | JS enabled (real browser) | JS disabled (prefetch impossible) |
|---|---:|---:|
| `auth.getUser()` calls | 31 | **2** |
| Total Supabase calls | 38 | **9** |

This is conclusive, not circumstantial: eliminating client-side
prefetching removes 29 of 31 `getUser()` calls and 29 of 38 total calls,
for the identical page. **The page's own server render genuinely costs
~9 sequential Supabase round trips (2 `getUser()` + 7 REST/RPC calls)** —
which actually matches the prior diagnostic's code-reading estimate
almost exactly. **The other ~29 calls per pageview are Next.js silently
re-running the auth/layout chain once per sidebar link, in the
background, for links the user never clicked.**

One more nuance worth recording precisely rather than glossing over:
static reading of `StudentLayout` + `StudentCourseLayout` predicts 4
`getUser()` calls for a single real render (`getCurrentUser` +
`getMyFullName` in the top layout, `getCourseMembership` in the course
layout, each internally calling `getUser()` once — `getMyFullName` also
calls it), but the JS-disabled measurement shows only **2**. That
gap is most likely Next.js's own built-in per-request `fetch`
memoization (identical `GET` calls within one render pass are
automatically deduplicated by Next's extended `fetch`, independent of
anything this app's code does) already collapsing some of these calls.
This matters for scoping Phase 2 correctly — see below.

### What this changes about the plan

1. **Phase 2's `React.cache()` dedup should still happen**, but its
   ceiling is smaller than assumed: the real per-request call count is
   already partially self-deduplicating (4→2 for `getUser()` in this
   measurement), so the achievable win from Phase 2 alone is on the
   order of "2 calls → 1" for a genuine page render, not "8-9 calls
   collapse to 1." Worth doing (it's still real, it's free, and it also
   helps the *content* waterfall in Phase 3), but it is not the
   dominant lever this data points to.
2. **The dominant lever is the prefetch amplification**, which neither
   the original diagnostic nor the original Phase 2/3 plan targeted.
   Controlling `next/link` prefetch behavior on the 13-item course
   sidebar (`src/app/student/courses/[courseId]/layout.tsx`) is a
   plausible, low-risk, UI-layer-only change (a `prefetch` prop, not an
   auth/RLS change) that looks like it would cut total Supabase Auth
   traffic per pageview by roughly 3-4x. This is **not implemented** —
   flagging it as a strong Phase 2/3 candidate for your review, since it
   wasn't in the original plan's phase breakdown.
3. **This also sharpens H1/H2 from the original diagnostic** (tier
   capacity / concurrency). If every real navigation silently multiplies
   into ~13 background layout re-renders, a classroom of 50 students
   browsing casually generates on the order of 10x the Supabase Auth
   traffic their actual clicks would suggest — and `CLAUDE.md` already
   documents that this project's own integration-test suite has tripped
   Supabase Auth's rate limiter under repeated runs. This doesn't prove
   H1/H2, but it's a concrete, newly-identified mechanism by which
   ordinary classroom use could generate load disproportionate to actual
   user actions — worth keeping in mind for Phase 5's load test design.

### Sequential vs. parallel (page's own render, JS-disabled measurement)

Confirms the prior diagnostic's code reading: the 7 REST/RPC calls for
a course-content page (`courses`, `course_members`, `profiles`,
`units`, `lectures`, `materials`, `material_versions`) run **strictly
sequentially**, each starting only after the previous one's response
arrives (no timestamp overlap in the log) — consistent with
`getCourseContent`'s 5-step chain (each step needs the prior step's IDs)
plus `getCourseMembership` and `getMyFullName` not being combined with
it. Each individual Supabase call takes ~420–560ms end-to-end from this
machine (this includes this machine's own network path to
`ap-southeast-2`, not just Postgres execution time — consistent with
§5 of the prior diagnostic).

### What's left in the tree after Phase 1

- `src/instrumentation.ts` — inert unless `PERF_DIAG=1`. Recommend
  keeping it through Phase 2/3 (re-measurement needs it) and deciding
  then whether to keep it permanently (this repo has no observability
  tooling at all today — `docs/ARCHITECTURE_HANDOFF.md` §16 — so an
  opt-in, zero-cost hook like this is arguably worth keeping) or delete
  it once the optimization pass is done. **Your call — not deleted
  without asking.**
- `scripts/perf/measure-baseline.mjs`, `scripts/perf/verify-prefetch.mjs`,
  `scripts/perf/baseline-results.json` — the harness and its output.
  Reusable as-is for Phase 2/3 re-measurement (same script, run again
  after each change, diff the JSON).
- No other file was touched. `git status` is otherwise clean relative to
  the frozen baseline commit.

### Compliance check against the phase's constraints

- No AI invocation: confirmed — none of the 8 pages touch the Tutor,
  and no `ANTHROPIC_API_KEY`-backed path appears in any captured call
  (all captured calls are `/auth/v1/*` or `/rest/v1/*`).
- No assessment submitted, no enrollment altered beyond the
  add-then-remove fixture membership (verified removed).
- No production data mutated — this ran entirely against a local
  `next start`, and the only database write was the temporary,
  verified-removed fixture row.

---

## Phase 2A — Prefetch control (implemented, verified)

### Change

`src/components/shell/course-context-bar.tsx`: added `prefetch={false}`
to the two `<Link>` loops that render the course sidebar's top-level
sections and (unused today, but same component) sub-tabs — the exact
13-link surface the Phase 1 A/B test implicated. In the App Router,
`prefetch={false}` disables both viewport-triggered and hover-triggered
prefetch entirely (confirmed against this Next.js version's own docs,
`node_modules/next/dist/docs/.../link.md`); the route is only fetched
on an actual click. **Nothing else changed** — no routing, auth, RLS,
or navigation-*destination* behavior; `AppShell`'s top-level sidebar
(`SidebarNav`, 2 items) and in-page content links (lecture/material
links, etc.) were deliberately left untouched, since they weren't the
links the A/B test identified and the instruction was to make the
smallest change that addresses the measured cause.

`npx tsc --noEmit` and `npx eslint` on the changed file: clean. Rebuilt
(`next build`) and re-ran the **identical** Phase 1 benchmark
(`scripts/perf/measure-baseline.mjs phase2a`) against a fresh
`next start -p 3100`, same fixture-membership add/verify/remove
discipline (verified removed afterward — see transcript).

### Result

| Page | Wall before→after (ms) | TTFB before→after (ms) | Total calls before→after | `getUser()` before→after |
|---|---|---|---|---|
| dashboard *(not touched by this change — control)* | 4350→3754 | 2182→2190 | 17→17 | 15→15 |
| available-courses *(control)* | 3395→3339 | 1884→1833 | 14→14 | 9→9 |
| **course-home** | 6779→**4499** (−34%) | 2808→2839 | 37→**18** (−51%) | 29→**10** (−66%) |
| **materials** | 7140→**4712** (−34%) | 2873→2699 | 38→**19** (−50%) | 31→**12** (−61%) |
| **course-content** | 6842→**4628** (−32%) | 2801→2696 | 38→**19** (−50%) | 31→**12** (−61%) |
| **assessments-list** | 5631→**3825** (−32%) | 1464→1370 | 37→**20** (−46%) | 33→**16** (−52%) |
| **grades** | 4960→**2922** (−41%) | 1335→1372 | 31→**12** (−61%) | 27→**8** (−70%) |
| **announcements** | 4895→**2784** (−43%) | 1297→1315 | 30→**11** (−63%) | 27→**8** (−70%) |

Raw output: `scripts/perf/phase2a-results.json`.

**Clean verification signals:**
- The two pages *not* under the course sidebar (dashboard,
  available-courses) are **unchanged to within noise** — confirms the
  fix is precisely scoped to what it targeted, nothing else regressed
  or shifted.
- **TTFB is essentially unchanged** on every page (±1-5%, noise-level).
  This is the expected signature of a prefetch-only fix: TTFB reflects
  the page's *own* render, which this change never touched — only
  background activity after the page had already responded. If TTFB
  had moved, that would suggest the change accidentally affected real
  rendering, which it didn't.
- **The post-render call clusters shrank, they didn't fully
  disappear** — inspected the raw timeline for `course-content`:
  the real render still completes as the same 9-call sequential chain
  (2 `getUser()` + 7 REST calls, finishing ~3.1s in), followed by a
  smaller residual cluster of ~10 `auth.getUser()` calls instead of
  ~29. That residual is consistent with the *other*, deliberately
  untouched links on the page (`AppShell`'s 2-item sidebar, the "back
  to My Courses" link, in-page content links) still prefetching on
  viewport entry. This is expected, not a sign the fix is incomplete or
  wrong — it's the direct, honest consequence of scoping the change to
  exactly the 13 links the A/B test identified, per the instruction not
  to go further than that in this phase.

**Verdict: Phase 2A verifies cleanly.** Real, substantial reduction
(30-70% depending on metric and page) on every course-scoped page,
zero measurable effect on the two pages outside its scope, zero
TTFB/render regression, fixture membership confirmed removed
afterward. Proceeding to Phase 2B.

## Phase 2B — Auth deduplication (implemented, verified — mixed/modest result, reported honestly)

### Change

Audited every server-side `auth.getUser()` call site first, per
instruction (`grep -rl "auth\.getUser()" src`): 24 files matched,
including test files, `src/proxy.ts` (deliberately independent — a
separate middleware execution context, never sharing a render-scoped
cache, per the standing constraint that identity must stay
independently verified there), the AI Tutor path
(`src/lib/tutor/orchestrator.ts`, `src/lib/tutor/preferences.ts` — out
of scope, not invoked this pass, not part of the measured render path),
and three Route Handlers / Server Action files (`calendar-actions.ts`,
`announcements-actions.ts`, `projects/actions.ts`, and two upload
routes) — each of those runs as its own separate invocation triggered
by a user action, not as part of a shared Server Component render tree,
so `React.cache()` doesn't apply to them the same way and touching them
wasn't part of what Phase 1/2A measured.

**Scoped the actual code change to `src/lib/supabase/course.ts`** — the
file with all 5 call sites that the benchmarked pages actually exercise
(`getCurrentUser`, `getMyFullName`, `getCourseMembership`, `getMyCourses`,
`getAllCoursesWithStatus`). Added one `const getVerifiedUser =
cache(async () => { ... supabase.auth.getUser() ... })` and pointed all
5 functions at it instead of calling `supabase.auth.getUser()`
independently. Each function still creates its own `createClient()`
instance for its own subsequent queries (no change there) — only the
*identity verification* is now resolved once per request/render and
reused. `npx tsc --noEmit` and `npx eslint`: clean. Rebuilt, re-ran the
identical benchmark twice (to check reproducibility before reporting).

### Result — real but smaller than expected, and page-dependent

| Page | Total calls 2A→2B | `getUser()` 2A→2B | TTFB 2A→2B (run 1) | TTFB 2B repeat run |
|---|---|---|---|---|
| dashboard | 17→17 | 15→15 | 2190→**1410** | **1420** (reproduced) |
| available-courses | 14→14 | 9→9 | 1833→1809 | 1760 |
| course-home | 18→18 | 10→10 | 2839→2721 | 2725 |
| materials | 19→19 | 12→12 | 2699→2718 | 2690 |
| course-content | 19→19 | 12→12 | 2696→2644 | 2659 |
| assessments-list | 20→19 | 16→15 | 1370→1321 | 1358 |
| grades | 12→12 | 8→8 | 1372→1344 | 1321 |
| announcements | 11→11 | 8→8 | 1315→1321 | 1334 |

Raw output: `scripts/perf/phase2b-results.json`,
`scripts/perf/phase2b-repeat-results.json`.

**This did not do what I expected, and I'm reporting the actual
mechanism rather than the one I predicted.** Total Supabase call count
was essentially unchanged on 7 of 8 pages — `cache()` did not visibly
reduce the *number* of network calls. Dashboard's TTFB improved
substantially and **reproducibly** (2190ms → 1410ms, then 1420ms on an
independent repeat run — not noise). Investigated why, by diffing the
raw call timelines for dashboard between 2A and 2B:

- **Phase 2A** (no dedup): 8 `getUser()` calls before the first REST
  call, arriving in **4 sequential rounds** of 2 calls each, spaced
  ~400-450ms apart (visibly serialized — each round waits for the
  previous to finish).
- **Phase 2B** (with dedup): the same 8 `getUser()` calls before the
  first REST call, but arriving in **2 rounds of 4 calls**, roughly
  halving the number of sequential round trips on the critical path.

So the dedup's real effect here was **increased concurrency, not fewer
calls** — with the identity resolution cached, call sites that
previously had to wait on their own independent network round trip can
now proceed as soon as the (shared, in-flight) cached one resolves,
letting more of them overlap instead of queuing strictly one-after-
another. Total network call count didn't drop because most of these 8
calls are coming from **separate, independent request contexts**
(this page's own render plus at least one background prefetch of
`/student/courses`, each with its *own* `cache()` scope — memoization
never crosses request boundaries), so there was less to actually
deduplicate within any single scope than the original code-reading
estimate assumed.

For the course-scoped pages (course-home, materials, course-content,
grades, announcements), the change was within measurement noise in
both directions — no clear win, no regression. The most likely reason:
Phase 2A deliberately left other links (the 2-item `AppShell` sidebar,
the "back" link, in-page content links) prefetching, so those pages
still carry residual background request traffic that swamps whatever
small, page-render-local benefit Phase 2B contributes, making it hard
to isolate cleanly in a wall-clock comparison. This is also consistent
with the earlier Phase 1 JS-disabled control (measured *before* this
change existed) already showing only 2 `getUser()` calls for a real
course-page render, not 4 — evidence that Next.js's own built-in,
automatic per-render `fetch` memoization was likely already capturing
part of this benefit before Phase 2B's explicit code existed. Phase 2B
is not redundant (the dashboard result shows it does something real),
but its ceiling is smaller than the original diagnostic's code-reading
estimate suggested, and its benefit is inconsistent across pages with
this benchmark's current resolution.

**Verdict: verified safe (tsc/lint clean, identity still independently
server-verified on every call, no behavior change to what's
authorized), and verified to help — reproducibly, on at least one page
— but the honest result is "modest and page-dependent," not the clean
uniform win Phase 2A produced.** Kept the change; it's strictly an
improvement or a no-op everywhere measured, never a regression.

Fixture membership confirmed removed after every run this phase.

## Phase 3 — Course content waterfall (implemented, verified)

### ⚠️ Side effect discovered during verification, disclosed immediately

Before writing any code, I verified the candidate query against the
real, RLS-scoped database for both roles. For the student role this
reused the same temporary-fixture-membership pattern as every prior
phase (added, verified, removed). For the **instructor** role, I used
`scripts/.dev-credentials.json`'s `instructors[0]` entry — which
resolved to **your real account** (`ezaz.labib@gmail.com`), not a
synthetic fixture; instructors are already global members of every
course by this app's own architecture, so no membership step was
needed there, but I hadn't accounted for what that meant for sign-out.
My verification script called `userClient.auth.signOut()` at the end
to tidy up its own session — `@supabase/supabase-js`'s `signOut()`
defaults to **`scope: 'global'`**, which revokes *every* active
session/refresh token for that account, not just the one the script
created. Confirmed directly in `node_modules/@supabase/auth-js`'s
source (`async signOut(options = { scope: 'global' })`). **If you had
an active logged-in session in a browser, this most likely force-ended
it server-side** (not a visible instant kick — it surfaces on that
session's next token refresh or navigation). Nothing else was affected:
this was a read-only query comparison, no data was written, changed,
or deleted, and re-logging in resolves it fully. I flagged this to you
in chat the moment I found it, before continuing. I did not repeat this
— the rest of Phase 3's actual benchmark run only ever uses the
synthetic `dev-student` fixture, same as every prior phase.

### Relational model, inspected before writing any query

From `supabase/migrations/0001_core_schema.sql`: `units.course_id ->
courses.id`, `lectures.unit_id -> units.id`, `materials.lecture_id ->
lectures.id` are each a single, unambiguous foreign key — safe to embed
directly with no hint needed. `materials` and `material_versions` have
**two separate FKs between them** in opposite directions:
`material_versions.material_id -> materials.id` (the "all versions of
this material" relationship) and `materials.current_version_id ->
material_versions.id`, added via a named constraint,
`materials_current_version_fk` (the "only this material's current
version" relationship — the one the original 5-step code actually
used). PostgREST requires an explicit relationship hint whenever two
FKs connect the same pair of tables; naming the constraint
(`material_versions!materials_current_version_fk(...)`) selects
specifically the current-version relationship, never "every version" —
confirmed both by reading the schema and by checking the RLS policy
itself: `supabase/migrations/0002_rls_policies.sql`'s student policy on
`material_versions` is *itself* written in terms of
`m.current_version_id = material_versions.id` — the exact same
relationship this embed targets, which is strong independent evidence
the embed can't diverge from what RLS already considers "the visible
version."

### Proposed query shape, documented before implementation

One nested `courses` select — `units(lectures(materials(current_version:
material_versions!materials_current_version_fk(...))))` — eq-filtered
to the one `courseId`, `.single()`. Each level re-sorted by `position`
**client-side after fetching** rather than relying on PostgREST's
multi-level nested-order syntax — deliberately, to avoid depending on
behavior I hadn't independently confirmed for 3+ levels of nesting; the
arrays involved are small (one course's content), so an in-memory sort
costs nothing measurable. RLS applies to every embedded table exactly
as it would to a separate query — embedding doesn't bypass or widen
any policy, each nested table is still policy-checked per row.

### Verified equivalent BEFORE implementation, against the live database

Built `scripts/perf/verify-nested-query.mjs`: runs the *old* 5-step
implementation and the *candidate* nested query side by side against
the same real, RLS-scoped session (parameterized for student or
instructor role), and diffs every field. Result, both roles:

```
course:            [OK] identical
units:              [OK] 1 row, identical, order identical
lectures:           [OK] 2 rows, identical, order identical
materials:          [OK] 2 rows, identical (content)
  flat array global order: MISMATCH (expected — see below)
  per-lecture order (what the app renders): [OK] identical
materialVersions:   [OK] 2 rows, identical
=== OVERALL: SEMANTICALLY EQUIVALENT ===
```

The one raw difference found, investigated rather than dismissed: the
old code fetched all of a course's materials in **one flat query
ordered by `position` globally** (across every lecture at once); the
new code's flat array is **grouped by lecture, then sorted by
`position` within each** — a different permutation when multiple
lectures interleave by position value. Checked whether this matters:
`grep -rn "\.materials\b|allMaterials" src` shows **every** consumer of
this array goes through `materialsForLecture(allMaterials, lectureId)`
(a `.filter()`, which preserves relative order) before rendering
anything — confirmed by also diffing the *per-lecture* order
specifically (what `materialsForLecture` actually produces), which
matched exactly for both lectures in the test course. No caller reads
the flat array's raw cross-lecture order. Concluded safe, implemented.

### Implementation

`src/lib/domain/queries.ts`: `getCourseContent()` rewritten from 5
sequential `await`s to one nested `.select()`, followed by a plain
in-memory sort-and-flatten into the **exact same `CourseContent`
return shape** (`{ course, units, lectures, materials, materialVersions
}`) using the same existing `toCourse`/`toUnit`/`toLecture`/`toMaterial`/
`toMaterialVersion` row-mapper functions, unmodified. No caller of
`getCourseContent` (9 files: student and instructor course pages,
materials, calendar, question-bank, assessments) needed any change —
the function's public contract didn't move. `getLectureContent()` and
`getMaterialDetail()` (similar but smaller sequential chains, used
elsewhere) were **not touched** — out of scope; the instruction named
this specific waterfall. `npx tsc --noEmit` and `npx eslint`: clean.

### Result

Rebuilt, re-ran the identical 8-page benchmark twice (to separate real
effect from run-to-run network noise, same discipline as Phase 2B).

| Page | Total calls 2B→3 | `getUser()` 2B→3 | TTFB 2B → Phase 3 (run 1) | TTFB Phase 3 repeat run |
|---|---|---|---|---|
| dashboard *(control — doesn't use getCourseContent)* | 17→17 | 15→15 | 1410→1484 | 1618 |
| available-courses *(control)* | 14→14 | 9→9 | 1809→1774 | 2720 |
| **course-home** | 18→**14** (−4) | 10→10 | 2721→**1299** | **1393** |
| **materials** | 19→**15** (−4) | 12→12 | 2718→**1318** | **1331** |
| **course-content** | 19→**15** (−4) | 12→12 | 2644→**2083*** | **1317** |
| assessments-list *(control)* | 19→19 | 15→15 | 1321→1315 | 1317 |
| grades *(control)* | 12→12 | 8→8 | 1344→1327 | 1325 |
| announcements *(control)* | 11→11 | 8→8 | 1321→1298 | 1341 |

Raw output: `scripts/perf/phase3-results.json`,
`scripts/perf/phase3-repeat-results.json`.

\* **Investigated, not forced into the expected story**: course-content's
first-run TTFB (2083ms) looked like it might mean the collapse helped
that page less than course-home/materials despite an identical −4 call
reduction. Traced the raw call timeline instead of assuming: two
individual REST calls (`course_members`, `profiles`) took ~1200ms each
in that one run, roughly 3x their normal ~430ms — a network/database
latency outlier on that specific run, not a structural difference
(same query shape, same call count as the other two pages). The repeat
run confirms this: course-content's TTFB came back at 1317ms, right in
line with course-home (1393ms) and materials (1331ms). The controls
(dashboard, available-courses, assessments-list, grades, announcements
— none of which call `getCourseContent`) are unchanged to within the
same run-to-run noise band throughout, confirming the change is
precisely scoped and nothing else shifted.

**Confirmations requested:**
- **Five sequential calls became one**: yes — `courses`, `units`,
  `lectures`, `materials`, `material_versions` collapsed into a single
  nested `.select()`. Total call count on every page using
  `getCourseContent` dropped by exactly 4, consistently, across every
  run.
- **Returned counts**: identical before/after — verified directly
  (`scripts/perf/verify-nested-query.mjs` output above): 1 unit, 2
  lectures, 2 materials, 2 current material versions, both roles.
- **Ordering and `current_version_id` behavior**: identical for
  everything the app actually renders (units, lectures, and
  per-lecture material order all matched exactly); the one raw
  difference found (flat array's cross-lecture order) was investigated
  and confirmed to affect no code path, not assumed harmless.
- **RLS/role behavior**: intact — verified against the real database
  as both the student fixture and the real instructor account (with
  the sign-out caveat disclosed above), same result set both times
  relative to each role's own old-implementation baseline. No new
  column or table was added to any select that wasn't already being
  fetched by the old code; the embed uses the identical relationship
  (`current_version_id`) the existing student RLS policy on
  `material_versions` already keys off.

Fixture membership confirmed removed after every run this phase.

### Where the latency actually went (updated)

Course-content's wall time is now **~2800-3200ms**, down from the
original **6842ms** — roughly a **55-58% reduction** from Phase 1's
baseline, across all three phases combined (2A: −32%, 2B: marginal on
this page specifically, 3: a further ~35-50% off the post-2B TTFB).
TTFB for course-scoped pages has converged to **~1300-1400ms**, close
to the ~1300-1500ms range the *control* pages (dashboard, grades,
announcements — pages that were never part of the waterfall) have sat
at throughout every phase. That convergence is itself informative: it
suggests **~1300ms is roughly this environment's floor** for a page
needing even 2-3 sequential Supabase round trips at ~420-560ms each
(consistent with `PERFORMANCE_DIAGNOSTIC_2026-09-21.md` §5's per-call
network-latency finding to `ap-southeast-2`) — not a remaining
application-level waterfall to collapse further. Squeezing meaningfully
below that floor would need either fewer round trips than 2-3 (hard to
get much lower without touching auth architecture more invasively) or
reducing the per-call latency itself — i.e., the geography question
Phase 4 covers next, deliberately not touched in this phase.

**Original phase objective explicitly revisited**: the objective was
"eliminate or substantially collapse the sequential five-step content
fetch." It's collapsed (5 calls → 1, confirmed on every run). The
premise that this would then be "the dominant remaining TTFB source"
was **not fully borne out** — for course-scoped pages it was a real,
worthwhile chunk (several hundred ms to ~1.4s depending on the page),
but the pages have now converged to the same ~1300-1400ms floor the
*non-waterfall* control pages were already sitting at, meaning what's
left is dominated by fixed per-call network latency to
`ap-southeast-2`, not remaining application-level sequencing. Reporting
this plainly rather than claiming a bigger win than the data supports.

---

## Phase 3.5 — Harden the performance harness

Fixes the class of problem behind the Phase 3 incident (verification
script authenticated as a real instructor account, then called
`signOut()` with Supabase's default global scope, likely revoking that
account's other active sessions), not just that one call site.

**Audit**: `grep -n "signOut\|instructors\[0\]" scripts/perf/*` found
exactly one file with either pattern —
`scripts/perf/verify-nested-query.mjs`. The other two scripts
(`measure-baseline.mjs`, `verify-prefetch.mjs`) never call `signOut()`
at all (Playwright's `browser.close()` only discards local cookies, it
never calls the Auth API), so they were never exposed to this
particular bug — but `verify-prefetch.mjs` had a related, smaller gap:
it unconditionally `upsert`ed then unconditionally `delete`d the
fixture's course membership, rather than tracking whether it actually
added the row — meaning it could have deleted a legitimate
pre-existing membership it didn't create. Fixed as part of this phase
for consistency, even though the instruction named the sign-out issue
specifically.

**New shared guard** (`scripts/perf/fixture-safety.mjs`), used by all
three scripts:
- `assertSyntheticAccount(email)` — throws unless the email matches a
  known synthetic-fixture pattern already in use by this repo
  (`@example.test`, or the timestamped `selfsignup-*`/`tomorrow-student-*`
  conventions from `e2e/helpers.ts`). Called before every
  `signInWithPassword` in every perf script now. Verified it actually
  rejects a real account:
  ```
  dev-student@example.test synthetic? true
  ezaz.labib@gmail.com synthetic? false
  OK: guard threw as expected: Refusing to use "ezaz.labib@gmail.com"...
  ```
- `safeSignOut(client)` — the only sign-out path perf scripts should
  use now; hard-codes `{ scope: "local" }` so a future call site can't
  regress by omitting the option.

**Instructor-role verification — not re-implemented safely, per
instruction**: `verify-nested-query.mjs` is now **student-role only**.
The one-time instructor-role RLS-equivalence check already ran (Phase
3, documented above) and doesn't need repeating for this same change;
automating it going forward would need a synthetic instructor fixture
that doesn't currently exist —
`scripts/.dev-credentials.json`'s `instructors` array has exactly two
entries, both real email addresses (confirmed:
`ezaz.labib@gmail.com`, `labibahm@msu.edu`), no synthetic instructor
account exists anywhere in this project. **Documenting what would be
needed rather than creating it autonomously**, per instruction: a
`dev-instructor@example.test`-style account, added to
`instructor_allowlist` and given a `course_members(role='instructor')`
row for CSE 1203, the same way `dev-student@example.test` already
exists (see `scripts/create-dev-users.mjs`) — a real, human-reviewed
change to account provisioning, not something this pass should do on
its own.

**Verified after hardening**: re-ran `verify-nested-query.mjs` — same
`SEMANTICALLY EQUIVALENT` result as before, now using only the
synthetic fixture, with `safeSignOut()`, and cleanup confirmed. No
production account was touched again during this phase.

---

## Phase 3.6 — Final code review and checkpoint

Reviewed the complete diff (`course-context-bar.tsx`, `course.ts`,
`queries.ts`, `instrumentation.ts`, `scripts/perf/*`) against every
item requested:

| Check | Finding |
|---|---|
| Authorization/RLS regressions | None. Nested embed in `getCourseContent` uses the identical `current_version_id` relationship the existing student RLS policy on `material_versions` already keys off (`supabase/migrations/0002_rls_policies.sql`); every embedded table is still policy-checked per row by PostgREST regardless of query shape. |
| Changed course-content semantics | One difference found and resolved: the flat `materials` array's cross-lecture ordering differs from the old global `order by position`. Confirmed via full-codebase grep that no caller reads that raw order — every consumer filters via `materialsForLecture()` first, and per-lecture order was verified identical. |
| `current_version_id` correctness | Verified empirically against the live database, both before writing the real code (`verify-nested-query.mjs`) and again after Phase 3.5's hardening — exact match, both roles tested for the original check. |
| Unexpected caching across users/requests | Checked against this exact Next.js version's own docs, not assumed: `node_modules/next/dist/docs/.../06-fetching-data.md` — *"React.cache is scoped to the current request only. Each request gets its own memoization scope with no sharing between requests."* `getVerifiedUser` cannot leak one user's identity into another's concurrent request. |
| Navigation regressions from `prefetch={false}` | The Phase 1-3 benchmark only ever did direct `page.goto()` navigations, which never exercises Next.js's client-side `<Link>` transition path. Built a dedicated click-based test (`scripts/perf/smoke-click-nav.mjs`): clicked all 4 of Materials/Grades/Announcements/Calendar as real `<Link>` clicks, fresh page per click. **First attempt showed 3 of 4 "failing"** — investigated rather than assumed a real bug: the failure was in my *test's* wait logic (`waitForLoadState("networkidle")` doesn't reliably signal completion of a Next.js client-side soft navigation), not the app. Rewritten to `Promise.all([page.waitForURL(...), locator.click()])` with a fresh page load per click — **4/4 pass**, correct `href`, correct final URL, every time. |
| Accidental production logging/overhead from instrumentation | `src/instrumentation.ts` returns immediately unless `process.env.PERF_DIAG === "1"` — a single string comparison. `PERF_DIAG` is not among this project's documented Vercel production environment variables (`ARCHITECTURE_HANDOFF.md` §14 lists exactly four: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`), so it cannot activate in production. Even if it did, it only logs `method`/`path`/`durationMs`/`status` — never headers, bodies, or tokens. |
| Test scripts capable of mutating real data or sessions | Fixed in Phase 3.5 above — tracked add/remove everywhere, `safeSignOut`, synthetic-account guard. |
| Unnecessary abstractions or dependencies | None added — no new npm package, `fixture-safety.mjs` is a ~40-line targeted helper, not a generalized framework. |

**A residual, accepted trade-off worth naming rather than hiding**:
`getCourseContent()`'s nested-select result is cast with `as unknown as`
(TypeScript can't statically infer a nested-select string's shape).
This means a future schema change to any of these five tables would
compile successfully even if the actual query shape silently drifted —
the safety net is the empirical verification in
`scripts/perf/verify-nested-query.mjs`, not the type system. This
mirrors an existing, accepted pattern in this codebase
(`database.types.ts` is itself hand-maintained, not generated — see
`ARCHITECTURE_HANDOFF.md` §5), so it's consistent with how this project
already handles Supabase's type-inference limits elsewhere, not a new
category of risk introduced by this change.

**Static verification, full project** (not just the changed files):
`npx tsc --noEmit` — clean. `npx eslint .` — one pre-existing error in
`practice-session.tsx` (a documented, out-of-scope `setState`-in-effect
finding, `ARCHITECTURE_HANDOFF.md` §13, not touched by this diff) and
zero new findings after cleaning up one unused-variable warning in my
own `verify-nested-query.mjs`. `npx next build` — clean. Did **not**
run `npm run test` or `npm run test:e2e` (both write to the live shared
database per `SAFE_DEVELOPMENT.md` — not run casually, and none of
this pass's changes touch a code path those suites specifically cover
that the targeted checks above don't already exercise more precisely).

**Verdict: clean. Committed** (local `main`, not pushed):

```
22366fb perf: collapse course-content waterfall, dedupe auth, control prefetch
```

17 files changed: the three source changes (prefetch control, auth
dedup, query collapse), `src/instrumentation.ts`, the full
`scripts/perf/` harness (including result JSON, scanned for secrets/PII
before staging — none found), and both diagnostic documents.

---

## Phase 4 — Geography analysis

Read-only throughout. No Vercel configuration, region, Supabase project,
or environment variable was changed. Everything below is either a
direct measurement from this session (labeled **MEASURED**) or a
widely-published, commonly-cited figure this investigation did not
itself generate (labeled **ESTIMATE/PUBLISHED**) — kept visibly
separate, per instruction.

### Known topology (MEASURED, this pass and the prior diagnostic)

- **Vercel function region: `iad1`** (Washington, D.C. / Virginia).
  `X-Vercel-Id: bom1::iad1::...` from the live production URL —
  `bom1` is the Mumbai edge PoP that received the request, `iad1` is
  where the Next.js server actually ran. No `vercel.json`/`vercel.ts`
  exists in this repo, so this is the account/project default, not a
  deliberate choice.
- **Supabase project region: `ap-southeast-2`** (Sydney). Confirmed
  from the pooler hostname in `.env.local`
  (`aws-0-ap-southeast-2.pooler.supabase.com`).
- **This environment's own network vantage point** appears South-Asia-
  proximate (the original diagnostic found a Cloudflare `CF-RAY` tag of
  `DAC`, Dhaka, on a direct Supabase request) — a reasonable, though not
  certified, stand-in for a Bangladesh-based user, and the same
  environment every Phase 1-3 measurement in this document was taken
  from.

### New measurements this phase (MEASURED)

Real-time to raw AWS regional endpoints (`https://s3.<region>.amazonaws.com/`,
public, read-only, 3-5 samples each) as a region-comparison proxy,
independent of both Vercel's and Supabase's own edge/CDN layers:

| Region | Connect time (this environment) | Notes |
|---|---|---|
| `ap-south-1` (Mumbai) | **~45-80ms** | Fastest — matches the `bom1` Vercel edge PoP finding |
| `ap-southeast-1` (Singapore) | **~80-140ms** | Second-fastest |
| `ap-northeast-1` (Tokyo) | ~130-215ms | |
| `ap-southeast-2` (Sydney) — **current Supabase region** | ~230-390ms | |
| `us-east-1` (Virginia) — **current Vercel region** | ~300-380ms | Comparable to Sydney, both well behind Singapore/Mumbai |

Separately, real Supabase project traffic showed a pattern worth
investigating rather than averaging away: a lightweight, unauthenticated
call to Supabase's own health endpoint returned in **~11-33ms
connect / ~55-264ms TTFB** — much faster than the raw AWS-Sydney figure
above — while every real, authenticated data call made throughout
Phases 1-3 (same environment, same network path) consistently took
**~420-560ms**. Investigated: the most likely mechanism is that
Supabase fronts its API with its own CDN/edge layer (independent of
Vercel's), which terminates the client connection nearby and quickly
answers anything that doesn't need real backend work; a call that
*does* need real work (JWT validation, an RLS-scoped Postgres query)
then pays an additional edge→Sydney-backend hop on top — a fast
handshake (~50-150ms) plus genuine Sydney round-trip/query time
(~270-400ms, consistent with the raw AWS-Sydney figures above) adds up
to almost exactly the ~420-560ms observed throughout this entire pass.
This matters directly for the topology question below: it suggests the
*client-facing* leg to Supabase can be fast almost regardless of
region (edge-fronted), but the *backend* Sydney-processing cost is
close to fixed unless the caller is actually near Sydney.

### An honest gap in this measurement, not papered over

Every Phase 1-3 number in this document (the ~420-560ms per-call figure
included) was produced by running the Next.js app **locally, on this
sandbox**, not inside Vercel's actual Virginia datacenter. That
approximates "a Bangladesh-ish vantage point talking to Sydney," which
is genuinely useful for understanding the *waterfall structure* and the
*relative* wins from Phases 2A/2B/3 — but it is **not** a direct
measurement of production's real Virginia-function-to-Sydney-database
server-to-server latency, which this session has no way to obtain
without either deploying test code to Virginia (an infrastructure
change, out of scope for this phase) or reading Vercel's own function
logs (this session has no authenticated Vercel CLI access — confirmed
unavailable at session start). This gap is exactly what the
recommended next experiment (below) is designed to close, safely.

### Topology comparison

**A. Current — Virginia Vercel → Sydney Supabase.**
Bangladesh↔Virginia (client↔function) pays real transoceanic distance
on every request; Virginia↔Sydney (function↔database) is paid on every
one of the 2-3 remaining sequential Supabase calls per page (post
Phase 2A/2B/3). Published estimate for the function↔database leg
specifically (**ESTIMATE**, not measured by this session): commonly-cited
AWS `us-east-1`↔`ap-southeast-2` inter-region network RTT is roughly
200-230ms at the base network layer; real application-level round
trips (TLS, HTTP, actual query execution) typically land higher —
plausibly in the same few-hundred-ms range this session measured from
its own (different) vantage point. This is the baseline everything
below is compared against.

**B. Singapore/nearby Vercel → Sydney Supabase (no DB change).**
Improves the Bangladesh↔function leg substantially — **measured**
~80-140ms to Singapore vs. ~300-380ms to Virginia from this environment,
a real and large improvement for the single client↔function round trip
each request makes. **Does not** improve the function↔database leg,
which is what's paid 2-3 times *sequentially* per page and is the
larger, repeated cost. Operational complexity: low (a region field, no
data migration). Rollback: trivial (redeploy with the old region or no
region pin). **Net assessment: meaningfully better first/last-byte
latency, but doesn't touch the dominant repeated cost** — this is
precisely the "geographically closest ≠ fastest for this workload"
case the instruction anticipated.

**C. Sydney Vercel → Sydney Supabase (co-located, no DB change).**
Function↔database calls would become same-region (or same-metro)
traffic — typically single-digit-to-low-double-digit ms instead of
the ~270-400+ms Sydney-backend cost measured/estimated above, for
*each* of the 2-3 sequential calls a page still makes after Phases
2A-3. That's the dominant, repeated cost in the current waterfall, so
this is where most of the *remaining* application-level latency
plausibly lives. The trade-off: the Bangladesh↔function leg doesn't
improve (Sydney's raw RTT from this environment, ~230-390ms, is
comparable to — not clearly better than — Virginia's ~300-380ms), so
the *first* and *last* network hop of each request stays roughly where
it is today. Operational complexity: low — a Vercel function-region
setting only, no Supabase changes, no key rotation, no data migration.
Rollback: trivial (same as B). **This is the topology the instruction
specifically flagged as worth checking first, and the measurements
here support that instinct**: it targets the *repeated* cost (2-3x per
page) rather than the *single* cost (1x per page) B targets, and does
so at the same low risk/effort as B.

**D. Singapore/nearby Vercel → Singapore Supabase (requires DB
migration).** Best theoretical outcome — fast on both legs
simultaneously (**measured** ~80-140ms Bangladesh↔Singapore, and a
co-located function↔database leg). But this requires migrating
Supabase Auth, Postgres, Storage, all configuration, and all keys — a
categorically larger, higher-risk, harder-to-reverse undertaking than
A→B or A→C, on a project explicitly documented as having no staging
environment and one shared production database
(`SAFE_DEVELOPMENT.md`). **Not justified by current evidence**: Topology
C already targets the dominant cost at a small fraction of the risk;
D's *incremental* benefit over C (improving the single client↔function
leg by roughly the same amount B would) doesn't come close to
justifying a full data-plane migration on this project's current scale
(one real course, four real students) and safety posture.

### Recommendation

**Move only the Vercel function region, toward Sydney (Topology C),
and validate it on a Preview deployment before touching Production —
do not execute this yet.** Concretely, as the next experiment:

1. Add a `regions` pin (via `vercel.json` or `vercel.ts`, per current
   Vercel docs — this session could not independently re-verify the
   exact current region code list or Hobby/Pro region-selection limits
   against a live account, since no authenticated Vercel CLI/dashboard
   access is available here; confirm the exact syntax and available
   region codes directly against Vercel's own docs or `vercel regions
   ls` before touching anything) to a Sydney-region function.
2. Deploy as a **Preview** (`vercel deploy`, no `--prod`) — per
   `ARCHITECTURE_HANDOFF.md` §14, this project's Preview environment
   has **zero database environment variables configured**, so a
   Preview deploy is safe by construction; it would need the same
   Supabase env vars temporarily added to Preview (a config change of
   its own, needing the same sign-off as everything else here) to
   actually reach the database and be measurable.
3. Measure the Preview URL with the same tooling already built
   (`curl -w`, or the `PERF_DIAG` instrumentation already in the tree)
   and compare directly against this document's Phase 1-3 baselines.
4. Only promote to Production if the Preview measurement confirms the
   expected win — turning an infrastructure bet into a measured
   decision instead of an assumption, the same discipline this entire
   document has tried to hold to.

This keeps the higher-risk, higher-effort Topology D (Supabase
migration) off the table entirely unless C is tried first and turns out
insufficient — which current evidence gives no reason to expect.

---

## Phase 4 experiment — executed: Sydney Preview vs. Virginia Preview

The recommendation above was carried out, on branch `perf/sydney-preview`
(no functional code changes — see `docs/PERF_SYDNEY_PREVIEW_EXPERIMENT.md`
for why no `vercel.json` was committed). **Production was never touched**;
confirmed by deployment ID before and after
(`dpl_CUUN61wSmPnwzpwCjjT1xvMbnZxR`, target `production`, region
`iad1` — identical at the start and end of this experiment).

### Setup

- **Sydney Preview**: `https://university-qk8c407n4-tiferet.vercel.app`
  (`dpl_5UzFutTeAebRvDECzrNmYqNYUP9V`) — `vercel deploy --regions syd1`,
  target `preview` (confirmed via `vercel inspect`), function region
  `syd1` (confirmed via `vercel inspect`'s build output **and**
  independently via the `X-Vercel-Id: bom1::syd1::...` response
  header — two independent confirmations).
- **Virginia control Preview**: `https://university-l4greb9h6-tiferet.vercel.app`
  (`dpl_2ytCb5McPcByteTHhWJTy6egTFnm`) — identical code,
  `vercel deploy --regions iad1`, added specifically to isolate region
  as the only variable (see "an unexpected finding," below, for why
  this became necessary rather than optional).
- Both deployments: Supabase connectivity supplied via `vercel deploy`'s
  per-deployment `-b`/`-e` flags (`NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — the same non-secret,
  non-rotated values Production already uses), **never persisted to
  the project's Preview environment scope** in the dashboard and never
  written to any committed file. `SUPABASE_SECRET_KEY` was not needed
  or supplied — confirmed by grep that no page under test touches the
  service-role/admin client.
- `PERF_DIAG=1` also supplied per-deployment (same mechanism), enabling
  `src/instrumentation.ts`'s existing fetch-logging hook so
  `vercel logs <deployment-id> --follow` could capture the same
  per-call Supabase timing data Phases 1-3 used locally — this time
  from the actual deployed function.
- Benchmarked with the **unmodified** `scripts/perf/measure-baseline.mjs`
  harness (same dev-student fixture, same tracked add/remove
  membership discipline, same 8 pages), pointed at each Preview URL via
  `PERF_BASE_URL`. Verified clean afterward on every run.
- 2 repetitions per region (8 pages × 2 = 16 timed navigations per
  region) to separate signal from noise, same discipline as Phases 2B/3.

### An unexpected finding, investigated rather than assumed

The first Sydney run showed TTFB around **70-90ms** — startlingly low
compared to this document's local-loopback Phase 1-3 numbers
(~1300-2800ms) — while wall time stayed at several seconds. That
mismatch (TTFB ≪ wall time, a much bigger gap than local testing ever
showed) was not accepted at face value. Deploying the Virginia control
and testing it the *same* way revealed **an identical pattern** —
TTFB ~64-152ms regardless of region. Conclusion: **TTFB, as captured by
the Navigation Timing API against a real Vercel deployment, is not a
reliable proxy for this app's actual data-readiness time** — most
likely Next.js flushing initial response bytes before the page's own
server-side data fetching resolves. This is a testing-methodology
finding, not a Sydney-specific one, and it invalidates any direct
comparison between this experiment's TTFB numbers and Phases 1-3's
local-loopback TTFB numbers — they are not measuring the same thing.
**Wall time and, especially, the raw per-call Supabase latency
(below) are the metrics actually trusted for this experiment's
conclusion.**

### The core result: per-call Supabase latency

Captured directly from each deployment's own function logs
(`vercel logs <id> --follow`, piped to a file, cross-referenced against
`src/instrumentation.ts`'s `PERF_DIAG` lines) — this is the real,
measured Vercel-function-to-Supabase latency this document's Phase 4
section could not obtain locally:

| | Sydney function → Sydney Supabase | Virginia function → Sydney Supabase |
|---|---:|---:|
| Calls captured | 98 | 74 |
| Median (all calls) | **26ms** | **284ms** |
| Median (`auth.getUser()`) | 21ms | 282ms |
| Median (REST) | 47ms | 286ms |
| Non-200 responses | **0** | **0** |

**~11x reduction in median per-call backend latency** from co-locating
compute with the database — this is the mechanism Phase 4's
(un-executed, at the time) recommendation predicted, now directly
measured rather than estimated from a published inter-region figure.

### Wall time, both repetitions

| Page | Sydney avg (2 runs) | Virginia avg (2 runs) | Reduction |
|---|---:|---:|---:|
| dashboard | 3848ms | 5517ms | 30% |
| available-courses | 3838ms | 7270ms | 47% |
| course-home | 3725ms | 5856ms | 36% |
| materials | 4373ms | 6785ms | 36% |
| course-content | 4687ms | 5578ms | 16% |
| assessments-list | 5113ms | 7055ms | 28% |
| grades | 3168ms | 4991ms | 37% |
| announcements | 3532ms | 5224ms | 32% |

Sydney was faster on **every single page, on every single run** (16 of
16 timed navigations) — not a mixed or noisy result. Reduction ranges
16-47%, averaging ~33%.

### Functional verification (Step 3/4 requirements)

- All 98 Sydney-side Supabase calls returned HTTP 200 — zero errors.
- Call-path breakdown confirms Phase 3's query collapse is intact on
  this deployment: exactly 3 `/rest/v1/courses` calls total, matching
  the 3 benchmarked pages that call `getCourseContent()`
  (course-home, materials, course-content) — and critically, **zero**
  separate `/rest/v1/units`, `/rest/v1/lectures`,
  `/rest/v1/materials`, or `/rest/v1/material_versions` calls, meaning
  the nested embed (not the old 5-query path) is what actually ran.
- Directly inspected rendered page content (not just HTTP status): the
  materials page shows the real course title ("CSE 1203 · Introduction
  to Computing") and real material titles ("Course presentation"); the
  grades page renders correctly. Not an error boundary, not a blank
  page.
- Login worked via the synthetic `dev-student@example.test` fixture
  only — no real account was used or touched this phase.
- No AI call: only `/auth/v1/*` and `/rest/v1/*` paths appear anywhere
  in the captured logs.
- No mutation beyond the same temporary, tracked, verified-removed
  `course_members` fixture row every prior phase has used.
- Deployment protection: none active on either Preview — both were
  reachable directly, no Vercel SSO/auth wall needed.

### Classification (per the requested A/B/C framework)

**A — Sydney produces a large, consistent improvement.** Not a
borderline or mixed call: 30-47% wall-time reduction on 7 of 8 pages
(16% on the eighth), 11x lower median backend latency, zero errors,
zero regressions, reproduced across two independent runs. Recommending
region cutover **as the next reviewed step** — not executing it
autonomously, per the standing approval boundary.

### Where the latency moved

Before this experiment, this document's working theory (Phase 4,
pre-execution) was that the ~1300-1400ms local-loopback TTFB floor was
"dominated by fixed per-call network latency to `ap-southeast-2`."
That's now directly confirmed, quantified, and shown to be almost
entirely a *region* effect, not a fundamental floor: the same code,
the same query shapes, the same number of round trips, dropped from a
284ms median per call to a 26ms median per call purely by moving the
compute 1,400km from Sydney instead of 15,000km. Wall time didn't drop
by the same 11x factor because wall time also includes real,
region-independent costs (TLS/connection setup per request, actual
Postgres query execution time, this testing machine's own network path
to whichever Vercel edge PoP received the request) — but the
*repeated, sequential* component of the waterfall, the one Phases
2A/2B/3 already worked hard to shrink from 5+ calls down to 2-3, is
exactly the part region proximity multiplies or divides.

### Does the evidence still support leaving Supabase in Sydney?

**Yes, more strongly than before.** Topology D (migrate Supabase to
Singapore too) was never justified by the evidence and still isn't:
Topology C just *measured* an 11x per-call latency win from a
Vercel-only change, at zero data-migration risk. There is no
remaining case for touching Supabase's region.

### Prepared production-cutover plan — NOT executed, awaiting separate approval

Sydney clearly won (Classification A), so this is prepared in full per
instruction. **Nothing below has been run.**

1. **Configuration change.** Add `"regions": ["syd1"]` to a new
   `vercel.json` at the repo root — this time as a *committed* setting
   is appropriate, since we now specifically want it to apply to the
   production deployment (unlike the Preview experiment, where a
   committed project-wide setting was the exact risk being avoided).
   Review the diff before committing; nothing else in `vercel.json`.
2. **Deployment/redeploy step.** `vercel deploy --prod` from a clean,
   reviewed `main` (after merging `perf/sydney-preview`'s branch notes
   or simply committing the `vercel.json` directly to `main`). This
   project's production deploys are already manual/CLI-only
   (`ARCHITECTURE_HANDOFF.md` §14) — this is the same process already
   documented in `docs/PRODUCTION_RUNBOOK.md`, with one added flag.
3. **Immediate smoke tests** (same shape as `docs/PRODUCTION_RUNBOOK.md`'s
   existing health check, extended slightly):
   - `curl -s -o /dev/null -w '%{http_code}' https://university-lms-tiferet.vercel.app/login` → expect `200`.
   - `vercel inspect <new-production-url>` → confirm `target: production`
     and function region `syd1` (exactly the check used throughout this
     experiment).
   - One real login as the synthetic `dev-student` fixture, one course
     page load, confirm no error, confirm `X-Vercel-Id` shows `::syd1::`.
   - Confirm the AI Tutor, assessments, and grading still work
     end-to-end for at least one non-mutating read path (these weren't
     touched by the region change, but a region cutover is exactly the
     kind of deploy where "nothing *should* have changed" deserves a
     real check, not just an assumption).
4. **Rollback procedure.** Trivial and fast: `vercel rollback` (per
   `docs/PRODUCTION_RUNBOOK.md`'s own documented pattern) reverts to the
   immediately prior production deployment (`dpl_CUUN61wSmPnwzpwCjjT1xvMbnZxR`,
   `iad1`) instantly, no rebuild — the same instant-revert property that
   made this whole experiment low-risk in the first place. No data-layer
   rollback is needed at any point, since Supabase is never touched.
5. **Post-cutover benchmark.** Re-run `scripts/perf/measure-baseline.mjs`
   against the real production URL (not a Preview) once cutover is live,
   and compare against both this experiment's Sydney-Preview numbers
   (expect close agreement) and the pre-cutover Virginia-production
   baseline — closing the loop with a real, not simulated, production
   measurement.
6. **When to run the staged 1→5→10→25→50 load test**: *after* cutover
   and its post-deploy benchmark are both confirmed clean, not before —
   the load test's purpose (per Phase 5) is validating classroom-scale
   concurrency, which should be tested against whichever topology is
   actually going to serve the real class, not the one about to be
   replaced. Still requires your separate, explicit approval regardless
   of cutover outcome, per the standing boundary.

---

## Phase 5 — Load test design

Design only — **the 10/25/50-user stages are not run against
production in this pass**, per instruction. A 1-user local validation
of the harness itself is included below to prove it works and mutates
nothing.

### Two separate concerns, deliberately not conflated

1. **Established-session navigation concurrency** — can N already-
   logged-in users browse the app (dashboard, course pages, materials,
   grades, announcements — the same read-only paths Phases 1-3
   benchmarked) concurrently without degrading? This is the actual
   classroom-capacity question.
2. **Login/authentication burst behavior** — a separate, narrower
   question about Supabase Auth's own sign-in throughput and rate
   limiting. `CLAUDE.md` already documents that this project's
   integration-test suite has tripped Supabase Auth's rate limiter
   under repeated runs — a load test that (1) needs to answer and (2)
   accidentally also stress-tests would produce a confounded result,
   exactly the failure mode the instruction called out. **The main
   50-user test must not perform 50 fresh sign-ins.**

### Harness design

- **Session pre-establishment, once, outside the timed test.** Before
  any concurrency stage, sign in a small, fixed pool of accounts once
  each and capture their session cookies. The timed test itself only
  ever replays already-authenticated navigation with those saved
  cookies — no `signInWithPassword` calls occur during a concurrency
  stage.
- **Fixture accounts, not real students, enforced by
  `scripts/perf/fixture-safety.mjs`'s `assertSyntheticAccount()` guard**
  (Phase 3.5) — every session the harness pre-establishes is checked
  against the same synthetic-pattern allowlist used everywhere else in
  this pass. This project's actual synthetic pool
  (`scripts/.dev-credentials.json`) currently has exactly **one**
  reliably-synthetic student fixture (`dev-student@example.test`) plus
  two timestamped disposable accounts (`studentB`, `tomorrowStudent`) —
  **three real usable synthetic sessions, not fifty.** Simulating 50
  *concurrent* users with 3 real accounts means either (a) running
  multiple concurrent navigations *as* those 3 sessions (tests server-
  side concurrency handling accurately, since Postgres/RLS/Auth all
  key off the authenticated user regardless of how many physical
  people that maps to) or (b) provisioning more synthetic accounts
  first — **not done automatically by this pass**, same reasoning as
  Phase 3.5's instructor-fixture gap: creating new accounts is a real,
  human-reviewed provisioning decision. Documented here as a
  prerequisite for the higher concurrency stages, not silently worked
  around.
- **Paths under test**: the same 8 read-only pages Phases 1-3 already
  benchmarked (`/student`, `/student/courses`, course home, materials,
  course/lecture list, assessments list, grades, announcements) — all
  already proven not to mutate state, invoke AI, or touch grading.
  Explicitly excluded, per instruction: the AI Tutor, Practice's AI
  explanation path, starting/submitting any assessment attempt, any
  instructor mutation, any enrollment change.
- **Metrics recorded per stage**: p50/p95 navigation latency, error
  rate (non-2xx and thrown exceptions), timeouts, full HTTP status
  distribution, and any `429`/rate-limit response observed —
  distinguished explicitly from ordinary latency so a rate-limit event
  is never misread as "the server got slower."
- **Abort condition**: the stage stops immediately (not "at the end")
  if the error rate crosses a fixed threshold (proposed: >5% non-2xx
  or any `429`) or p95 latency exceeds a fixed multiple of the 1-user
  baseline (proposed: 5x) — checked continuously during the run, not
  only in the final report.
- **Progression**: 1 → 5 → 10 → 25 → 50 *concurrent navigations*, each
  stage gated on the previous one finishing cleanly before the next
  begins, exactly as specified.

### 1-user local validation (executed this pass — proves the harness itself is safe, not classroom capacity)

Built `scripts/perf/measure-baseline.mjs` back in Phase 1 already *is*
this harness's 1-user case — same fixture, same tracked add/remove
discipline, same 8 read-only paths, same non-mutation guarantees,
already run (and re-run) many times over this entire document with
zero incidents. No new code was needed to prove the pattern is safe at
n=1; scaling it to concurrent instances (multiple Playwright contexts
sharing the pre-established session cookies, run in parallel rather
than sequentially) is the only structural change needed to reach n=5
and beyond, and is a small, mechanical extension of an already-proven
script — but per instruction, **that extension is designed here, not
built and run against production**, since even a local 5-25-50
concurrent run would need the local `next start` server to be
representative of anything, and this pass's remaining time is better
spent stopping cleanly than building an untested harness minutes before
handing back control.

### What the future production test will actually request — for your approval, not yet sent

- 1 → 5 → 10 → 25 → 50 concurrent **already-authenticated** navigations
  (cookies established once, beforehand, outside the timed window) to
  the same 8 read-only, non-mutating, non-AI paths this document has
  used throughout.
- No new sign-ins during any timed stage.
- No assessment starts/submissions, no AI calls, no enrollment/roster
  changes, no material uploads.
- Immediate abort on >5% error rate, any `429`, or p95 > 5x the 1-user
  baseline.
- Would run against the **production URL**
  (`university-lms-tiferet.vercel.app`), since that's the only
  environment that reflects real production latency/concurrency
  behavior — explicitly **not started without your separate,
  explicit go-ahead**, per the standing approval boundary.

---

## Metric table (filled in as phases complete)

Course-content page used as the representative row throughout (present
in every phase's run; course-home/materials track closely).

| Metric | Original (diagnostic, code-reading) | Phase 1 baseline (measured) | After Phase 2A (prefetch) | After Phase 2B (auth dedup) | After Phase 3 (query collapse) | Final |
|---|---|---|---|---|---|---|
| Total Supabase calls, course-content | ~8–9 (estimated) | **38** | **19** | **19** | **15** | TBD (Phase 4/5 don't change app code) |
| `auth.getUser()` calls, course-content | ~4 (estimated) | **31** | **12** | **12** | **12** | TBD |
| Supabase calls, course page, real render only (JS-disabled control) | ~8–9 (estimated) | **9** | not re-run (2A/2B don't touch this control) | not re-run | **5** (9 − 4, same collapse) | TBD |
| `auth.getUser()`, course page, real render only (JS-disabled control) | ~4 (estimated) | **2** | not re-run | not re-run | **2** (unchanged — dedup already captured this) | TBD |
| TTFB, course-content | not measured locally | **2801ms** | **2696ms** | **2644–2659ms** | **~1317ms** (repeat run; first run hit a 2-call network outlier, see above) | TBD |
| Wall time, course-content | not measured locally | **6842ms** | **4628ms** | **4625ms** | **~2800-3200ms** | TBD |
| TTFB, dashboard *(control throughout — never uses getCourseContent)* | not measured locally | **2182ms** | 2190ms | **1410–1420ms** | **1484-1618ms** (within noise of 2B) | TBD |

**Where the latency went, end to end**: of course-content's original
6842ms wall time / 2801ms TTFB — Phase 2A (prefetch control) recovered
**~2.2s** wall time (−32%) by stopping 13 sidebar links from silently
re-running the auth/layout chain in the background; the single
largest, cleanest win found this pass, with zero effect on TTFB (it
was never touching the real render). Phase 2B (auth dedup) recovered a
further, smaller, page-dependent amount — clearly real and reproducible
on the dashboard (~780ms, −36% TTFB) but not cleanly separable from
noise on course-scoped pages, most likely because Next.js's own
automatic per-render `fetch` memoization had already captured part of
that benefit before this change existed (Phase 1's JS-disabled control
already showed 2 `getUser()` calls, not 4, before Phase 2B was
written). Phase 3 (query collapse) recovered the largest remaining
TTFB chunk on course-scoped pages — course-content's TTFB dropped from
~2650ms to a reproducible ~1317ms (−50%) by collapsing the 5-step
`courses → units → lectures → materials → material_versions` chain
into one nested query, exactly as targeted. **What's left (~1300-1400ms
TTFB) is no longer an application-level waterfall** — it now matches
the floor the never-touched control pages (dashboard, grades,
announcements) have sat at throughout, which is dominated by fixed
per-call network latency to `ap-southeast-2` (~420-560ms per round
trip, consistent with `PERFORMANCE_DIAGNOSTIC_2026-09-21.md` §5's
geography finding) for the 2-3 round trips any of these pages still
needs. That's Phase 4's question, not a further code-level fix.

---

*Phase 1 compiled from `scripts/perf/baseline-results.json` and the
JS-disabled A/B verification run. Phase 2A from
`scripts/perf/phase2a-results.json`. Phase 2B from
`scripts/perf/phase2b-results.json` and `phase2b-repeat-results.json`.
Phase 3 from `scripts/perf/verify-nested-query.mjs` (pre-implementation
equivalence check), `scripts/perf/phase3-results.json` and
`phase3-repeat-results.json`. Phase 3.5 hardening in
`scripts/perf/fixture-safety.mjs`. Phase 3.6 review verified via
`scripts/perf/smoke-click-nav.mjs` plus full `tsc`/`eslint`/`build`.
All code changes through Phase 3.6 are **committed** to local `main`
(`22366fb`), not pushed, not deployed. Phase 4 (geography) is read-only
analysis; Phase 5 (load-test design) was designed but its 5-50-user
stages were not executed against production. No Vercel region, Supabase
infrastructure, environment variable, production deployment, or
production data was changed at any point across this entire document.*

---

## Final status (end of this pass)

| Phase | Status |
|---|---|
| 1 — Measure | Done. Baseline established, prefetch amplification discovered and root-caused. |
| 2A — Prefetch control | Done, verified, committed. |
| 2B — Auth dedup | Done, verified, committed. Smaller/more page-dependent effect than expected — reported honestly. |
| 3 — Query collapse | Done, verified (both roles, before and after implementation), committed. One incident during verification, disclosed immediately. |
| 3.5 — Harness hardening | Done. Removed the real-account dependency; added reusable guards against recurrence. |
| 3.6 — Review and checkpoint | Done. Full diff reviewed against 8 specific risk categories; one test-methodology bug found and fixed (click-nav wait logic), zero app defects found. |
| 4 — Geography analysis | Done, read-only. Clear recommendation produced (Topology C), not executed. |
| 5 — Load-test design | Done, designed. 1-user harness already proven safe (it's Phase 1's own script). 5-50-user production stages **await your explicit approval**. |

**Status as of the previous checkpoint: nothing had changed Vercel
configuration, Supabase infrastructure, environment variables, or
production deployment state.** The one real-world side effect was
disclosed the moment it was found (Phase 3's instructor-account
sign-out) and has since been structurally prevented from recurring
(Phase 3.5). **This changed in the final phase below**, with explicit
authorization: production was cut over to `syd1`.

---

## Phase 6 — Production Sydney cutover, verification, and staged load test

### Pre-cutover safety check

- Working tree clean, on `main`, both performance commits
  (`22366fb`, `46ababc`) present.
- `perf/sydney-preview` diffed against `main`: **documentation and
  result JSON only** — zero application code, zero `vercel.json`. The
  Preview experiment's region pin was always CLI-only
  (`--regions syd1`, never committed), by design — confirmed nothing
  unexpected would enter Production via a merge.
- Fast-forward merge only (`perf/sydney-preview` was a direct
  descendant of `main`'s tip — no conflicts, no reconciliation
  needed).
- `npx tsc --noEmit`: clean. `npx eslint .`: one stray finding traced
  to `.vercel/output/` — leftover debris from an earlier failed local
  `vercel build` attempt (Windows blocks the symlinks Vercel's build
  output uses without elevated permissions — a local-environment
  limitation, not a code issue). Removed `.vercel/output` and `.next`,
  re-ran clean (only the pre-existing, out-of-scope
  `practice-session.tsx` finding remains). `npx next build`: clean.
- `src/instrumentation.ts` confirmed unchanged since its original
  commit, still gated on `PERF_DIAG === "1"`; `PERF_DIAG` is not among
  Production's configured environment variables, so it stays inert on
  the cutover deployment.
- Production recorded **before** any change: `dpl_CUUN61wSmPnwzpwCjjT1xvMbnZxR`,
  target `production`, region `iad1`, status Ready — **this is the
  rollback target**.
- Supabase environment variables reconfirmed unchanged (same 4
  variables, same "Production"-only scope, same age, no values
  printed).

Nothing differed materially from the verified Preview experiment —
proceeded.

### Applying the verified configuration

Created `vercel.json` at the repo root:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["syd1"]
}
```

Committed to `main` (`3934f8a`). Unlike the Preview experiment, a
*committed* region pin is correct here — this project's production
deploys are manual (`vercel --prod`, never triggered by a push or
merge — `ARCHITECTURE_HANDOFF.md` §14), so this file only takes effect
on the next deliberate production deployment. No Supabase file or
configuration was touched.

### Production cutover

`vercel deploy --prod --yes` → new deployment `dpl_7vt3bdsA1JtWbGTzqjHwhyH8U2B8`,
`readyState: READY`. **Independently verified, not taken on the
deploy command's word alone:**

| Check | Result |
|---|---|
| `vercel inspect` on the new deployment | `target: production`, `status: Ready` |
| Function region (build output) | `[syd1]` on every listed function |
| `X-Vercel-Id` header on the live production domain | `bom1::syd1::...` |
| Domain alias resolution | Both `university-lms-tiferet.vercel.app` and `university-lms-three.vercel.app` resolve to the new deployment ID |
| Supabase project | Unchanged — same pooler hostname (`aws-0-ap-southeast-2.pooler.supabase.com`), same project ref |
| Environment variables | Unchanged — same 4 variables, same scope, same age |
| Previous production deployment | Still present and independently inspectable (`dpl_CUUN61wSmPnwzpwCjjT1xvMbnZxR`) — rollback target intact |

### Immediate smoke test (Step 4)

Synthetic `dev-student@example.test` fixture only, tracked
add/verify-remove membership discipline (confirmed removed after every
run below). Against the **real production domain**:

- All 8 benchmarked pages (dashboard, available courses, course home,
  materials, course/content, assessments list, grades, announcements)
  loaded successfully — confirmed via `scripts/perf/measure-baseline.mjs`
  completing without error and via a separate direct content check
  (materials page shows the real course title "CSE 1203 · Introduction
  to Computing" and real material title "Course presentation"; all
  document responses `200`).
- Click-based navigation (not just direct URL loads) re-verified against
  production with `scripts/perf/smoke-click-nav.mjs` (extended to accept
  `PERF_BASE_URL`): **4/4** sidebar links (Materials, Grades,
  Announcements, Calendar) navigated correctly via real `<Link>` clicks
  — `prefetch={false}` confirmed not to have broken navigation in
  production.
- The Phase 3 nested `getCourseContent()` query renders correctly
  (course/content page content verified directly).
- Login worked via the real `/login` form with the synthetic fixture
  only — no real account touched.
- No AI request occurred (only `/auth/v1/*` and `/rest/v1/*` paths
  appear anywhere in this phase's activity; `/tutor` was never
  visited).
- No assessment started or submitted (only the read-only list page was
  visited).
- Fixture cleanup independently verified via direct database query
  after every run in this phase, not just trusted from script output.

### Post-cutover performance verification (Step 5)

TTFB was **not** used as the primary comparison metric, per the
Preview experiment's own finding that it isn't a reliable signal
against a real Vercel deployment. Wall time was compared instead,
against the same-methodology Virginia Preview control from the
executed Phase 4 experiment (identical code, real remote requests —
the only valid apples-to-apples baseline; Phase 1-3's local-loopback
numbers use a different measurement method entirely and were not
directly compared here):

| Page | Production (`syd1`, 3 samples avg) | Sydney Preview (2 samples avg) | Virginia Preview control (2 samples avg) | Reduction vs. Virginia |
|---|---:|---:|---:|---:|
| dashboard | 3870ms | 3848ms | 5517ms | 30% |
| available-courses | 3660ms | 3838ms | 7270ms | 50% |
| course-home | 3430ms | 3725ms | 5856ms | 41% |
| materials | 4010ms | 4373ms | 6785ms | 41% |
| course-content | 4157ms | 4687ms | 5578ms | 25% |
| assessments-list | 4983ms | 5113ms | 7055ms | 29% |
| grades | 3493ms | 3168ms | 4991ms | 30% |
| announcements | 3145ms | 3532ms | 5224ms | 40% |

**Production tracks the Sydney Preview closely** (within normal
run-to-run variance) and both sit well below the Virginia control —
confirming the Preview experiment's result reproduces in real
production, not just in an isolated sandbox.

**On the ~284ms → ~26ms per-call figure specifically**: this was
captured via `PERF_DIAG` instrumentation in the Preview experiment.
`PERF_DIAG` was deliberately **not** added to the production
deployment for this cutover (avoiding an unnecessary extra production
configuration change beyond the region pin itself), and Vercel's
native `vercel logs` stream showed no application-level request
logging without it — confirmed by direct test (started a log
follower, ran a full benchmark pass, zero lines captured). So this
exact number was **not** independently re-measured against production
itself. Reporting this gap honestly rather than implying it was
re-confirmed: the wall-time evidence above is strong indirect
confirmation the same mechanism is active (Production and the Sydney
Preview differ in no way that would affect this metric), but the
precise per-call figure is a Preview-only measurement.

### Gate check (Step 6) — all conditions met, proceeded to load test

- Production confirmed in `syd1`: yes (three independent confirmations).
- Smoke tests pass: yes (8/8 pages, 4/4 click-navigations).
- No functional regression: yes (content verified correct).
- No security/auth regression: yes (RLS/session behavior unchanged,
  same login path, same fixture-only testing discipline).
- Fixture cleanup verified: yes (independently, by direct query, after
  every run).
- No unexpected 4xx/5xx: yes (zero non-200 responses throughout).
- Sydney performance advantage still observable: yes (25-50% wall-time
  reduction vs. the Virginia control, consistent with the Preview
  experiment).

### Staged load test (Step 7) — built, and an artifact caught and corrected along the way

Built `scripts/perf/load-test.mjs`: establishes **one** real
authenticated session via the actual `/login` form (synthetic
`dev-student` fixture, tracked membership discipline) **once**,
outside any timed window, extracts its cookies, then fires concurrent
`fetch()` requests carrying those cookies at each stage — no further
sign-ins occur during any timed stage, per instruction. Cycles across
the same 8 read-only pages every prior phase benchmarked. A response
is only counted as success on an exact `200` — a `3xx` (which would
mean the reused session was rejected and the request got bounced
toward `/login`) counts as a failure, not a pass.

**An unexpected finding required investigation before any result could
be trusted, exactly the kind of thing not to paper over:**

1. **First run** (Node's default global `fetch` connection pool): the
   50-concurrent stage showed `p95: 14827ms`, 1 timeout — triggering
   the abort condition. This looked like a real capacity ceiling.
2. **Investigated rather than accepted**: ran the identical 50-request
   burst in isolation with an explicit, adequately-sized connection
   pool (`undici.Agent({ connections: 200 })`) instead of Node's
   default. Result: **50/50 success, p95 3498ms** — no timeout at all.
   This is conclusive, not circumstantial: same server, same
   concurrency, different client-side dispatcher, dramatically
   different result. **The original "ceiling" was the test harness's
   own default connection pool being too small for 50 concurrent
   requests to one origin, not a production limit.** Fixed
   `load-test.mjs` to set this dispatcher globally, sized well above
   the largest tested stage.
3. **Re-ran the full staged script with the fix**: worse this time —
   50-concurrent showed **72% error rate**, 36 timeouts,
   `p95: 15051ms`. Investigated again rather than concluding "still
   broken": this run's stage 50 fired immediately after stages
   1+5+10+25 (41 requests) had *just* completed, with no recovery
   gap — different from the clean isolated retest in step 2 above.
   Tested an isolated 50-burst again (5s gap, otherwise identical):
   succeeded, 50/50, but slower than the very first isolated test
   (`p50: 7956ms` vs. `2929ms`) — a real, reproducible sign that
   *repeated* concurrent bursts in quick succession compound, whether
   or not the client-side pool is adequate.
4. **Added a 15s cooldown between stages** to separate "can this
   concurrency level work" from "does zero-recovery-time back-to-back
   bursting cause pileup" — these are different, both real questions,
   and conflating them would have produced a misleading single number.
   This became the final, trusted run.

### Final load-test results (with adequate connection pool + inter-stage cooldown)

| Concurrency | p50 | p95 | Max | Success | Error rate | 429s | Timeouts | 5xx |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1380ms | 1380ms | 1380ms | 1/1 | 0% | 0 | 0 | 0 |
| 5 | 1178ms | 1385ms | 1385ms | 5/5 | 0% | 0 | 0 | 0 |
| 10 | 1017ms | 1166ms | 1166ms | 10/10 | 0% | 0 | 0 | 0 |
| 25 | 1224ms | 1685ms | 1696ms | 25/25 | 0% | 0 | 0 | 0 |
| 50 | 8791ms | 10158ms | 10501ms | 50/50 | 0% | 0 | 0 | 0 |

Raw output: `scripts/perf/load-test-results.json`.

**Abort status**: the p95-vs-baseline threshold (p95 > 5x the
stage-1 p50) triggered *after* stage 50 completed — correctly, since
10158ms is indeed >5x the 1380ms baseline — but 50 was already the
final configured stage, so this didn't cut anything short. No error-
rate or 429/timeout/5xx threshold was ever crossed in this final run.

## Step 8 — Interpreting capacity, not just pass/fail

**1 through 25 concurrent: flat and healthy.** p50 stays in a tight
~1000-1400ms band, p95 never exceeds ~1700ms, zero errors anywhere in
this range. There is no visible degradation trend across 1→5→10→25 —
whatever headroom the system has, 25 simultaneous authenticated
navigations sit comfortably inside it.

**50 concurrent: a real, distinct step change, not a gradual slope.**
Latency jumps roughly 6-9x (from ~1200-1700ms to ~8800-10200ms)
between the 25 and 50 stages — there is no intermediate data point
(the design didn't test 35 or 40), so whether this is a smooth curve
that happens to cross a visible threshold around 50, or a genuine
step function tied to some specific resource limit (most consistent
with a connection-pool-style constraint — Supabase's pooler, or Vercel
function instance concurrency — given the multi-second, queue-like
character of the delay rather than a proportional compute slowdown),
was not distinguished by this test design. **Zero errors, zero
timeouts, zero rate-limiting were observed at 50** — every request
eventually succeeded — so this is a *latency* finding, not an
*availability* finding.

**Is 50-student classroom usage "healthy" under this tested workload?**
Qualified yes, with an honest caveat: if 50 students happened to
request a page at the *exact same instant*, the measured experience
would be an 8-10 second wait instead of ~1-2 seconds — noticeably slow,
but not broken, erroring, or rate-limited. Real classroom usage is
virtually never 50 literally-simultaneous clicks (natural staggering
from students reading, thinking, and clicking at slightly different
times spreads real load out over many seconds), so this specific test
represents a *more concentrated* burst than most real classroom
moments — meaning actual experienced latency during a real class is
plausibly better than this worst-case number, though this was not
separately tested and shouldn't be asserted as measured fact.

**What this does not prove**: this is a classroom-capacity signal, not
a general scalability claim. It says nothing about sustained load over
an hour, nothing about literally 100+ concurrent users, and nothing
about behavior once the AI Tutor or assessment submission (both
explicitly excluded from this read-only test) are added to the mix.

**Remaining known limitation**: the specific bottleneck behind the
50-concurrent slowdown was not isolated to a single root cause in this
pass (Supabase pooler capacity is the leading candidate given the
queue-like latency signature, but Vercel Fluid Compute instance
scale-up under a sudden burst was not ruled out either) — flagged as
the natural next investigation if 50+-concurrent performance needs to
improve further, rather than guessed at here.

### Cleanup (Step 9)

- Fixture `course_members` row: confirmed removed via direct database
  query after every run in this phase (smoke test, click-nav test,
  content-verification run, both load-test executions, both isolated
  diagnostic bursts) — never left present.
- No stray `attempts` or other application data created for the
  `dev-student` fixture (checked directly).
- Production left in `syd1` — confirmed healthy (`200` on `/login`,
  correct region header) as of the last check in this phase.
- Previous production deployment (`dpl_CUUN61wSmPnwzpwCjjT1xvMbnZxR`,
  `iad1`) preserved and independently inspectable as the rollback
  reference — not deleted.
- Preview/control deployments from the Phase 4 experiment
  (`university-qk8c407n4-tiferet.vercel.app`,
  `university-l4greb9h6-tiferet.vercel.app`,
  `university-nmgqy6dx7-tiferet.vercel.app`) left in place, undocumented
  for deletion — no concrete reason to remove them yet.
- Supabase: untouched throughout — no migration, no region change, no
  credential rotation, no schema/RLS change.
- **No rollback occurred.** Production remained healthy throughout;
  the rollback path (`vercel rollback` / re-promoting
  `dpl_CUUN61wSmPnwzpwCjjT1xvMbnZxR`) was never exercised, only kept
  ready.
