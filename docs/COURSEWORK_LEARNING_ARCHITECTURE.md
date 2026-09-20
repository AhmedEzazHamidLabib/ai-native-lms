# Coursework Learning Architecture

Supersedes the runtime-cost posture described in
`docs/AI_TUTOR_CURRENT_STATE.md` (kept as the historical record of what
existed before this milestone). `docs/AI_TUTOR_ARCHITECTURE.md`'s
learning-objective spine, retrieval, evidence, and security sections
remain accurate and are extended here, not replaced.

## ACADEMIC MODEL

Four clean semantics, not necessarily four renamed nav items:

- **LEARN** — Materials, now real presentations (below), not file
  downloads.
- **PRACTICE** — the question bank, reclassified as ungraded,
  evidence-generating interaction, not a document in Materials.
- **ASSESS** — `assessments.kind` (`mock_test | class_test | project`)
  makes "assessment" stop implicitly meaning "graded quiz."
- **PERFORMANCE** — unchanged shape, now also surfaces Course
  Intelligence-informed tutor entry points.

## PRESENTATIONS (Materials)

PPTX → PDF, rendered once via PowerPoint COM automation (already
installed on this machine — no Docker, no LibreOffice, no cloud
conversion API introduced). The PDF is uploaded to the existing
private `course-materials` bucket alongside the original PPTX;
`material_versions.rendered_pdf_path` points at it. The **structured
per-slide text in `slides`** (already extracted, already used for
retrieval) is kept as a completely separate concern — it is what the
tutor reads; the PDF is what the student sees. Neither is derived from
the other at render time.

The presentation viewer tracks a `currentSlideIndex` client-side (PDF
page navigation), and "Ask about this slide" opens/continues a tutor
session with `entrySource: "slide"`, `lectureId`, `slideIndex` — the
orchestrator resolves that to the ONE matching `slides`/`material_chunks`
row and sends only that slide's text, never the whole lecture.

## PRACTICE MODEL

The existing ~100-question bank is reclassified via
`questions.visibility` (`practice | hidden`), default `practice` for
everything that exists today. Practice entry points (Lecture 1,
Lecture 2, Mixed) pull only `visibility = 'practice'` questions,
scoped by `source_lecture_id`. A brand-new `get_practice_question()`
RPC is the only read path — it never returns `is_correct`, mirroring
`get_attempt_view()` exactly, and it **hard-rejects** any question
whose `visibility != 'practice'`, even if called directly with a
hidden question's id. This is the concrete boundary preventing a
future Class Test's hidden pool from leaking through Practice — not a
UI convention, a server-enforced check.

Grading is deterministic SQL (`question_options.is_correct`, joined
inside a SECURITY DEFINER function) — never an LLM call. "Ask AI to
Explain" is a separate, optional step after grading, using the cheap
runtime model (below).

Question-bank practice reuses `practice_attempts` (extended, not
duplicated) with a `source_type` column (`question_bank |
ai_generated`) and a nullable `question_id` — the existing
`get_student_practice_evidence()` aggregate needs no changes to cover
both.

## ASSESSMENT MODEL

`assessments.kind` + `points_possible integer` + `contributes_to_grade
boolean`, replacing the implicit "assessment == graded quiz" model.

- **Mock Test** — the existing, already-attempted assessment,
  reclassified in place (`kind = 'mock_test'`, `contributes_to_grade =
  false`). **Attempts, scores, and history are untouched** — this is a
  column update on the `assessments` row, not a data migration of
  `attempts`.
- **Class Test** — `kind = 'class_test'`, `points_possible = 10`,
  `contributes_to_grade = true`, using the exact same secure
  engine (`start_attempt`/`submit_attempt`/RLS) as Mock Test. Points to
  a **new, separate, empty, locked** question bank — the hidden pool.
  No questions exist in it yet (none were fabricated); an instructor
  populates it later via the existing ingestion script.
- **Project** — `kind = 'project'`, `points_possible = 10`,
  `contributes_to_grade = true`, `bank_id` pointing at a trivial empty
  bank (the existing schema requires `bank_id not null`; a project has
  no questions, so this is a placeholder, never rendered or started
  via the quiz engine). The real content lives in the Projects
  subsystem (below), joined by `assessment_id`.

Grade total for CSE 1203 today: `sum(points_possible) where
contributes_to_grade` = Class Test (10) + Project (10) = **20**. Mock
Test and Practice are excluded by the `contributes_to_grade` flag, not
by a separate code path — one query, one source of truth.

Uncompleted graded work is **not** silently scored zero — `points_possible`
is the denominator only; whether an incomplete counts as zero is a
grading-policy decision explicitly left to the instructor/gradebook
view, not hardcoded into the schema.

## PROFILES

New `profiles` table (`user_id` PK/FK → `auth.users`, `full_name`
nullable, timestamps) — never a second identity system.
`auth.uid()`/`course_members` remain the only authorization inputs;
`full_name` is display data, checked nowhere for access control.
Signup now collects it (required for new accounts); existing accounts
get a lightweight "complete your profile" prompt that never blocks
access to anything already theirs.

## PROJECTS

```
assessments (kind='project', points_possible=10)
  └─ projects (1:1, assessment_id)
       ├─ project_groups (project_id, name)
       │    └─ project_group_members (group_id, user_id, imported_name?)
       ├─ project_deliverables (project_id, title, due_at?, position)
       └─ project_submissions (deliverable_id, group_id, submitted_by_user_id,
                                storage_path, note?, submitted_at, superseded_at?)
```

