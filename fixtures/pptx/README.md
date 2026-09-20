# PPTX ingestion fixtures

Real CSE 1203 lecture decks, used as acceptance fixtures for
`src/lib/ingestion/pptx.ts` — not seed data, not embedded into the app.

- `cse1203_Lecture_01.pptx` — 28 slides
- `CSE1203_Lecture_02_AI_Project_Hardware_OS_DOS_Windows.pptx` — 37 slides

Run the acceptance test:

```bash
npx vitest run src/lib/ingestion/pptx.test.ts
```

If these files are missing (e.g. a fresh clone — they're gitignored,
see below), the test skips with a warning instead of failing, so
`npm run test` still passes without them. Drop the two files at the
paths above to actually exercise the real parser.

These are real files from a real course, not synthetic test data — kept
out of git for that reason.
