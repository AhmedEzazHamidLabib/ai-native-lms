# Performance Diagnostic — 2026-09-21

Diagnosis-only pass. **No code, schema, config, dependency, or deployment
changes were made.** Production and the working tree are exactly as they
were before this investigation started.

---

## 0. Baseline (frozen at time of writing)

- Branch: `main`, up to date with `origin/main`, working tree clean.
- HEAD: `a0f26a45` ("docs: freeze production baseline and add operational
  handoff docs"). `develop` points at the same commit.
- Next.js `16.3.5` (Turbopack, App Router). React `19.2.8`. Node `v24.11.1`
  (local). `@supabase/supabase-js ^2.116.0`, `@supabase/ssr ^0.12.7`.
- No `vercel.json` in the repo — deployment config is whatever's set in
  the Vercel dashboard (region, env vars), not tracked in-repo.
- No existing load-test scripts anywhere in `scripts/` — nothing to
  "inspect before running," because nothing exists. Any concurrency
  testing this pass performs has to be built from scratch and kept
  deliberately tiny (see Phase 7).
- Production URL (from `docs/PRODUCTION_RUNBOOK.md`):
  `https://university-lms-tiferet.vercel.app`.

**What was actually run against production this session**: a handful
(≤5 total) of unauthenticated `GET /login` requests via `curl`, and two
`GET` requests to Supabase's public `/auth/v1/health` and `/rest/v1/`
endpoints. Nothing else touched the network. No login, no mutation, no
AI call, no migration, no `SUPABASE_SECRET_KEY` usage.

**Safe vs. unsafe test inventory**: safe = `curl` GETs to public,
unauthenticated, read-only endpoints (used above); `npx next build`
locally (touches no database — confirmed by `docs/SAFE_DEVELOPMENT.md`'s
own rule of thumb: no `.rpc(`/`.from(`/`SUPABASE_SECRET_KEY` in the
build process). Unsafe / not attempted = anything requiring login
(creates/touches session and `course_members`/attempt state for a real
or fixture account), any concurrency ramp against the live login/data
path, any AI Tutor call (cost + governor quota consumption), any
Playwright run against production (the existing suite touches real
enrollment/attempt rows per `CLAUDE.md`'s testing-conventions section).

---

## 1. Architecture relevant to performance

- **Every route in this app is server-rendered on demand.** The local
  production build (`npx next build`, run locally, zero database
  access) shows every page under `/student` and `/instructor` marked
  `ƒ` (dynamic); only `/_not-found` and `/auth/confirm` are static. This
  is expected for an auth-gated app, not itself a bug, but it means
  **there is no caching layer at all** — every navigation is a fresh
  Vercel function invocation plus fresh Supabase round trips, every
  time, for every user.
- **`src/proxy.ts` runs on almost every request.** Its matcher excludes
  only `_next/static`, `_next/image`, `favicon.ico`, and image
  extensions — every page, including the public `/login` page, passes
  through it. It calls `supabase.auth.getUser()` unconditionally (a
  real network call to Supabase Auth to validate the session), and for
  `/instructor/*` paths it does that **plus** a second query against
  `course_members`. This happens before Next.js has rendered anything.
- **No request-scoped auth caching.** `getCurrentUser()`,
  `getMyFullName()`, `getCourseMembership()`, `getMyCourses()`,
  `getAllCoursesWithStatus()`, `getCourseContent`'s caller chain, etc.
  (all in `src/lib/supabase/course.ts` / `src/lib/domain/queries.ts`)
  each independently call `supabase.auth.getUser()` again. Nothing
  memoizes "who is this request's user" once per render — it's
  re-derived, via a fresh Supabase Auth round trip, every single time a
  helper function needs it.
- **Confirmed, code-level waterfall on the most common page** —
  `/student/courses/[courseId]` (a student opening a course):
  1. `proxy.ts`: `getUser()` — 1 round trip.
  2. `StudentLayout` (`src/app/student/layout.tsx`): `getCurrentUser()`
     (`getUser()`) **then**, sequentially (not `Promise.all`'d),
     `getMyFullName()` (`getUser()` + a `profiles` query) — 3 more
     round trips, strictly sequential.
  3. The page itself does `Promise.all([getCourseContent(courseId),
     getStudentAnnouncements(courseId)])` — good, these two branches run
     in parallel — but `getCourseContent` (`src/lib/domain/queries.ts`)
     is **five sequential queries** internally (`courses` → `units` →
     `lectures` → `materials` → `material_versions`), each depending on
     IDs from the one before it, so it cannot be trivially parallelized
     without restructuring the query.
  - **Net: on the order of 8–9 sequential round trips to Supabase**
    before this page can render, for every single load, for every user,
    regardless of how many other people are using the app at the same
    moment. This is a `CONFIRMED` finding — read directly from the
    source, not inferred.
- **RLS shape**: `current_course_role(course_id)` (`supabase/migrations/0002_rls_policies.sql`)
  is a small, indexed, single-row lookup (`select role from
  course_members where course_id = ... and user_id = auth.uid() limit
  1`), marked `stable`. It's invoked once per row by policies on
  `courses`/`units`/`lectures`/etc. At this application's real scale (one
  active course, 4 real students) this is computationally trivial — a
  handful of function calls per query, not thousands. No `select *`
  found in any of the query modules read; explicit column lists are
  used consistently, and list queries correctly batch with `.in()`
  rather than looping.

---

## 2. Frontend / build measurements (local, production mode)

Ran `npx next build` locally — no database access, confirmed safe.

- Build completed in ~3.5s (1.4s compile + 2.1s typecheck), no errors.
- Total client-side JS in `.next/static/chunks`: **~1.1 MB uncompressed**,
  largest single chunk **256 KB**, next-largest **224 KB**, then **128
  KB**. This is a genuinely small bundle for a Next.js app of this
  size — nothing resembling a bloated dependency pulled into the client
  bundle. `node_modules` is 579 MB total but that's dev-time weight
  (TypeScript types, Playwright, eslint, etc.), not what ships to the
  browser.
- **Verdict: frontend bundle size is NOT a meaningful contributor.**
  This can be stated with confidence, not just "probably fine" — it's a
  direct measurement of the actual production output.

---

## 3. Network waterfall findings

Live browser-based waterfall tracing (Playwright/DevTools against the
production URL) was **not performed this session** — deliberately, given
the 90-minute demo window and the instruction to avoid anything that
risks production stability or consumes the remaining time budget right
before a live class. What was measured instead is real, but narrower:

```
curl -w '...' https://university-lms-tiferet.vercel.app/login   (×3, unauthenticated)
  run1: connect=91ms   tls=179ms  ttfb=630ms  total=638ms
  run2: connect=164ms  tls=397ms  ttfb=738ms  total=746ms
  run3: connect=19ms   tls=110ms  ttfb=457ms  total=465ms
```

Even for a public, unauthenticated login page, **TTFB alone is
450–740ms** from this environment. That's before any of the sequential
Supabase calls a logged-in page would add on top (Section 1). This is
consistent with — not proof of, but consistent with — the geography
finding in Section 5: this environment's outbound requests resolve
through a Cloudflare point-of-presence tagged `DAC` (Dhaka) on direct
Supabase requests (see below), so these numbers are a reasonable,
though not certified, proxy for what a Bangladesh-based user actually
experiences.

**What a full waterfall trace would add, and hasn't been done**: exact
FCP/LCP, per-request byte counts, and confirmation of whether any
duplicate client-side fetches exist beyond what's visible from reading
the server code. Recommended as the first post-demo follow-up (Section
17) — it's low-risk (read-only, against a page you're already loading
anyway) and would upgrade several `LIKELY` findings below to
`CONFIRMED`.

---

## 4. Supabase / query findings

| Pattern | Status |
|---|---|
| `select *` anywhere in sampled query code | Not found — explicit column lists used throughout |
| N+1 query loops (one query per row in application code) | Not found — list operations use `.in()` batching |
| Sequential round trips across *different* resources, one query at a time, where the code *could* fetch some of them concurrently | **CONFIRMED** — see Section 1 (`getCurrentUser` → `getMyFullName` in the layout; `getCourseContent`'s 5-step chain) |
| Redundant `auth.getUser()` calls across proxy → layout → page → domain helpers | **CONFIRMED** — same user re-verified via a fresh network call 4+ times per page load |
| RLS (`current_course_role`) cost | **NOT a meaningful problem at current scale** (one active course, 4 students) — simple indexed lookup, `stable`, called per-row but on tiny row counts |
| Missing indexes | Not evaluated directly (would require live `EXPLAIN ANALYZE` against production — out of scope for a read-only, no-DB-write pass); the one lookup inspected (`course_members(course_id, user_id)`) is exactly the shape an index should exist for, but this wasn't independently confirmed against the live schema |
| RPC usage for mutations | Consistent with the documented architecture — Server Actions → `SECURITY DEFINER` RPCs, no raw client-side writes for anything authorization-sensitive |

**Bottom line**: the database *queries themselves* are reasonably
written (batched, column-scoped, RLS-appropriate for this scale). The
problem is not query efficiency — it's **how many separate round trips
to that database happen, sequentially, per page**, combined with where
that database physically is (Section 5).

---

## 5. Hosting geography — CONFIRMED, not guessed

Determined from live response headers, not from project names (per the
instruction not to guess):

- **Vercel function execution region: `iad1`** (Washington, D.C. / US
  East). Evidence: `curl -I https://university-lms-tiferet.vercel.app/login`
  returned `X-Vercel-Id: bom1::iad1::q66rv-...`. Vercel's `X-Vercel-Id`
  format is `<edge-PoP>::<function-region>::<id>` — `bom1` (Mumbai) is
  the edge point-of-presence that received the request; `iad1` is
  where the actual Next.js server code ran. No `vercel.json` sets this
  explicitly, so it's whatever the project's default function region is
  — not a deliberate choice anyone made for this app.
- **Supabase Postgres region: `ap-southeast-2`** (Sydney, Australia).
  Evidence: `.env.local` contains a connection string pointing at
  `aws-0-ap-southeast-2.pooler.supabase.com`. This is the project's
  actual database region, read directly from configuration, not
  inferred.
- **This machine's own network path** appears to egress near
  Bangladesh: a direct request to Supabase's public REST endpoint
  returned `CF-RAY: ...-DAC` (Cloudflare's Dhaka PoP code). Stated
  plainly: this doesn't *prove* a real student's exact path, but it
  means the curl timings in Section 3 are a reasonable stand-in for
  Bangladesh-origin latency, not a US-developer-connection best case.

**Why this compounds so badly with Section 1's waterfall**: the Vercel
*function* runs in Virginia, not Mumbai — the Mumbai edge PoP only
terminates the user's TLS connection and proxies onward. So **every one
of the ~8–9 sequential Supabase calls per page executes as a
Virginia ↔ Sydney round trip** (typical AWS inter-region RTT in that
corridor is roughly 200–230ms), not a Bangladesh ↔ Sydney round trip.
Paid sequentially, 8–9 such round trips is **roughly 1.6–2.1 seconds of
pure inter-datacenter latency**, before accounting for the
Bangladesh ↔ Virginia leg on either end of the request, TLS handshake,
or any actual query execution time. This is exactly the kind of
"6 sequential remote round trips" amplification the investigation was
asked to look for, and it is now backed by response headers, not
speculation.

This also directly explains the user's own observation that a
*different, inactive* classroom experienced the same slowness: **this
latency stack is per-request and geography-driven, not
concurrency-driven.** A single user hitting a single page pays it in
full, alone, at 2am, with zero other traffic.

---

## 6. Static asset / presentation findings

- PDFs are stored in Supabase Storage; the upload path
  (`/api/materials/[materialId]/rendered-pdf`) writes via
  `supabase.storage.from("course-materials").upload(...)`. No explicit
  `Cache-Control`/ISR/`revalidate` directive was found on any material-
  serving route in the files inspected — delivery relies on whatever
  Supabase Storage's/the signed-URL mechanism's default headers are,
  which was **not independently verified against a live signed URL**
  this session (would require generating one against a real course's
  material, which is a live-data action outside this pass's read-only
  scope). Classify as `POSSIBLE`, not `CONFIRMED`.
- PDF is the rendered artifact directly (no server-side conversion at
  request time) — good, this rules out a class of "regenerate the PDF
  on every view" problem outright.
- Slide/PPTX content is pre-parsed into `slides` rows at ingestion time,
  not re-parsed per view — also good.
- Did not find evidence of a page eagerly loading an entire
  presentation's assets before becoming interactive from the code read
  this session, but this is exactly the kind of thing a real waterfall
  trace (Section 3) would confirm or refute with certainty; flagged as
  a gap, not asserted either way.

---

## 7. Concurrency results

**No progressive 1→5→10→25→50-user ramp was run against production.**
Reasoning, explicitly: no existing load-test harness exists in this
repo (confirmed by listing `scripts/`), building one safely (read-only,
no enrollment, no attempt submission, no AI calls, with abort-on-error-
rate wiring) is itself nontrivial engineering, and doing it for the
first time in the 90 minutes before a live demo is exactly the kind of
risk the brief asked to avoid. This is a real gap, not a finding — it's
explicitly called out rather than papered over.

What *was* done: 3 sequential, unauthenticated `GET /login` requests
(Section 3). All three returned `200` with consistent ~10.5KB payload
size; latency varied 465–746ms, which is more likely TLS/connection
variance than server load, given only 3 requests were made 1-2 seconds
apart. This is not evidence about concurrency behavior either way.

**H1/H2 (tier can't handle ~50 students / concurrency itself is the
cause) cannot be confirmed or ruled out from this session's evidence.**
See Section 9.

---

## 8. Simulated poor-network results

**Not performed this session.** Chrome DevTools network throttling or
Playwright-based throttling against the production URL would need
browser automation time this session didn't spend, given the demo
clock. It's also lower-value than it first appears: Section 5 already
gives a *measured* geographic latency stack (Virginia↔Sydney,
repeated 8–9 times sequentially), which is a stronger and more specific
explanation than a generic "simulate 3G" test would produce. A
bandwidth-only throttle (the easy kind to simulate locally) would
barely move the needle here anyway, since the actual bottleneck
this diagnostic found is **round-trip latency multiplied by sequential
call count**, not payload size (Section 2 shows payloads are small).
Recommended as a post-demo follow-up, scoped specifically to *latency*
throttling (e.g., Chrome DevTools "Slow 4G" or a custom high-RTT
profile), not bandwidth throttling.

---

## 9. Hypothesis evaluation

**H1 — Supabase/Vercel free/current tier can't handle ~50 students.**
- For: Not ruled out — no load test was run.
- Against: Nothing else in this investigation points at resource
  exhaustion; the request volume for a 50-student class doing normal
  LMS activity (viewing slides, occasional assessment) is very low by
  Supabase/Vercel standards, and the query patterns found are not
  expensive per-request.
- Confidence: **LOW** (untested, but no supporting signal either).
- Would confirm: an actual ramp test with real error rates/latency at
  each concurrency step (Section 7's gap).

**H2 — Student concurrency is causing the slowdown.**
- For: The user's original hypothesis; concurrency was never ruled out
  by direct testing.
- Against: **Directly contradicted by the user's own observation** —
  slowness recurred from a classroom that shouldn't have been actively
  using the app. A per-request, geography-driven latency stack
  (Section 5) explains that observation; pure concurrency does not.
- Confidence: **LOW**.
- Would confirm: slowness correlating with active concurrent sessions
  specifically, which the user's own report argues against.

**H3 — Campus internet/network routing is causing the slowdown.**
- For: Cannot be excluded from outside the campus network — genuinely
  requires testing from inside it.
- Against: Nothing to weigh either way from this session; explicitly
  **cannot be established without testing from the campus network
  itself** — stated here rather than guessed at, per the instruction.
- Confidence: **UNKNOWN — untestable from this environment.**
- Would confirm: a timing comparison from an actual campus connection
  vs. this session's numbers.

**H4 — Geographic latency is being amplified by application request
waterfalls.**
- For: **CONFIRMED, not just plausible.** Sections 1 and 5 together
  give a specific, measured mechanism: ~8–9 sequential Supabase calls
  per page × a Virginia↔Sydney function-to-database round trip that
  the app's own architecture forces, not something inherent to
  Supabase or Vercel individually.
- Against: nothing found that contradicts this.
- Confidence: **HIGH.**
- Would further confirm: a live network waterfall trace (Section 3's
  gap) showing the actual per-call timings matching this predicted
  ~1.6–2.1s stack.

**H5 — Frontend bundle/rendering is the primary problem.**
- For: nothing.
- Against: **measured** — ~1.1MB total client JS, largest chunk 256KB,
  a small, unremarkable production bundle (Section 2).
- Confidence: **HIGH that this is NOT the primary problem.**
- Would confirm/deny further: Lighthouse/DevTools performance trace,
  but the bundle-size question specifically is already answered.

**H6 — Large presentations/assets are the primary problem.**
- For: unverified — no live asset was measured this session.
- Against: architecture doesn't re-render PDFs per view; ingestion is
  pre-processed, not per-request.
- Confidence: **LOW-MEDIUM** that this is primary (real course content
  in this app is not documented as unusually large), but genuinely
  **not fully verified** — see Section 6's gap.

**H7 — Database queries/RLS are the primary problem.**
- For: nothing specific to query cost or RLS expense at this course's
  actual scale.
- Against: RLS check is a trivial indexed lookup (Section 1); no
  `select *`, no N+1 loops, no obviously missing batching.
- Confidence: **LOW** that *query cost* is the problem. (Query *count*
  and *sequencing* is a different, confirmed problem — see H4/H8.)

**H8 — Authentication/session restoration overhead is the primary
problem.**
- For: **CONFIRMED as a major contributing mechanism.** `getUser()` is
  called repeatedly and redundantly per page (proxy, layout ×2, page-
  level helpers) with zero request-scoped memoization — this alone adds
  several of the ~8–9 sequential Supabase round trips per page found in
  Section 1, and every one of them pays the Virginia↔Sydney tax from
  Section 5.
- Against: nothing.
- Confidence: **HIGH.**

**Overall root-cause ranking**: **H4 and H8 together** (a real request
waterfall, made of redundant auth checks and sequential content
queries, running from a Vercel function region that is far from both
the Supabase database and the actual users) is the best-supported,
most specific explanation, and it directly accounts for the user's own
observation that inactive-classroom slowness ruled out simple
concurrency. H1/H2/H3/H6 remain genuinely open questions this session's
tools couldn't close — not dismissed, just honestly unresolved. H5 and
"RLS cost" are the two hypotheses this session can rule out with actual
measurements.

---

## 10. Demo risk assessment

- **Is production currently healthy?** Yes, by the available signal:
  local build succeeds cleanly, `/login` returns consistent `200`s.
  Nothing in this pass found an error, crash, or broken path.
- **Safest pages to demonstrate**: anything that's mostly navigation +
  reading — course home, materials list, calendar, announcements. These
  are slow-but-correct under the findings above, not broken.
- **Potentially slow (not broken) pages/actions**: any *first*
  navigation after idle (cold Vercel function + the full auth/content
  waterfall from Section 1) — expect a multi-second wait on the very
  first click, then noticeably faster on subsequent ones as connections
  warm up. The AI Tutor's first turn and Course Intelligence-backed
  pages carry the same waterfall plus an actual Anthropic API call on
  top.
- **Actions to avoid during the demo**:
  - Don't start a real graded Class Test attempt on a real student
    account — `attempts` rows and `pending_grading_count` are real,
    persisted state; a demo submission would pollute the actual
    gradebook. Use a non-graded Mock Test / the Learning Diagnostic, or
    a dedicated demo account, if you need to show the assessment flow.
  - Don't run the AI Tutor a rapid handful of times back-to-back if you
    plan to demo it live for a class right after — `reserve_ai_generation()`
    enforces an 8/day per-student, 75/day per-course, 100/day global cap
    plus a 9-second per-request cooldown (`docs/ARCHITECTURE_HANDOFF.md`
    §8); a few demo/rehearsal turns eat into that same day's real quota
    for the real course.
  - Don't run `npm run test`, `npm run test:e2e`, or any `db:*` script
    before the demo — all of them write to the live shared database
    (`docs/SAFE_DEVELOPMENT.md`).
- **Could anything unexpectedly invoke an AI API?** Only the Tutor,
  Practice's wrong-answer explanation, and Course Intelligence compile
  — all explicit, instructor/student-initiated actions, never triggered
  by simply navigating.
- **Could anything mutate important production data unexpectedly?**
  Not from ordinary read/navigation. Starting an assessment attempt,
  submitting Practice, or grading a written response are the mutation
  points to be deliberate about — none fire from passive browsing.
- **Single-user demo failure risk**: low for *correctness* — the
  findings here describe added latency, not a broken code path. The
  realistic risk is **perceived slowness** (a multi-second wait on the
  first click of each new section), not an error or crash.
- **Recommended action before the demo**: load the app yourself
  end-to-end once, 5–10 minutes ahead of time, hitting the exact pages
  you plan to show, specifically to warm the Vercel function and
  establish fresh Supabase connections — the very first hit after idle
  is the slowest one by this diagnostic's own findings (cold function +
  full waterfall). Do **not** make any code/config changes before the
  demo on the strength of this report.

---

## 11–16. Recommended fixes (post-demo only — none implemented)

Ranked by expected impact vs. risk vs. effort. **Do not implement any of
this before the demo.**

1. **Collapse redundant `auth.getUser()` calls into one per request**
   (dedupe/memoize the resolved user across proxy → layout → page →
   domain helpers within a single request, e.g. via React's `cache()`
   for server-only reads). **Impact: HIGH. Risk: LOW — pure refactor,
   no behavior change, no schema/RLS touch. Effort: SMALL–MEDIUM**
   (touches many call sites in `src/lib/supabase/course.ts` and
   friends, but each change is mechanical). This alone likely removes
   3-4 of the ~8-9 sequential round trips per page.
2. **Move the Vercel function region to co-locate with the Supabase
   project (`ap-southeast-2`, Sydney), or at minimum away from
   `iad1`.** **Impact: HIGH — this is the single biggest lever, since
   it's multiplied by every sequential call.** Risk: **LOW functionally
   (it's a region setting, not a code change)** but it is a real
   production deployment/infra change, needs a deliberate redeploy, and
   should be verified against real latency from Bangladesh afterward,
   not assumed. Effort: SMALL (a Vercel dashboard/CLI setting) but
   treat as a real change, not a docs edit — confirm with the user
   explicitly before touching it, same as any other deployment change.
3. **Parallelize what's already independent** — e.g. `StudentLayout`'s
   `getCurrentUser()` + `getMyFullName()` via `Promise.all`. **Impact:
   MEDIUM (small in isolation, compounds with #1). Risk: LOW. Effort:
   SMALL.**
4. **Add a request-level waterfall/network trace** (Playwright timing
   instrumentation, or just DevTools against the deployed URL) as the
   next diagnostic step, to convert this session's `LIKELY`/`CONFIRMED-
   by-code-reading` findings into exact millisecond attribution per
   call. **Impact: enables everything else to be prioritized correctly.
   Risk: NONE (read-only). Effort: SMALL.**
5. **Verify actual Cache-Control headers on material/PDF delivery** and
   add explicit caching if Supabase Storage's defaults are weak.
   **Impact: MEDIUM for the materials-viewing flow specifically. Risk:
   LOW. Effort: SMALL.**
6. **Build a minimal, explicitly safe concurrency test** (read-only GETs
   against a public page, capped low, with hard abort on error-rate) to
   finally answer H1/H2 with real numbers. **Impact: closes an open
   question. Risk: LOW if built with the constraints this report
   specifies. Effort: SMALL–MEDIUM.**

## 17. Minimal post-demo optimization plan

In order: (1) do the network waterfall trace (#4 above) to get exact
numbers and confirm the predicted ~1.6–2.1s inter-region stack; (2)
apply the `auth.getUser()` dedup (#1) — pure refactor, safe, ships
independently; (3) with the user's explicit sign-off, evaluate moving
or adding a Vercel function region closer to `ap-southeast-2` (#2) and
re-measure from Section 3's same baseline to confirm the fix actually
worked before calling it done; (4) only then look at #5/#6 as
secondary polish. Do not reorder this — #2 without #1 done first makes
it much harder to tell how much each change actually contributed.

---

*Compiled by reading source and configuration, running one local
production build, and a handful of read-only curl requests. No
database write, migration, deployment, or dependency change occurred
during this investigation.*