Membership resolves by `user_id`; `imported_name` exists only as a
staging column for a **future** reconciliation pass (exact + unique +
same-course match against `profiles.full_name`, never fuzzy) — nothing
is imported or auto-linked this milestone. One submission by any
authenticated group member marks the whole group's deliverable
submitted; the group is resolved server-side from `auth.uid()`, never
from a client-supplied group id. Files live in a new private
`project-submissions` bucket, signed URLs only, RLS scoped to
`project_group_members.user_id = auth.uid()` for students and course
instructor role for staff — same shape as the existing
`course-materials` bucket policy.

## COURSE INTELLIGENCE

New table `learning_objective_intelligence`, one row per
`learning_objective_id`: canonical explanation, key facts, common
misconceptions, diagnostic cues, analogies, teaching progression,
practice-generation guidance, source slide references — all compact,
structured JSON/text, not prose essays. Generated **once per material
version** by a **strong model** (`claude-sonnet-5`, the existing
`TutorProvider`'s new `generateCourseIntelligence()` method), via a
standalone script (`scripts/compile-course-intelligence.mjs`), never
from the request path a student triggers.

Versioning: `source_hash` = a hash of that objective's concatenated
`material_chunks` content, `prompt_version`, `model`, `status`
(`ready | stale | missing | generating | failed`), `generated_at`. The
compiler script only regenerates a row when `source_hash` differs from
what's stored — deploying the app, or re-running the script with
nothing changed, does zero model calls. When a material's
`current_version_id` changes (the existing immutable-versioning
invariant), the next compiler run recomputes chunks, sees a new hash
for the affected objectives only, and regenerates just those.

## RUNTIME TUTOR

The conversational model becomes `claude-haiku-4-5-20251001` (cheap
tier) for **every** ordinary tutor turn. Its job shrinks from "invent
pedagogy from raw slides and hold the conversation" to "hold the
conversation using pedagogy it's handed." The strong model
(`claude-sonnet-5`) is called **only** by the offline compiler script —
never inside `runTutorTurn`, never inside a Server Action, never as a
consequence of a student sending a message.

## CONTEXT ROUTING

`runTutorTurn` now branches on `entrySource` to build the **smallest**
context for that situation, instead of one shared shape:

| Entry | Primary context | Raw retrieval used? |
|---|---|---|
| `slide` | that one slide's structured text + its objective's intelligence | only if intelligence missing for that objective |
| `question_bank_practice` (explain) | question + student's answer + correct answer + objective's intelligence | no |
| `performance` | objective's intelligence + assessment/practice evidence (the working "0/2 vs 2/2" cross-reference is preserved) | no |
| `assessment_review` | submitted mistakes + objective's intelligence | only if intelligence missing |
| `direct` (generic) | best-matching objective's intelligence (full-text match against intelligence content first) | fallback only when no intelligence row matches well |

Raw `search_course_material` is never removed — it is the fallback and
the grounding/citation source when precomputed intelligence doesn't
cover what was asked, exactly as before.

## COST MODEL

**One-time, per material version**: N strong-model calls, N = number
of learning objectives actually affected by the change (7 for CSE 1203
today), each a single bounded call over that objective's chunks.

**Per student tutor turn**: 1 cheap-model call. 0 strong-model calls.
Practice-question generation is still folded into that same call via
the existing tool-use pattern.

**Free-text practice evaluation**: at most 1 cheap-model call — already
was Haiku before this milestone; unchanged.

**What still repeats every turn (and is deliberately left as a smaller,
known cost, not eliminated this milestone)**: the compact system
policy + one intelligence block + a short evidence summary + a few
recent messages. This is now hundreds of tokens per objective, not
thousands of tokens of raw slide text re-sent and re-reasoned-over.
Prompt caching for the static policy text is applied where the
provider supports it cleanly (§ implementation notes); it is not a
blocker if unavailable — the model-tier change is the primary lever.

## ASSESSMENT MODEL — SECURITY BOUNDARIES

- `questions.visibility` hard-gates Practice; enforced inside
  `get_practice_question()`, not by which questions the UI happens to
  list.
- Class Test's bank is a **different `question_banks` row** than
  Practice/Mock Test's — there is no shared-bank code path where a
  visibility flag flip alone determines exposure; the pools are
  structurally separate from creation.
- Project submissions: authorization chain re-verified server-side —
  student → `course_members` (enrolled) → `project_group_members`
  (their group) → `project_deliverables.project_id` →
  `projects.assessment_id` → `assessments.course_id` — every hop
  checked, never trusted from client input.
- `learning_objective_intelligence` carries no new authorization
  surface of its own — it's read only via a course-membership-gated
  path (RLS mirroring `learning_objectives`), and it contains no
  answer keys (it's pedagogy about a *topic*, never tied to a specific
  graded question).

## MATERIAL VERSIONING / INVALIDATION

Piggybacks entirely on the existing invariant (`material_versions` is
immutable and versioned; `materials.current_version_id` is the live
pointer). Nothing new is invented: `backfill-material-chunks.mjs`
already reacts to `current_version_id`; `compile-course-intelligence.mjs`
reacts to the resulting chunk content changing (via `source_hash`).
Old material versions, old chunks, and old intelligence rows are never
deleted — only superseded.
