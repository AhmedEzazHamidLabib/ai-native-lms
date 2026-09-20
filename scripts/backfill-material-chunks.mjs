#!/usr/bin/env node
/**
 * Populates material_chunks from the existing `slides` table — one
 * chunk per slide (the semantic boundary already present in the
 * source), never re-parsing PPTX. Only chunks PUBLISHED
 * lectures/materials, mirroring the exact visibility rule RLS already
 * enforces on `slides` (see docs/AI_TUTOR_ARCHITECTURE.md §3).
 *
 * Re-runnable: deletes and re-inserts per course, same idempotency
 * pattern as the slide extraction itself (docs/DECISIONS.md,
 * "Ingestion execution model").
 *
 * learning_objective_id is a best-effort keyword match against each
 * objective's title/description — a miss leaves it null rather than
 * fabricating a match. This is presentation/filtering convenience
 * only; it is never the sole authorization boundary.
 *
 * Usage: node --env-file=.env.local scripts/backfill-material-chunks.mjs
 */
import pg from "pg";

// Same topic groupings used for the questions.learning_objective_id
// backfill (0013_learning_objectives.sql) — kept here as plain
// keywords (lowercased, word-boundary matched) rather than importing
// SQL, since this runs against slide *text*, not question topics.
const OBJECTIVE_KEYWORDS = {
  "Computer Basics & History": ["history", "computer basics", "personal computer", "pc history", "evolution of comput"],
  "AI & LLM Concepts": ["llm", "large language model", "token", "inference", "training", "context window", "agent", "reliability", "hallucin", "algorithm", "cloud"],
  "Binary, Bits & Bytes": ["binary", "bit", "byte", "encoding", "ascii", "0s and 1s", "0 and 1"],
  "Memory & Storage": ["memory", "storage", "ram", "hard drive", "ssd", "disk"],
  "Computer Hardware": ["cpu", "gpu", "hardware", "component", "power supply", "input device", "output device", "networking", "motherboard"],
  "Operating Systems": ["operating system", " os ", "windows", "macos", "linux"],
  "DOS & Command Line": ["dos", "command line", "cli", "command prompt", "terminal"],
};

function matchObjective(text, objectivesByTitle) {
  const lower = ` ${text.toLowerCase()} `;
  let best = null;
  let bestScore = 0;
  for (const [title, keywords] of Object.entries(OBJECTIVE_KEYWORDS)) {
    const objective = objectivesByTitle.get(title);
    if (!objective) continue;
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = objective.id;
    }
  }
  return best;
}

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error("SUPABASE_DB_URL is not set.");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();

  try {
    const { rows: courses } = await client.query(`select id, code from courses`);

    let totalChunks = 0;
    for (const course of courses) {
      const { rows: objectives } = await client.query(
        `select id, title from learning_objectives where course_id = $1`,
        [course.id],
      );
      const objectivesByTitle = new Map(objectives.map((o) => [o.title, o]));

      const { rows: slideRows } = await client.query(
        `
        select
          s.id as slide_id, s.index as slide_index, s.title as slide_title,
          s.text as slide_text, s.speaker_notes,
          m.id as material_id, m.title as material_title,
          mv.id as material_version_id,
          l.id as lecture_id
        from slides s
        join material_versions mv on mv.id = s.material_version_id
        join materials m on m.id = mv.material_id and m.current_version_id = mv.id
        join lectures l on l.id = m.lecture_id
        join units u on u.id = l.unit_id
        where u.course_id = $1
          and m.published_at is not null
          and l.published_at is not null
        order by l.position, m.position, s.index
        `,
        [course.id],
      );

      if (slideRows.length === 0) {
        console.log(`${course.code}: no published slides to chunk.`);
        continue;
      }

      await client.query("begin");
      try {
        // Re-runnable: clear this course's chunks and rebuild, rather
        // than trying to diff — same call as the slide extraction's
        // own idempotency (delete-then-insert keyed on the parent).
        await client.query(`delete from material_chunks where course_id = $1`, [course.id]);

        let position = 0;
        for (const row of slideRows) {
          const contentParts = [row.slide_title, row.slide_text, row.speaker_notes].filter(Boolean);
          const content = contentParts.join("\n\n").trim();
          if (!content) continue; // nothing retrievable on an empty slide

          const objectiveId = matchObjective(content, objectivesByTitle);

          await client.query(
            `insert into material_chunks
               (course_id, lecture_id, material_id, material_version_id, slide_id,
                learning_objective_id, position, content)
             values ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              course.id, row.lecture_id, row.material_id, row.material_version_id,
              row.slide_id, objectiveId, position++, content,
            ],
          );
          totalChunks++;
        }
        await client.query("commit");
        console.log(`${course.code}: chunked ${position} slides.`);
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    }

    console.log(`Done. ${totalChunks} chunks total.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
