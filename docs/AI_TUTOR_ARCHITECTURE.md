# AI Tutor Architecture

Learning objectives are the spine connecting materials, assessment
evidence, tutoring, and practice. This document is the decision record
for that spine and everything hung off it. Keep it current as the
system evolves — it is not a one-time proposal.

## 1. Current relevant architecture (what this builds on)

- **Courses → Units → Lectures → Materials → Material Versions →
  Slides** (`0001_core_schema.sql`). `slides` already has one row per
  slide with structured `title`/`text`/`speaker_notes`, extracted
  deterministically from PPTX XML (`src/lib/ingestion/pptx.ts`) — no
  OCR, no re-ingestion needed. This is the raw material corpus.
- **Question bank**: `questions.topic` is a free-text label (30 distinct
  strings across 100 questions in CSE 1203 today — `Binary`, `Bits`,
  `CPU`, `DOS`, etc.), with `questions.source_lecture_id` for
  provenance. This is the existing "topic model" — see §3 for how it
  becomes learning objectives instead of a second taxonomy.
- **Assessments**: sampled/shuffled per attempt by `start_attempt()`,
  graded by `submit_attempt()`, both SECURITY DEFINER. Students have
  **no RLS policy at all** on `questions`/`question_options` — the only
  path to question content is `get_attempt_view()`, which omits
  `is_correct` until `submitted_at is not null`. This is the assessment
  security boundary the tutor must never weaken (§7).
- **Performance**: `get_student_performance`/`get_course_gradebook`/
  `get_course_performance` (`0010_grades_performance.sql`) are
  read-only SECURITY DEFINER functions that aggregate over
  `attempt_questions`/`responses`/`question_options` — no second mutable
  score table. Student evidence for the tutor follows the identical
  pattern (§4).
- **Authorization pattern**: every cross-cutting check is a SECURITY
  DEFINER Postgres function re-deriving `auth.uid()` inside the
  function body (`current_course_role`, `enroll_in_course`,
  `get_attempt_view`, …), never trusted from client input. `is distinct
  from` for nullable role comparisons, never bare `!=` (the `0011` bug).
  The tutor's authorization follows this exact convention — see §8.
- **Client/server split**: `src/lib/supabase/server.ts` (RLS-scoped,
  per-request) for everything user-facing; `src/lib/supabase/admin.ts`
  (service role) reserved for the ingestion pipeline only. Server
  Actions read `FormData` via `useActionState`, never `.bind()`, for
  anything that calls `redirect()` (`docs/DECISIONS.md`).
- **Env conventions**: server-only secrets in `.env.local`, never
  `NEXT_PUBLIC_*`. `ANTHROPIC_API_KEY` is present locally; the tutor is
  the first feature to consume it (§9).

## 2. Learning-objective model

```
courses
  └─ learning_objectives (course_id, title, description, lecture_id?, position)
```

One new table, not a second parallel taxonomy. `questions.topic` (free
text) is normalized into `questions.learning_objective_id` (nullable
FK) via an explicit, reviewable mapping table
(`learning_objective_topic_map`) plus a one-time backfill — the topic
string itself is never deleted, so nothing existing breaks if the
mapping needs revisiting. `lecture_id` on an objective is an *ordering
hint* (which lecture introduces it), not a hard constraint — several
CSE 1203 objectives (AI/LLM concepts, Binary, Storage) are legitimately
taught across both lectures.

Initial CSE 1203 objectives, derived from the real topic distribution,
not invented:

| Objective | Topics folded in | Primary lecture |
|---|---|---|
| Computer Basics & History | History, PC history, Computer basics | Lecture 1 |
| AI & LLM Concepts | LLMs, Tokens, Inference, Training, Context, Agents, AI reliability, Algorithms, Cloud | Lecture 1 |
| Binary, Bits & Bytes | Binary, Bits, Bytes, Encoding | Lecture 1 |
| Memory & Storage | Memory, Storage, RAM | Lecture 2 |
| Computer Hardware | CPU, GPU, Hardware, Components, Power, Input, Input/output, Networking | Lecture 2 |
| Operating Systems | OS | Lecture 2 |
| DOS & Command Line | DOS, CLI | Lecture 2 |

## 3. Course-material retrieval model

