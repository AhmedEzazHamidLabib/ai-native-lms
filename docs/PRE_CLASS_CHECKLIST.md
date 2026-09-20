# Pre-Class Checklist

Five minutes, right before class. If anything fails, see
`docs/PRODUCTION_RUNBOOK.md`.

- [ ] **Site loads**: open `https://university-lms-tiferet.vercel.app/login`
      — the login page renders.
- [ ] **Instructor login works**: sign in as the instructor account
      you'll use today. Lands on `/instructor` with your courses
      listed and your name (not just your email) shown in the sidebar.
- [ ] **Student-facing course loads**: from a student account (or the
      instructor viewing `/student/courses`), open CSE 1203 — the
      course page and its navigation render.
- [ ] **Today's material opens**: open the specific lecture/material
      you intend to reference in class and confirm it renders (the
      actual slides/PDF/document, not an error or a blank viewer).
- [ ] **Correct material is published**: if you intend to show or
      assign something new, confirm it shows `Published` (not
      `Draft`) in Course Content — a draft is invisible to students.
- [ ] **Enrollment state looks right**: Students → Roster shows the
      students you expect, no one missing, no unexpected extra rows.
- [ ] **Assessment/practice functionality you need today works**: if
      you're opening a Test or Practice for the class, open it
      yourself first and confirm it starts correctly.
- [ ] **AI Tutor responds, if you intend to demonstrate it**: ask it
      one real question from a student view. If it doesn't respond,
      you can still teach normally — see "What remains usable if the
      AI provider fails" in `docs/PRODUCTION_RUNBOOK.md` — just know
      before class starts, not during.
- [ ] **No obvious outage**: check
      [Vercel's status page](https://www.vercel-status.com) and
      [Supabase's status page](https://status.supabase.com) if
      anything above seemed slow or flaky.

If everything above passes, you're ready.
