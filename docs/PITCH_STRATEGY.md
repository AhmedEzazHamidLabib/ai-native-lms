# Pitch Strategy

Companion to `docs/PRODUCT_AND_ARCHITECTURE_REVIEW.md`. That document
is the honest internal assessment; this document is how to talk about
the same honest assessment to people outside the project, without
overclaiming.

**The governing rule for everything below**: never claim more than
`docs/PRODUCT_AND_ARCHITECTURE_REVIEW.md` supports. If a claim isn't
backed by something real in this repository, don't make it yet — make
the truthful, more modest version instead. The strongest asset this
project has right now is that everything claimed about it is checkable
against real code and real test results; that's rarer than it sounds,
and worth protecting.

---

## The core narrative

**The problem**: most LMS platforms treat AI as a chat widget bolted
onto an otherwise ordinary set of course/gradebook screens — it
answers questions about a subject in general, disconnected from what
the class actually covered, whether the student has already seen it,
or where they're specifically struggling. That's a worse tutor than a
generic AI chat app, not a better one, because it adds LMS friction
without adding grounding.

**Why AI changes what an LMS can be**: an LMS already has the exact
information a genuinely useful tutor would need — the instructor's own
material, what's been assessed, and how each student actually
performed. Almost no platform connects those three things into the
AI's context. This one does: the Tutor retrieves from the instructor's
own published slides for the current course, and separately tracks
assessment evidence and self-directed practice evidence per learning
objective, never blending them into an opaque score. That's the
concrete meaning of "grounded" — not a marketing word, a specific
architectural fact that can be shown, not just asserted (see the demo
below).

**Why grounding in actual course material matters, specifically**:
a generic AI tutor can confidently explain "operating systems" in a
way that contradicts how a specific instructor taught it, uses
terminology the class didn't use, or references material the student
hasn't covered yet. A grounded tutor either answers from what was
actually taught, or says it doesn't have that information — which is
the honest, trustworthy behavior an instructor can actually endorse
recommending to students.

**Why starting inside a real teaching environment is useful**, and
should be said plainly rather than hidden: every feature in this
system exists because a real instructor teaching a real course needed
it, not because of a feature-parity checklist against Canvas or
Moodle. That's a genuine strength worth stating directly — it also
means the feature set is intentionally narrower than an established
platform's today, which should be acknowledged, not hidden (see
"Objections" below).

---

## Audience-specific positioning

### 1. Individual professors

**Lead with**: "your students can ask an AI about the specific slide
they're looking at, and it answers from what you actually taught, not
generic textbook knowledge — and you control how much AI usage costs,
per student, per course, with a pause switch." **Concrete demo
moment**: the Ask-about-this-slide flow. **Don't lead with**: the
roadmap or the institutional story — a working professor cares about
"does this help my class this term," not the five-year plan.

### 2. Department heads

**Lead with**: what this does for the *class's* learning outcomes in
aggregate — an instructor can see which learning objectives a class is
collectively weak on, from real assessment + practice data, not
anecdote. **Concrete demo moment**: the instructor-side Performance/
Insights view after showing the student-side Diagnostic result.
**Be upfront about**: this is currently one validated course, not a
department-wide rollout — the honest pitch here is "let's pilot this
with one more section," not "adopt this across the department."

### 3. University administrators

**Lead with**: cost control and data ownership — a single, auditable
Postgres database with Row Level Security as the actual enforcement
mechanism (not just an app-layer promise), and a governed AI cost
model with hard daily limits, not an unmetered API pass-through that
could produce a surprise bill. **Be upfront about**: the institutional-
administration gaps named directly in
`docs/PRODUCT_AND_ARCHITECTURE_REVIEW.md` Part 2 — no SSO, no
multi-instructor roles, no bulk enrollment yet. An administrator who
asks about these should get the honest "not yet, here's the roadmap"
answer, not a dodge — a dodge is far more damaging to credibility than
an honest gap.

### 4. Bangladeshi private universities

