# Production Runbook

Practical operations guide for the live deployment. See
`docs/ARCHITECTURE_HANDOFF.md` for the full architecture;
`docs/PRE_CLASS_CHECKLIST.md` for the 5-minute pre-class check.

## Current production architecture, in one paragraph

Next.js on Vercel (`tiferet/university-lms`), deployed manually via
`vercel --prod` (no GitHub auto-deploy configured). One Supabase
project provides Postgres/Auth/Storage for both local development and
this production deployment — there is no separate staging database.
Environment variables (`NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
`ANTHROPIC_API_KEY`) are configured only for Vercel's "Production"
environment. AI features degrade gracefully if `ANTHROPIC_API_KEY` is
missing or Anthropic is unavailable; everything else (content,
assessments, grades, calendar) has no AI dependency at all.

## Pre-class sanity check

See `docs/PRE_CLASS_CHECKLIST.md` — this runbook is for when
something is actually wrong.

## Basic health verification

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://university-lms-tiferet.vercel.app/login
```

Expect `200`. If not, see "Frontend fails" below.

To check the database independently of the frontend:

```bash
node --env-file=.env.local scripts/run-migrations.mjs
```

This connects directly to Postgres and reports migration state without
touching the app — a clean "Nothing to apply" (or a normal apply of a
genuinely new migration) confirms the database itself is reachable.

## Diagnosing: is this frontend, database, auth, or AI-provider related?

1. **Load `/login` in a browser.** If the page itself doesn't render
   (blank, 500, or Vercel's own error page) → **frontend/deployment
   issue**. Check the Vercel dashboard's deployment logs for this
   project, or run `npx vercel inspect <deployment-url>`.
2. **If `/login` renders but signing in fails for every account** →
   likely **Supabase Auth or database issue**. Check Supabase's own
   status page and project dashboard. A working `run-migrations.mjs`
   connection (above) rules out "database is down" but not "Auth
   service specifically is degraded."
3. **If login/navigation/content/assessments all work but the AI Tutor
   doesn't respond** → **AI-provider issue** (Anthropic outage, rate
   limit, or a misconfigured/expired `ANTHROPIC_API_KEY`). This is the
   most isolated failure mode by design — see below.
4. **If one specific page or action fails but everything else works**
   → almost certainly an application-level bug, not an infrastructure
   issue. Check `vercel logs` for that deployment for a stack trace
   (`src/lib/tutor/log.ts`'s `[tutor]`-prefixed entries specifically
   for anything AI-related).

## What remains usable if the AI provider fails

By design, everything except the AI Tutor and Practice's AI
explanations: course content and presentations, all assessments
(Mock Test, Class Test, Project, the Learning Diagnostic — all
deterministic, zero AI dependency), grades, announcements, calendar,
enrollment, and course creation. The Learning Diagnostic in particular
was explicitly built to require zero AI provider calls for the
academic portion — only its optional "Review with AI" link would be
affected. If AI is down the night before or during class, **teaching
can proceed normally** on everything except live Tutor Q&A.

## Rollback procedure

**Principle: restore CODE, never touch live student data to "roll
back."** A bad deployment is a code problem; roll back the code. A bad
migration is a data-model problem — see the warning below, it is not
solved by redeploying old code.

### To redeploy the known-good frozen commit

```bash
git fetch origin --tags
git checkout v0.1.0-live-pilot   # or: git checkout 637091a
npx vercel --prod --yes
```

This produces a new Vercel deployment (previous deployments are never
deleted — Vercel keeps them) built from the exact known-good source.
Verify with `docs/PRE_CLASS_CHECKLIST.md` afterward.

Return to your working branch afterward if you were mid-development:

```bash
git checkout develop   # or whatever branch you were on
```

### If a bad deployment is live right now and you need the previous one back immediately

```bash
npx vercel ls
```

Find the previous known-good deployment URL from the list, then:

```bash
npx vercel promote <previous-deployment-url>
```

This re-promotes an already-built deployment to production instantly,
without a rebuild — faster than redeploying from source if the
previous deployment is still listed.

### Database safety warnings

- **Never run `db:seed` or `db:dev-users` against production to
  "fix" something** — they're idempotent-safe (`on conflict do
  nothing`) but are not a repair tool and were not designed as one.
- **A bad migration cannot be "rolled back" by redeploying old code** —
  the schema change already happened. If a migration causes a real
  problem, the fix is a new, forward-only migration that corrects it
  (exactly the pattern in `0048` fixing `0046`/`0047`), reviewed with
  the same care as any other schema change — not a hasty `DROP`/`ALTER`
  run by hand.
- **If you suspect data corruption or unexpected data loss**, stop and
  investigate before running anything else — do not attempt a repair
  script under time pressure without understanding exactly what
  happened first. Check Supabase's own point-in-time recovery/backup
  options in the project dashboard (not documented here — this
  project has not needed to use them, so no specific procedure is
  verified; do not assume a specific retention window without checking
  the actual project settings).

## Redeploying without a code change (e.g., after a Vercel-side issue)

```bash
npx vercel --prod --yes
```

Run from the current `main` branch's checked-out state. This rebuilds
and redeploys the exact current source — useful if a transient Vercel
platform issue is suspected rather than an actual code problem.
