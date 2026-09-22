# Sydney Preview Region Experiment — branch notes

This branch (`perf/sydney-preview`) intentionally contains **no
`vercel.json` or `vercel.ts` changes**, and is otherwise identical to
`main` at the commit it branched from.

## Why no committed region config

Vercel's `regions` setting in `vercel.json`/`vercel.ts` is
**project-wide**: it applies to *every* deployment built from that
file, in any environment. A committed `"regions": ["syd1"]` on this
branch would also pin a *production* deployment to Sydney if this
branch were ever deployed with `--prod` (accidentally or otherwise) —
which is exactly the cross-environment leakage
`docs/PERFORMANCE_OPTIMIZATION_2026-09-22.md`'s Phase 4 experiment is
required to avoid.

Instead, the region pin is applied **only as a `vercel deploy` CLI flag**
(`--regions syd1`), which the Vercel CLI's own `--help` describes as
"Set default regions to enable the deployment on" — scoped to that one
deployment invocation, never persisted to the project's `vercel.json`,
dashboard settings, or any other deployment (including Production).

## What was actually run

See `docs/PERFORMANCE_OPTIMIZATION_2026-09-22.md`'s Phase 4 experiment
section for the exact command, verification steps, and results. In
short:

```
vercel deploy --regions syd1 -e NEXT_PUBLIC_SUPABASE_URL=... -e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
```

(no `--prod`, so this targets the Preview environment) — with the two
env vars supplied **only as deployment-scoped runtime overrides** (the
`-e` flag), not added to the project's persisted "Preview" environment
scope in the Vercel dashboard, and using the same non-secret
`NEXT_PUBLIC_*` values already configured for Production (never
rotated, never regenerated).

## Do not merge this branch into `main` without explicit review

This branch exists only to produce an isolated, traceable Preview
deployment for a one-off measurement. It carries no functional code
changes over `main`. Merging it is not itself risky (this project's
production deploys are manual `vercel --prod` runs, never triggered by
a git merge or push — see `docs/ARCHITECTURE_HANDOFF.md` §14) but was
explicitly left for the repository owner to decide, per the standing
instruction not to merge autonomously.