`material_chunks`: one row per slide (the existing semantic boundary —
no fixed-character splitting), each carrying full provenance
(`course_id`, `lecture_id`, `material_id`, `material_version_id`,
`slide_id`, `position`) plus a best-effort `learning_objective_id`
(keyword-matched against the objective's topic list, nullable — a miss
just means "no objective filter," never a fabricated one). Populated by
a re-runnable backfill (`scripts/backfill-material-chunks.mjs`) that
only chunks **published** lectures/materials — mirroring the exact
visibility rule already enforced by RLS on `slides` — so retrieval can
never surface draft content a student couldn't otherwise see.

Retrieval is Postgres full-text search (`tsvector`/`ts_rank`), not
embeddings. `ANTHROPIC_API_KEY` gives us a chat model, not an
embeddings endpoint — Anthropic doesn't serve one, and adding a second
provider (OpenAI/Voyage) purely for vectors is exactly the speculative
infrastructure this milestone should avoid. Full-text search is
zero-dependency, fully testable today, and scoped correctly. The
retrieval **interface** (`searchCourseMaterial(courseId, query, opts)`)
is provider-agnostic on purpose: swapping in `pgvector` later (the
`embedding vector` column is reserved but unpopulated) means changing
the function body, not any caller.

## 4. Student-evidence model

No mastery score, no opaque number. Two SECURITY DEFINER functions,
same shape as `get_student_performance`:

- `get_student_objective_evidence(course_id)` — aggregates
  **assessment** evidence per objective straight from
  `attempt_questions`/`responses`/`question_options`/`questions`,
  scoped to `auth.uid()`'s own **submitted** attempts. Nothing is
  duplicated into a mutable table; re-running it after a new submission
  reflects reality automatically.
- `get_student_practice_evidence(course_id)` — aggregates the new
  `practice_attempts` table (§6) the same way.

