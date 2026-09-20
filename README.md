# Coursework — an AI-native LMS

Coursework is a learning management system built around a different
premise than "LMS plus a chatbot bolted on": the platform understands
the actual material an instructor teaches — uploaded slides, lectures,
learning objectives, assessments, and student performance — and grounds
AI assistance in that specific content, rather than in generic subject
knowledge. The AI Tutor answers from what was actually taught in a
specific course, not from what a general-purpose model happens to know
about the topic.

It's an early-stage product. The status section below is deliberately
blunt about what's real today versus what's aspirational.

## Current status

**Real-world use, not a demo environment.** The system is running a
live section of **CSE 1203 (Introduction to Computing) at Premier
University**, Bangladesh — a real instructor teaching real students
with it this term. That's a validation deployment for one course,
not an institutional rollout: Premier University has not adopted,
procured, or endorsed this platform, and no claim here should be read
that way. It's the first real classroom this is being built against,
which is precisely how the current feature set got prioritized — every
implemented feature exists because an actual teaching workflow needed
it.

The longer-term goal is a platform other instructors and universities
can run, starting in Bangladesh and not architecturally limited to it.

## Why this exists

Most LMS platforms treat "AI" as a tutoring feature added on top of an
otherwise ordinary set of course/gradebook screens: a chat widget that
answers questions about a subject in general, disconnected from what
the class actually covered, whether the student has seen it yet, or
where the student is struggling.

Coursework instead treats the course's own material and the student's
own evidence as the grounding for AI assistance:

- The Tutor retrieves from the instructor's own uploaded slides for the
  current course, not general knowledge about the subject.
- A learning-objective model connects material, assessment questions,
  and practice into one spine, so "how is this student doing on
  Operating Systems" is an aggregation over real submitted work, not a
  vibe.
- Assessment evidence and self-directed practice evidence are tracked
  *separately* and never blended into a single opaque score — a wrong
  practice answer is not a grade.
- AI usage is rate-limited and cost-tiered per student, per course, and
  globally, with an instructor-facing pause switch — not an unmetered
  API pass-through.

## What's implemented today

| Area | Status |
|---|---|
| Course structure (Units → Lectures → Materials, versioned) | Implemented |
| Real PPTX rendering (students see the actual deck, slide by slide) | Implemented |
| PDF and DOCX material rendering | Implemented |
| Content lifecycle: rename/reorder/archive, dependency-blocked hard delete | Implemented |
| Assessments: MCQ + written questions, random/fixed selection, shuffled order | Implemented |
| Assessment kinds: ungraded Mock Test, graded Class Test, Project (separate grading path) | Implemented |
| Hidden vs. Practice question-visibility security boundary | Implemented |
| Manual grading for written responses, gradebook (Project excluded from the assessment gradebook by design) | Implemented |
| Non-graded Learning Diagnostic (practice test drawing only from Practice-visible questions) | Implemented |
| Announcements (plain text, publish/expire/pin) | Implemented |
| Deterministic recurring Calendar (computed from meeting days + term dates, not stored per-session) | Implemented |
| AI Tutor grounded in retrieved course material + a student's own evidence | Implemented |
| "Learn with AI" evidence-based entry point (continue learning / review weak areas) | Implemented |
| Explicit Tutor preferences (4 small enums a student sets — never an inferred personality/learning-style label) | Implemented |
| Course Intelligence: one-time, instructor-triggered compilation of canonical explanations/misconceptions per learning objective | Implemented |
| AI Usage Governor: per-student/per-course/global daily limits, per-request cooldown, pause switches | Implemented |
| Enrollment (auto-enroll or approval queue), roster visibility controls | Implemented |
| Row Level Security as the sole authorization boundary (see *Security model* below) | Implemented |

## In development

- **Vector-based retrieval.** Material retrieval currently uses
  Postgres full-text search (`tsvector`/`ts_rank`) over slide-level
  chunks, not embeddings — a deliberate choice while the model provider
  in use doesn't serve an embeddings endpoint. The schema reserves an
  `embedding vector` column; the retrieval interface is written to be
  swapped without touching call sites.
- **AI-assisted question/assessment authoring.** Instructors currently
  build question banks and assessments by hand (or via a structured
  JSON import). Extracting questions from an uploaded document, or
  AI-proposed assessment assembly with instructor approval, is designed
  for but not built.
- **Broader visual/IA polish.** The instructor experience was recently
  restructured from a flat navigation strip into grouped sections;
  further density/typography passes are ongoing.

## Long-term product direction

Institutional readiness — multi-course/multi-instructor support beyond
a simple instructor+owner model, departments/terms/sections, SIS and
SSO integration, bulk enrollment, richer grading (rubrics, weighted
categories), audit trails, and Bangla localization — is the roadmap,
not the current codebase. See `docs/PRODUCT_AND_ARCHITECTURE_REVIEW.md`
for a detailed, self-critical breakdown of exactly where the current
architecture would need to change to get there.

## Student experience

Course Home, real slide-by-slide presentation viewing (PPTX/PDF/DOCX),
"Ask about this slide" (Tutor grounded in the exact slide being
viewed), per-lecture Practice with instant feedback and an AI
explanation on a wrong answer, "Learn with AI" (evidence-based
recommendations, or an honest "not enough evidence yet" state — never
a fabricated one), a non-graded Learning Diagnostic, assessments,
grades, a personal performance breakdown, announcements, calendar, and
a classmates directory (names only, never emails, and only if the
instructor has enabled it).

