# Safe Development Rules (until a staging database exists)

**Read this before doing ANY work on this repository until
`docs/ARCHITECTURE_HANDOFF.md`'s database-isolation section says a
staging Supabase project exists.**

## The one fact that governs everything below

**Local development and the live production deployment currently use
the exact same Supabase project.** There is one `.env.local`, one
database, one set of real students, one real course. There is no
`staging`/`dev` Supabase project. Vercel's "Production" environment
variables point at this same project (confirmed directly — see
`docs/ARCHITECTURE_HANDOFF.md`); Vercel has **no Preview or
Development environment variables configured at all**, so a manual
non-production deploy would have zero database access rather than
touching production — that's a lucky accident of the current setup,
not a designed safeguard, and shouldn't be relied on as one.

Every `npm run db:migrate`, every script under `scripts/*.mjs` run
locally, every `SUPABASE_SECRET_KEY`-using test — all of it talks to
the same database a real class uses tomorrow.

## Safe to do right now, without any special caution

- Documentation and README changes.
- Reading code, planning, architecture discussion.
- UI component work that doesn't call Supabase (pure presentation,
  styling, layout) — verify with `npm run build` and `npx tsc --noEmit`
  before trusting it, but it can't touch the database by construction.
- Adding or editing **unit-level** tests that don't hit a live database
  (this repo doesn't currently have any — every existing test file
  ending in `.integration.test.ts` is live; a plain `.test.ts` file
  using `vitest` without a Supabase client would be genuinely safe, but
  check what you wrote before running it).
- `npx tsc --noEmit`, `npm run lint`, `npm run build` — none of these
  touch a database.
- Writing new migration *files* (don't run them — see below).
- Architecture/roadmap planning against `docs/PRODUCT_AND_ARCHITECTURE_REVIEW.md`.

## Do NOT do these against the current shared database

- **Any migration** (`npm run db:migrate` / `node scripts/run-migrations.mjs`)
  for exploratory or uncertain changes. Every migration in this
  project has been applied directly to the real database backing
  tomorrow's class — that was acceptable this session because each one
  was reviewed carefully first and verified immediately after (see
  `CLAUDE.md`'s migration discipline). Don't repeat that pattern
  casually; a mistake here is a mistake in the live class database.
- **Schema changes of any kind** — `ALTER TABLE`, new tables, new RLS
  policies, new `SECURITY DEFINER` functions — without treating it with
  the same care as this session's own instructor-lifecycle migration:
  read the live function definitions first, reason through NULL
  semantics explicitly, verify against real data before and after.
- **Destructive SQL** — any `DELETE`/`UPDATE`/`DROP` run ad hoc against
  the live database outside of a reviewed, cleaned-up test's own
  `afterAll`. This project's own integration tests do write to the live
  database, but every one of them is scoped to isolated,
  `TEST`-prefixed fixtures it creates and deletes itself — never to
  real course/student rows.
- **Auth changes** — anything that touches `auth.users`,
  `instructor_allowlist`, or the instructor authorization triggers,
  outside of a carefully reasoned, tested change like this session's
  fix. Getting this wrong can lock a real instructor out again, or
  worse.
- **RLS changes** — RLS is the entire security boundary for this
  application (see `docs/ARCHITECTURE_HANDOFF.md`'s invariants). A
  broken policy is a real student-data exposure, not a bug you can
  quietly patch later.
- **Seed or reset commands** (`npm run db:seed`, `db:dev-users`,
  `db:instructor-accounts`) against production — these were designed
  for bootstrapping a fresh project and are `on conflict do nothing`/
  idempotent-safe against existing data, but there is no reason to run
  them again against the live database and every reason not to.
- **Mutations using `SUPABASE_SECRET_KEY`** (the service-role key,
  which bypasses RLS entirely) for anything other than a reviewed
  script whose exact effect you've traced end to end, the way every
  admin script in `scripts/` and every integration test's `afterAll`
  in this repo already does.
- **Experimental ingestion against a real course** — uploading test
  material, running the intelligence-compile script, or backfilling
  chunks against CSE 1203 or CSE 1205 outside of what the instructor
  actually intends for their real class.
- **Bulk data operations** of any kind against real tables.
- **Running the live integration test suite (`npm run test`) or the
  Playwright suite (`npm run test:e2e`) casually the night before
  class.** These are real, valuable, and already proven safe *when run
  carefully* (see `docs/PRODUCTION_RUNBOOK.md`) — every test file uses
  isolated, cleaned-up fixtures — but they do write to and delete from
  the live database as part of that isolation, and a test interrupted
  mid-run (Ctrl+C, a crash) can leave orphaned `TEST%`-prefixed rows
  behind. Don't run the full suite for no reason in the hours before a
  class; if you do run it, let it finish, and verify the app still
  works afterward (`docs/PRE_CLASS_CHECKLIST.md`).

## The practical rule of thumb

If a change can be fully verified with `npx tsc --noEmit` + `npm run
lint` + `npm run build` and never calls `.rpc(`, `.from(`, or
`SUPABASE_SECRET_KEY`, it's safe. If it does any of those things
against the real project, treat it with the same care this session's
instructor-lifecycle fix used: read the live state first, reason
through the change explicitly, verify immediately after, and never do
it as a rushed, last-minute change close to class time.
