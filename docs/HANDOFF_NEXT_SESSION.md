# Handoff — Performance Diagnostic, Optimization Pass, Sydney Production Cutover, Load Test (2026-09-23)

Written at the end of a multi-session performance effort: diagnosed why
the LMS felt slow from Bangladesh, fixed three real, measured causes in
code (prefetch amplification, redundant auth checks, a 5-query content
waterfall), ran a controlled Preview experiment that found the Vercel
function region was the dominant remaining cost, cut production over
to it, and load-tested the result. See `CLAUDE.md`'s new "Performance
architecture" section for the durable rules this work established —
this document is the point-in-time narrative and current status.

**Full detail, every measurement, every phase**:
`docs/PERFORMANCE_DIAGNOSTIC_2026-09-21.md` (the original investigation)
and `docs/PERFORMANCE_OPTIMIZATION_2026-09-22.md` (everything since —
this is the long, honest version with raw numbers, dead ends, and one
disclosed incident; read it before touching any of the files listed
below).

Migrations: **unchanged this pass — still 0001 through 0049.** Nothing
in this entire effort touched the database schema, RLS, or Supabase in
any way.

## Production

- **Live URL**: https://university-lms-tiferet.vercel.app (alias of
  https://university-lms-three.vercel.app — both point at the same
  deployment).