The UI (and the tutor's context) always shows both numbers side by
side and never merges them — practice evidence is explicitly not an
official grade (§6).

## 5. Tutor orchestration

`src/lib/tutor/orchestrator.ts` is the only thing that talks to the
model. Per turn it assembles four **distinct, labeled** blocks and
sends them as separate, clearly-scoped sections of one request:

1. **SYSTEM/TUTOR POLICY** — static pedagogy instructions (§12) plus
   the trust-boundary rule (§14). Never influenced by retrieved content
   or student input.
2. **RETRIEVED COURSE MATERIAL** — output of `searchCourseMaterial`,
   wrapped and explicitly labeled as *data, not instructions* (§14).
3. **STUDENT EVIDENCE SUMMARY** — the two evidence functions above,
   pre-aggregated server-side, never raw table rows.
4. **BOUNDED SESSION HISTORY + STUDENT MESSAGE** — last N messages from
   `tutor_messages` for *this session, this user* (enforced by RLS +
   an explicit `user_id` check in the query, per the established
   `getMyCourses` lesson about not trusting RLS visibility alone) plus
   the new message.

Identity (`user_id`, `course_id`) is resolved from the authenticated
session on the server, exactly like every existing Server Action —
never accepted as a client-supplied parameter that gates anything.

## 6. Practice-evidence model

`practice_attempts`: `user_id, course_id, learning_objective_id,
tutor_session_id, prompt, expected_answer_kind, student_answer,
correct, evaluation_reason, created_at`. Practice questions are
**generated**, not sampled from the graded question bank (§11) — the
model emits a structured tool call (`propose_practice_question`), not
free text the app has to parse. Evaluation is deterministic when the
expected answer kind allows it (numeric/short-text exact/normalized
match — zero extra model call); only free-text "explain your
reasoning" answers get a second, single-purpose, JSON-only model call
that returns `{correct, reason}` and cannot touch `attempts`/`score`
anywhere in the schema. `practice_attempts` has no FK into the graded
assessment tables at all — structurally incapable of changing a grade.

## 7. Assessment-security boundary

**Chosen policy (conservative, per the brief): while a student has an
active, unsubmitted attempt on an assessment, the tutor cannot be
entered scoped to that assessment at all.** `assessment_review` entry
mode is only offered by the UI — and only accepted by the server
action — when `attempts.submitted_at is not null` for that attempt,
re-checked server-side on every tutor turn (not just at session
creation). General course-concept tutoring (`entry_source = 'direct'`
or `'performance'`) remains available throughout, because it never
touches `questions`/`question_options`/`attempts` for any assessment —
only `material_chunks` and the two evidence functions, which only ever
report already-submitted, already-graded history.

This means the orchestrator never has a code path that can read an
unsubmitted attempt's questions, and the "hide it until submitted"
rule the assessment engine already enforces via RLS is never bypassed
by a service-role or SECURITY DEFINER shortcut anywhere in the tutor.
Verified in §15/security tests: forging `entryContext.attemptId` for
someone else's or an unsubmitted attempt is rejected server-side.

## 8. Authorization / RLS approach

Same convention as the rest of the schema:

- `learning_objectives`: readable by course members (`current_course_role(course_id) is not null`), writable by nobody through RLS (instructor curation is a later milestone — for now, seeded via migration).
- `material_chunks`: readable by course members; only ever populated by the service-role backfill script.
- `tutor_sessions`/`tutor_messages`/`practice_attempts`: owner-only RLS (`user_id = auth.uid()`), **plus** an insert `with check` requiring real `course_members` membership for that `course_id` — so even a forged direct `insert` can't create a session for a course the caller doesn't belong to. Retrieval and evidence are independently re-checked inside their own SECURITY DEFINER functions regardless of what a session row claims, so a forged row is inert even if RLS were somehow bypassed.
- Every RPC re-derives identity from `auth.uid()`; no tutor code path accepts a client-supplied user id or course id as authoritative without re-verifying membership.

## 9. LLM-provider boundary

`src/lib/tutor/provider.ts` exports one function:
`generate(request: TutorGenerateRequest): Promise<TutorGenerateResult>`.
The only implementation today is `AnthropicProvider`, a thin
server-side `fetch` wrapper around the Messages API (no SDK dependency
— one endpoint, full control, nothing to version-pin). `ANTHROPIC_API_KEY`
is read once, server-side, in this one file; it is never sent to the
browser and no client component imports this module (enforced by the
`"server-only"` import used elsewhere in the codebase). Swapping
providers later means writing a second class against the same
interface — retrieval, evidence, practice storage, and the UI do not
change.

## 10. What this milestone intentionally does NOT implement

- Vector/embedding-based retrieval (no embeddings provider configured;
  full-text search is the deliberate v1 — see §3).
- Any mastery score/model beyond "assessment evidence" +
  "practice evidence" shown side by side.
- Instructor-facing tutor analytics or dashboards.
- Multi-turn tool chains, autonomous agents, or the tutor calling any
  endpoint other than the two read-only evidence RPCs and the
  full-text search RPC.
- Rate limiting beyond a simple per-session message cap (§16) —
  no queue, no billing integration.
- Editing/curating learning objectives through the UI — seeded via
  migration for now; an instructor-facing editor is a follow-up.

## 11. Ideas adapted from Eliana-JARVIS's Thinking Mode (inspiration only)

Skimmed `eliana_thinking.py`/`eliana_evaluator.py` for architecture, not
code or prompts. Two ideas genuinely transferred, deliberately scaled
down for a much simpler domain:

- **Structural separation of internal signal from user-facing text.**
  Eliana's Thinking pass returns a JSON "constraint map" with the
  chat-facing `answer` as one field among several internal ones, and
  the streaming extractor is built to only ever surface `answer` —
  internal fields are "structurally unreachable" from the output
  stream, not just hidden by convention. The tutor adopts the same
  shape at a much smaller scale: every turn is one tool call
  (`tutor_turn`) returning `{ reply, teachingMove, practiceQuestion? }`
  — `reply` is the only field ever rendered; `teachingMove` is
  server-side signal only.
- **Every context source gets an explicit semantic role, on purpose.**
  Eliana's evaluator input construction is built specifically so the
  model can't conflate "what a source said" with "what it should do
  about it." This is the direct justification for §5's four
  separately-labeled blocks (SYSTEM POLICY / RETRIEVED MATERIAL /
  STUDENT EVIDENCE / SESSION HISTORY + INPUT) rather than one blended
  prompt string.

Explicitly **not** adopted: Eliana's separate evaluator pass (a second
model call judging the first response), phi/affect state, identity
system, memory consolidation, and streaming architecture. A second
judged-quality call per tutor turn would double cost/latency for a
classroom-scale feature where the brief explicitly asks for one call
per turn; instead, `teachingMove` is returned in the *same* call so the
orchestrator can still detect a stuck pattern (e.g. three consecutive
`explain`s) cheaply, without a second round-trip.