## Instructor experience

Six top-level workspaces: **Overview**, **Course Content** (Materials,
Calendar, Announcements), **Assessments** (Tests, Question Bank,
Project), **Students** (Roster, Gradebook), **Insights** (Performance,
AI Tutor/Course Intelligence status, AI usage), and **Course Settings**
(schedule, enrollment, instructors, AI controls). Content management
is dependency-aware — a Unit with lectures, a Lecture with materials,
or a material with extracted content used by the Tutor cannot be
hard-deleted; the system tells the instructor to archive instead and
why.

## Security model

Every table has Row Level Security enabled — the backend proves data
is private, not the UI. Authorization-sensitive operations go through
`SECURITY DEFINER` Postgres functions that **re-derive identity from
the authenticated session on the server** (`auth.uid()`,
`current_course_role()`), never from a client-supplied parameter.
Students have no RLS policy on `questions`/`question_options` at all —
the only path to a question's content is through the attempt view,
which withholds correct answers until submission.

This is enforced by an actual test suite, not just code review: over a
hundred integration tests run against a real, live Supabase project
(no mocks) and assert the authorization boundary directly — a student
cannot read another student's attempt, cannot escalate to instructor
actions by calling an RPC directly, cannot enumerate another course's
roster, and so on.

## Technical architecture

- **Framework**: Next.js 16 (App Router, Turbopack, Server Components
  and Server Actions) on React 19, deployed to Vercel.
- **Database/auth/storage**: Supabase (Postgres + RLS, Supabase Auth,
  Supabase Storage) — a single project backs both the app and the
  ingestion/admin tooling; there is no separate application database.
- **AI provider**: Anthropic's Messages API, called directly (no SDK
  dependency) — Claude Haiku for interactive Tutor turns, Claude Sonnet
  for the one-time-per-objective Course Intelligence compile step.
  Model choice is centralized in `src/lib/tutor/provider.ts`.
- **Material ingestion**: PPTX parsed deterministically from its own
  XML (via `fast-xml-parser`/`jszip`) into structured slides — no OCR,
  no LLM in the ingestion path; DOCX structured extraction via
  `mammoth`; PDF served as the uploaded source file directly.
- **Styling**: Tailwind CSS v4 with a small custom design-token layer
  (typography scale, color palette) on top of the default utility
  scale, plus Fraunces (display) and Geist (UI) via `next/font`.
- **Testing**: Vitest for unit and live integration tests (real
  Supabase project, no mocked database); Playwright for real-browser
  end-to-end tests (desktop + mobile viewports).

## Project structure

```
src/app/            Next.js App Router — instructor/, student/, login/, auth/, api/
src/components/     UI components, grouped by feature area
src/lib/            Domain logic, Supabase clients, AI Tutor, ingestion, tests
supabase/migrations/  The full, ordered schema history (source of truth for the DB)
scripts/            Migration runner, seed data, dev-account provisioning, ingestion CLIs
e2e/                Playwright browser tests
docs/               Architecture decisions, invariants, and the review documents linked above
```

## Local setup

Requires Node.js and a Supabase project (the free tier is sufficient
for development).

```bash
npm install
cp .env.example .env.local   # fill in from your Supabase project's dashboard
npm run db:migrate           # applies supabase/migrations/ in order, safe to re-run
npm run db:seed              # minimal course/unit skeleton
npm run dev
```

`ANTHROPIC_API_KEY` is optional for local development — the app runs
without it; the AI Tutor reports itself as unavailable instead of
failing.

To exercise authenticated flows locally: `npm run db:dev-users`
creates throwaway, email-confirmed student/instructor accounts and
writes their credentials to `scripts/.dev-credentials.json`
(gitignored, never committed).

## Testing

```bash
npm run test          # unit + live integration tests against your Supabase project
npm run test:e2e       # real-browser tests (Playwright) — start `npm run dev` first
npm run lint
npx tsc --noEmit
npm run build          # production build
```

Integration and e2e tests hit a real, live Supabase project — there is
no mocked database in this codebase. They're written to use isolated,
clearly-named throwaway fixtures and clean up after themselves.

## Deployment

Deployed to Vercel from this repository. The same Supabase project
backs both local development and production — there is no separate
staging database. See `docs/DECISIONS.md` for why (and its tradeoffs).

## Documentation

- `docs/INVARIANTS.md` — rules the system is built to never violate
- `docs/ARCHITECTURE.md` — current system shape
- `docs/DECISIONS.md` — meaningful tradeoffs and why
- `docs/IMPLEMENTATION.md` — living status: what's real, what's fixture-backed
- `docs/AI_TUTOR_ARCHITECTURE.md` — the AI Tutor's grounding/retrieval/evidence model in detail
- `docs/COURSEWORK_LEARNING_ARCHITECTURE.md` — the academic domain model
- `docs/PRODUCT_AND_ARCHITECTURE_REVIEW.md` — a critical, self-assessed review of the current system across security, scalability, product, and competitive positioning
- `docs/PITCH_STRATEGY.md` — how this is being positioned to instructors, institutions, and collaborators

## Roadmap

See `docs/PRODUCT_AND_ARCHITECTURE_REVIEW.md` for the detailed,
staged roadmap from the current single-course prototype toward an
institution-ready, internationally viable platform.

## License

Not yet licensed for reuse. All rights reserved pending a decision on
licensing terms.