**Lead with**: built and validated in a Bangladeshi classroom first,
not adapted from a Western product afterward — the timezone/scheduling
model already assumes Asia/Dhaka as a real value, not an
afterthought, and the AI cost-governance model is specifically
designed for a price-sensitive deployment. **Be upfront about**: no
Bangla UI yet (ask directly whether their specific student population
needs it before promising it), and mobile/offline resilience is a
named, in-progress gap (`PRODUCT_AND_ARCHITECTURE_REVIEW.md` #10) —
this matters more here than almost any other audience, so don't
undersell the gap.

### 5. Potential technical collaborators

**Lead with**: the actual engineering — RLS as the sole authorization
boundary, 100+ live integration tests against a real database (no
mocks), a documented history of finding and fixing a real
authorization bug across 32 functions and writing a test to prevent
its recurrence. This audience will read the code and the review
document directly; the pitch here is mostly "go read
`docs/PRODUCT_AND_ARCHITECTURE_REVIEW.md` and `CLAUDE.md` yourself" —
technical credibility is best demonstrated by the artifacts, not
asserted in conversation.

### 6. Potential investors/partners

**Lead with**: real usage (one live classroom, real students, real
assessments taken) is the current evidence — say exactly that, not
more. The differentiated architecture (Part 2 of the review) is the
thesis for why this could be more than "another LMS," but the honest
current stage is Stage 0/1 of the roadmap, not a scaled product. **Be
upfront about**: this is pre-revenue, pre-second-institution,
single-founder-adjacent validation. Don't imply traction that doesn't
exist yet — the credible pitch at this stage is "here's a real,
working, differentiated prototype with one genuine classroom
validation, here's the concrete plan to the next milestone," not a
projection.

### 7. Eventually, international institutions

Not yet — see `docs/PRODUCT_AND_ARCHITECTURE_REVIEW.md` Part 3's
explicit list of what's required first (a second independent
deployment, SSO, accessibility conformance, data-residency clarity, a
real privacy policy). Pitching internationally before those exist
risks a well-informed "not ready" response that's harder to walk back
than simply not pitching yet.

---

## What the demo should show (5 minutes, real functionality only)

Every step below is something that actually works in this repository
today — nothing is aspirational.

1. **Instructor view**: open the real Lecture 01 in Course Content —
   show the actual uploaded PPTX rendering slide-by-slide (not a text
   extraction, not a placeholder).
2. **Switch to student view**: open the same lecture — the student
   sees the identical real presentation.
3. **"Ask about this slide"**: on a specific slide, ask a question
   about exactly what's shown. The Tutor answers grounded in that
   slide's actual content — say explicitly, in the room, "it's reading
   from the exact slide you're looking at, not general knowledge about
   the topic," and if possible show the retrieved-material context
   isn't referencing later or draft material.
4. **Practice**: answer a per-lecture practice question incorrectly on
   purpose — show the immediate AI explanation of *why* the answer was
   wrong, grounded the same way.
5. **Learning Diagnostic result**: show a completed Diagnostic's result
   screen — "Practice Test Complete," strongest areas, "worth
   reviewing" areas, and the explicit "this does not affect your
   grade" framing. This demonstrates the evidence-collection loop
   without conflating practice with a real grade.
6. **Close on the instructor's Insights view**: show the aggregate
   performance breakdown — which learning objectives the class is
   collectively strong or weak on, computed from the real evidence just
   generated. This is the "close the loop" moment: material →
   grounded tutoring → practice → evidence → instructor insight, as one
   coherent story, not six disconnected features.

**What to explicitly skip in a 5-minute demo**: Course Settings,
Announcements, Calendar, Project management — all real, all
functional, none of them differentiated enough to spend demo time on
when the AI-grounding story is the actual asset.

---

## What to start measuring now

- **Tutor usage that isn't just curiosity**: sessions per student per
  week, and specifically sessions started from `assessment_review` or
  `performance` entry points (evidence the Tutor is being used to
  address a specific, real gap, not just explored once).
- **Diagnostic completion rate** and the gap between "started" and
  "submitted" — a real signal of whether a non-graded practice
  instrument gets taken seriously without a grade attached.
- **Retention of the instructor**, not just the students — does the
  same instructor choose to use this for a second term/course, which
  is the strongest single piece of evidence this review can name.
- **AI cost per active student per day**, tracked against the existing
  Usage Governor's limits — the data already exists in
  `ai_generation_events`; this just needs to be looked at regularly,
  not built.