- **Current deployment**: `dpl_7vt3bdsA1JtWbGTzqjHwhyH8U2B8`, region
  **`syd1`** (Sydney) — changed from the prior default (`iad1`,
  Virginia) on 2026-09-22, deployed via `vercel deploy --prod --yes`
  from a clean `main` with a newly-committed `vercel.json`. Verified
  three independent ways (see the optimization doc's Phase 6) — not
  taken on the deploy command's word alone.
- **Rollback target**: `dpl_CUUN61wSmPnwzpwCjjT1xvMbnZxR` (the prior
  `iad1` production deployment) — still live and inspectable.
  `vercel rollback` or `vercel promote dpl_CUUN61wSmPnwzpwCjjT1xvMbnZxR`
  restores it instantly if `syd1` ever needs to be reverted. **Never
  exercised this pass** — production stayed healthy throughout.
- Supabase: **completely untouched** — same project, same
  `ap-southeast-2` region, same environment variables, no migration, no
  credential rotation, no RLS change, at any point in this entire
  effort.
- 3 leftover Preview/control deployments from the Phase 4 experiment
  are still live (`university-qk8c407n4-tiferet.vercel.app`,
  `university-l4greb9h6-tiferet.vercel.app`,
  `university-nmgqy6dx7-tiferet.vercel.app`) — low risk (same
  non-secret public keys production already uses, no service-role
  key), left for the instructor to decide on, not cleaned up
  automatically.

## Git state

- **6 commits on `main`, pushed to `origin/main` — confirm this
  actually happened**: the push was blocked twice by the local Claude
  Code auto-mode permission classifier (once as "Data Exfiltration,"
  once as "Out-of-Place Publication" — almost certainly false
  positives for a plain `git push` to the user's own repo, but neither
  attempt was forced through). The user said they'd push it themselves
  or grant explicit permission — **verify `git log origin/main` shows
  up through `23101d4` before assuming this is synced**.
- Commits, in order: `22366fb` (prefetch/auth-dedup/query-collapse),
  `46ababc` (Phase 4/5 docs), `705251f` (Sydney Preview experiment),
  `3934f8a` (the `vercel.json` region pin), `23101d4` (production
  cutover verification + load test + final docs). Branch
  `perf/sydney-preview` was fast-forward merged into `main` — it no
  longer diverges and can be deleted whenever convenient.

## What's VERIFIED WORKING this session (measured, not just reasoned about)

- **Prefetch fix** (`src/components/shell/course-context-bar.tsx`,
  `prefetch={false}`): Next.js was silently re-running the auth/layout
  chain for all 13 course sidebar links on every page load. Measured
  30-70% fewer Supabase calls, 32-43% lower wall time on course pages,
  zero effect on TTFB (confirms it only killed background noise) and
  zero effect on the two control pages outside its scope. Verified
  real `<Link>` clicks still navigate correctly (a first attempt at
  this check had a bug in its own wait logic, not the app — caught and
  fixed before trusting the result).
- **Auth dedup** (`getVerifiedUser()` in `src/lib/supabase/course.ts`,
  `React.cache()`-wrapped): smaller, more page-dependent effect than
  the original code-reading estimate predicted — reported honestly
  rather than oversold. Clearly real and reproducible on the dashboard
  page (~36% TTFB drop, reproduced twice); within noise on
  course-scoped pages, most likely because Next.js's own built-in
  per-render `fetch` memoization had already captured part of the
  benefit before this code existed.
- **Query collapse** (`getCourseContent()` in
  `src/lib/domain/queries.ts`): 5 sequential queries → 1 nested
  PostgREST select. Verified byte-for-byte equivalent against the live
  RLS-scoped database, **both roles**, before and after implementation
  — including exact `current_version_id` linkage and per-lecture
  material ordering. Course-content TTFB: ~2650ms → ~1300ms.
- **Sydney region cutover**: a controlled Preview-vs-Preview experiment
  (identical code, one deployment pinned `syd1`, one `iad1`) measured
  median per-call Supabase latency dropping **284ms → 26ms** (~11x),
  and wall time 16-47% lower on every one of 8 pages across two
  repetitions (16/16 runs). Reproduced in real production after
  cutover (25-50% faster than the Virginia control, tracking the
  Sydney Preview's own numbers closely).
- **Staged load test** (`scripts/perf/load-test.mjs`, established
  session, no repeated logins): 1→25 concurrent stay flat and healthy
  (~1000-1700ms, zero errors). 50 concurrent succeeds with **zero
  errors/timeouts/429s** but a real 6-9x latency step (p50 8791ms, p95
  10158ms) — a genuine capacity signal, not a hard failure. Root cause
  not isolated (Supabase pooler capacity is the leading candidate given
  the queue-like latency signature; Vercel Fluid Compute scale-up under
  a sudden burst wasn't ruled out) — flagged as the natural next
  investigation, not guessed at.
- **Two test-harness artifacts caught and fixed before trusting the
  load-test numbers** — worth knowing about if this harness is reused:
  Node's default `fetch` connection pool was too small for the
  50-concurrent stage (produced a false 14.8s "ceiling" that vanished
  entirely with a properly-sized `undici.Agent`), and firing stages
  back-to-back with zero recovery time produced a false 72%-error-rate
  cliff (fixed with a 15s inter-stage cooldown, which separates "can
  this concurrency level work" from "does zero-gap bursting cause
  pileup").

## One incident, disclosed the moment it was found (not after the fact)

During the query-collapse verification, a script authenticated as the
real instructor account (the only "instructor" fixture available —
there is no synthetic instructor account in this project) and called
Supabase's `signOut()` with its **default global scope**, which
revokes every active session for that account, not just the script's
own. If the instructor had an active browser session at the time, it
was likely force-ended server-side (not visible instantly — surfaces
on the session's next token refresh or navigation; a fresh login
resolves it fully, no data was touched). Flagged in chat immediately,
before continuing. **Structurally prevented from recurring**:
`scripts/perf/fixture-safety.mjs`'s `assertSyntheticAccount()` now
refuses any script attempting to sign in as a non-synthetic email, and
`safeSignOut()` hard-codes `{ scope: "local" }` everywhere. See
CLAUDE.md's new "Performance architecture" section — use both in any
future automated script that authenticates.

## What's NOT done / explicitly deferred this pass

- **The specific 50-concurrent bottleneck was not isolated.** Whether
  it's Supabase's connection pooler, Vercel Fluid Compute instance
  scale-up, or something else wasn't distinguished — the load test
  answered "is 50-concurrent healthy" (qualified yes: no errors, but a
  real latency step), not "why exactly does it happen at ~50."
- **A synthetic instructor fixture still doesn't exist.** Documented
  (not created, per instruction) what one would need:
  `dev-instructor@example.test`-style account, added to
  `instructor_allowlist` and given a `course_members(role='instructor')`
  row for CSE 1203 the same way `dev-student` already exists — a real,
  human-reviewed provisioning decision, not something to do
  autonomously.
- **`getLectureContent()` and `getMaterialDetail()`** (in the same file
  as the fixed `getCourseContent()`) still use the old sequential-query
  pattern — same class of problem, smaller scale, not touched this
  pass. Good candidates if either shows up as a bottleneck later.
- **The 3 leftover Preview/control deployments** from the Phase 4
  experiment weren't cleaned up — no concrete reason to, but worth a
  decision at some point.
- **Git push to `origin/main` is unconfirmed** — see "Git state" above.
  Don't assume `origin/main` reflects this session's work without
  checking.
- **No further region tuning attempted** — `syd1` was the one topology
  actually tested and cut over to. The optimization doc's Phase 4 also
  reasoned through (but did not build or test) Singapore-only and
  Singapore+Supabase-migration topologies; current evidence gives no
  reason to think either would beat `syd1` enough to justify the
  effort, especially the Supabase migration option.

## If you pick this up next

1. **Confirm the push landed** (`git log origin/main -1` should show
   `23101d4`) before doing anything else — if it didn't, push first.
2. If you're going to isolate the 50-concurrent bottleneck: check
   Supabase's dashboard for connection-pool metrics/limits first (no
   code needed) before adding more instrumentation — it's the leading
   candidate and might resolve the question directly.
3. Before writing any new automated script that signs in, import
   `assertSyntheticAccount`/`safeSignOut` from
   `scripts/perf/fixture-safety.mjs` — don't re-learn the incident
   above the hard way.
4. Before touching `getCourseContent()`, `course-context-bar.tsx`,
   `src/lib/supabase/course.ts`, or `vercel.json`, read the relevant
   section of `docs/PERFORMANCE_OPTIMIZATION_2026-09-22.md` first —
   each has a specific, measured reason for its current shape.
5. `perf/sydney-preview` branch has been fast-forward merged into
   `main` and can be deleted.
6. Everything in this pass is committed (see "Git state"). Confirm
   with the user before any further production deploys, region
   changes, or database work.
