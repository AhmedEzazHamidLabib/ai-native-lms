# Invariants

Rules the system may never violate, regardless of how features evolve.
When a change would break one of these, that is a stop-and-discuss moment,
not an implementation detail.

1. **The instructor never edits code to run the course.** Units, lectures,
   materials, dates, publication state, and (later) assessments and grades
   are all managed through the application. Adding a lecture is a database
   write, never a deploy.

2. **The database is the canonical academic state.** Grades, deadlines,
   publication state, attempts, and material versions have exactly one
   source of truth: Postgres. The UI projects it; it never invents a
   competing copy.

3. **Student data is private, and the backend proves it.** A student can
   never reach another student's grades, answers, attempts, or submissions.
   This is enforced by Postgres Row Level Security, not by hiding a button.

4. **Academic history is reconstructable.** What a student saw when they
   started an assessment must remain reconstructable even after the
   instructor edits that assessment later. (Applies once assessments exist —
   see `docs/DECISIONS.md` for the mechanism.)

5. **Student work survives ordinary failure.** Assessment answers autosave.
   A refresh, an accidental navigation, or a network blip must not lose
   work. "Saved" is never shown until persistence is acknowledged by the
   server. (Applies once the assessment engine exists.)

6. **Original course materials are immutable and versioned.** Uploading a
   revised Lecture 2 deck creates Version 2; Version 1's source file is
   never deleted or overwritten. The logical Material points at whichever
   version is current.

7. **Extracted content always retains provenance.** A slide's text is
   always traceable through course → unit → lecture → material → material
   version → slide index. Content is never flattened into an anonymous
   blob — this is what makes future AI integration possible without
   re-architecting.

8. **Student and instructor experiences share one academic model.** One
   `Course`, one `Lecture`, one `Material`. The instructor manages it; the
   student sees its authorized, published projection. There is no second,
   parallel content model for students.

9. **AI is optional and absent today.** No LLM calls, no embeddings, no
   vector DB, anywhere in this codebase right now. The data model stays
   structured and provenance-tracked specifically so an AI layer can be
   bolted on later without a rewrite.

10. **The product must feel intentional.** Visual and interaction quality
    are not polish applied at the end — they're part of correctness.