- **Time-to-first-value for a new instructor** (from account creation
  to a published course with material) — this is the metric that will
  reveal whether onboarding a cold-start instructor (an open,
  explicitly-named unknown in the review) is actually easy.

## What evidence institutions will want, before this document has it

- A second course, ideally with an instructor who isn't the platform's
  developer, completing at least one full term.
- Some quantitative signal that the AI Tutor changed an outcome
  (higher practice-question accuracy after Tutor use, for example) —
  not required today, genuinely valuable once available, and honest
  instrumentation (above) is the path to having it.
- A written security/privacy answer they can hand to their own
  compliance office — the accessibility and privacy-policy gaps named
  in the review are exactly what this evidence requires closing first.

## Likely objections, and the honest answer to each

- **"This is one course built by one person — how do we know it
  works for other instructors?"** → Honest answer: we don't have that
  evidence yet; that's exactly why the next milestone is a second
  instructor, and here's the roadmap to institutional readiness.
  Don't oversell past this.
- **"What happens if the AI provider has an outage, or changes
  pricing?"** → Honest answer: today, that's a real dependency risk
  (named directly in the review, #15); the mitigation (a
  provider-abstraction layer) is scoped but not yet built. Say so.
- **"Where is our students' data stored, and under what terms?"** →
  Honest answer: on Supabase's infrastructure; the specific region and
  data-processing terms need to be confirmed and documented before
  this question gets a fully satisfying answer — don't guess at
  compliance language that hasn't been verified.
- **"Is this accessible to students with disabilities?"** → Honest
  answer: real, deliberate accessibility work exists (focus states,
  contrast fixes, semantic markup), but no formal audit or VPAT exists
  yet — that's a named, scoped gap, not a "yes."
- **"What stops a student from just asking the AI for the answer on a
  graded test?"** → Honest answer: the Tutor never has access to a
  currently-active, ungraded attempt's correct answers — that's
  enforced at the database level (`get_attempt_view` withholds
  `is_correct` until submission), and it's a real, testable claim, not
  a policy promise. This is a genuinely strong answer — use it
  directly rather than hedging.

## Pilot structure (a concrete, low-risk offer)

A single-course, one-term pilot with a named instructor (not "the
department"), free or nominal cost, with three explicit commitments
from the platform side: (1) a direct support channel to the developer
during the pilot, (2) a mid-term check-in specifically asking whether
the instructor would continue without being asked to, and (3) a
written summary of what worked and what didn't at the end, shared
honestly with the institution regardless of outcome. This mirrors
exactly how the current, real deployment happened — proposing the same
structure to a second institution is credible precisely because it's
not a hypothetical process, it's what already happened once.

## Pricing possibilities — not yet decided, options to hold open

- **Per-institution pilot pricing** (flat, low, time-boxed) rather
  than per-student pricing until the cost-per-student economics are
  actually measured (see "what to start measuring now").
- **AI usage as a pass-through-plus-margin cost** rather than bundled
  flat pricing, at least until there's real data on typical per-student
  AI cost across more than one course.
- Avoid committing to a per-seat institutional price before Stage 3's
  multi-tenancy work exists to actually meter and isolate per-institution
  usage cleanly.

## Institutional procurement realities to plan for, not fight

Procurement cycles at universities are typically slow (months, not
weeks), often require a security/privacy review before a pilot can
even start (which is exactly why #11/#22 in the review are marked
CRITICAL-before-institutional-pitch), and frequently want a reference
from an existing customer before proceeding — which this doesn't have
yet beyond the current course. Plan the roadmap's Stage 2→3 transition
with this lead time in mind rather than expecting a fast institutional
close.

## Claims to avoid until there's evidence

- Any specific learning-outcome improvement number (e.g., "improves
  scores by X%") — not measured yet, don't invent a number.
- "Used by Premier University" or any phrasing implying institutional
  adoption — the accurate claim is a real instructor teaching a real
  section with this platform, which is genuinely strong and doesn't
  need inflating.
- Any accessibility or compliance certification language before the
  actual audit (#11) and policy work (#22) exist.
- "AI-powered personalized learning" as an unqualified claim — say
  specifically what's personalized (evidence-based recommendations,
  explicit stated preferences) and what isn't (no inferred learning
  style, no psychological profiling) — the specificity is more
  credible than the buzzword, and it's also just true to how the
  system is actually built.
