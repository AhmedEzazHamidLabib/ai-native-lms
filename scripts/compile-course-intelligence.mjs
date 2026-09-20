#!/usr/bin/env node
/**
 * Generates Course Intelligence — persistent pedagogical analysis, one
 * row per learning objective — using a STRONG model, ONCE per material
 * version. This is the only place the strong model is ever called; the
 * runtime tutor (src/lib/tutor/orchestrator.ts) only ever reads what
 * this script writes. See docs/COURSEWORK_LEARNING_ARCHITECTURE.md
 * "COURSE INTELLIGENCE".
 *
 * Self-contained plain script (not importing src/lib/tutor/provider.ts)
 * — same convention as every other scripts/*.mjs here (no bundler/path
 * aliases available outside the Next.js build). The tool schema below
 * intentionally mirrors provider.ts's COURSE_INTELLIGENCE_TOOL; keep
 * them in sync if either changes.
 *
 * Idempotent and cost-aware: computes a source_hash per objective from
 * its material_chunks content and SKIPS regeneration when the hash is
 * unchanged. Pass --force to regenerate regardless.
 *
 * Usage:
 *   node --env-file=.env.local scripts/compile-course-intelligence.mjs [--course=<id>] [--force] [--dry-run]
 */
import { createHash } from "node:crypto";
import pg from "pg";

const ANALYSIS_MODEL = "claude-sonnet-5";

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const DRY_RUN = args.includes("--dry-run");
const courseArg = args.find((a) => a.startsWith("--course="));
const COURSE_FILTER = courseArg ? courseArg.split("=")[1] : null;

const COURSE_INTELLIGENCE_TOOL = {
  name: "course_intelligence",
  description: "Record structured pedagogical analysis of this learning objective for reuse by a cheap runtime tutor.",
  input_schema: {
    type: "object",
    properties: {
      canonicalExplanation: { type: "string" },
      keyFacts: { type: "array", items: { type: "string" } },
      commonMisconceptions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            misconception: { type: "string" },
            diagnosticCue: { type: "string" },
          },
          required: ["misconception", "diagnosticCue"],
        },
      },
      analogies: { type: "array", items: { type: "string" } },
      teachingProgression: { type: "array", items: { type: "string" } },
      practiceGenerationGuidance: { type: "string" },
    },
    required: [
      "canonicalExplanation",
      "keyFacts",
      "commonMisconceptions",
      "analogies",
      "teachingProgression",
      "practiceGenerationGuidance",
    ],
  },
};

async function callAnalysisModel(objectiveTitle, objectiveDescription, sourceMaterial) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");

  const system = [
    "You are a curriculum expert preparing reusable teaching notes for an introductory computing course.",
    "Analyze the given learning objective and its source material ONCE, thoroughly — this analysis will be reused by a lightweight tutor across many students, so it must stand on its own.",
    "Be concrete and specific to the actual source material given, not generic computing trivia.",
    "Always call course_intelligence.",
  ].join(" ");

  const user = [
    `Learning objective: ${objectiveTitle}`,
    `Description: ${objectiveDescription}`,
    "",
    "Source material (from the actual course slides):",
    sourceMaterial || "(no source material available — use the objective title/description only)",
  ].join("\n");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANALYSIS_MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
      tools: [COURSE_INTELLIGENCE_TOOL],
      tool_choice: { type: "tool", name: "course_intelligence" },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Analysis model returned ${response.status}: ${text.slice(0, 300)}`);
  }

  const data = await response.json();
  const block = (data.content ?? []).find((b) => b.type === "tool_use" && b.name === "course_intelligence");
  if (!block) throw new Error("Analysis model did not call course_intelligence as expected.");
  return validateIntelligenceShape(block.input);
}

// Observed in practice (reproducible for at least one objective, not
// token-truncation — stop_reason was "tool_use"): the model
// occasionally renders an array field as a pseudo-XML string
// ("\n<item>...</item>\n<item>...</item>") instead of a real JSON
// array, even though the tool schema requires an array. Repair that
// shape here rather than discarding an otherwise-good response; if
// nothing can be salvaged, fail loudly rather than writing garbage.
function repairArrayField(value, fieldName) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return []; // field omitted — degrade, don't fail
  if (typeof value !== "string") {
    throw new Error(`Malformed model output: "${fieldName}" was an unexpected type (${typeof value}).`);
  }
  const items = [...value.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1].trim());
  return items; // no <item> tags found -> [] rather than failing the whole objective
}

function repairMisconceptions(value) {
  if (Array.isArray(value)) return value;
  // commonMisconceptions is an array of objects — if it came back
  // stringified, there's no reliable structured repair; drop to an
  // empty list rather than fabricate misconception/diagnosticCue pairs.
  if (typeof value === "string") return [];
  throw new Error('Malformed model output: "commonMisconceptions" was neither an array nor a string.');
}

function validateIntelligenceShape(input) {
  const repaired = {
    ...input,
    keyFacts: repairArrayField(input.keyFacts, "keyFacts"),
    analogies: repairArrayField(input.analogies, "analogies"),
    teachingProgression: repairArrayField(input.teachingProgression, "teachingProgression"),
    commonMisconceptions: repairMisconceptions(input.commonMisconceptions),
  };
  if (typeof repaired.canonicalExplanation !== "string" || !repaired.canonicalExplanation.trim()) {
    throw new Error('Malformed model output: "canonicalExplanation" was missing or empty.');
  }
  if (typeof repaired.practiceGenerationGuidance !== "string") {
    throw new Error('Malformed model output: "practiceGenerationGuidance" was not a string.');
  }
  return repaired;
}

// The malformed-array-field quirk above is stochastic — a retried call
// with identical input can come back clean. Bounded to 3 attempts:
// cheap and rare enough that this is not a per-message cost concern,
// just basic reliability for a script that runs occasionally.
async function callAnalysisModelWithRetry(objectiveTitle, objectiveDescription, sourceMaterial, attempts = 3) {
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await callAnalysisModel(objectiveTitle, objectiveDescription, sourceMaterial);
    } catch (err) {
      lastError = err;
      console.log(`  retry ${i}/${attempts} after: ${err.message}`);
    }
  }
  throw lastError;
}

function computeSourceHash(chunkContents) {
  return createHash("sha256").update(chunkContents.join("\n---\n")).digest("hex");
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
    const { rows: objectives } = await client.query(
      `select lo.id, lo.title, lo.description, lo.course_id
       from learning_objectives lo
       ${COURSE_FILTER ? "where lo.course_id = $1" : ""}
       order by lo.course_id, lo.position`,
      COURSE_FILTER ? [COURSE_FILTER] : [],
    );

    let generated = 0;
    let skipped = 0;
    let failed = 0;

    for (const obj of objectives) {
      const { rows: chunkRows } = await client.query(
        `select content from material_chunks where learning_objective_id = $1 order by position`,
        [obj.id],
      );
      const chunkContents = chunkRows.map((r) => r.content);
      const sourceHash = computeSourceHash(chunkContents);

      const { rows: existingRows } = await client.query(
        `select source_hash, status from learning_objective_intelligence where learning_objective_id = $1`,
        [obj.id],
      );
      const existing = existingRows[0];

      if (!FORCE && existing?.status === "ready" && existing.source_hash === sourceHash) {
        console.log(`skip   ${obj.title} (unchanged, hash matches)`);
        skipped++;
        continue;
      }

      if (chunkContents.length === 0) {
        console.log(`skip   ${obj.title} (no source material chunked yet)`);
        skipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`would-generate ${obj.title} (${chunkContents.length} chunks, hash ${sourceHash.slice(0, 8)})`);
        continue;
      }

      console.log(`generate ${obj.title} ...`);
      await client.query(
        `update learning_objective_intelligence set status = 'generating' where learning_objective_id = $1`,
        [obj.id],
      );

      try {
        const result = await callAnalysisModelWithRetry(obj.title, obj.description, chunkContents.join("\n\n---\n\n"));
        await client.query(
          `update learning_objective_intelligence set
             canonical_explanation = $2,
             key_facts = $3,
             common_misconceptions = $4,
             analogies = $5,
             teaching_progression = $6,
             practice_generation_guidance = $7,
             source_hash = $8,
             model = $9,
             status = 'ready',
             error = null,
             generated_at = now(),
             updated_at = now()
           where learning_objective_id = $1`,
          [
            obj.id,
            result.canonicalExplanation ?? "",
            JSON.stringify(result.keyFacts ?? []),
            JSON.stringify(result.commonMisconceptions ?? []),
            JSON.stringify(result.analogies ?? []),
            JSON.stringify(result.teachingProgression ?? []),
            result.practiceGenerationGuidance ?? "",
            sourceHash,
            ANALYSIS_MODEL,
          ],
        );
        console.log(`  ready  ${obj.title}`);
        generated++;
      } catch (err) {
        await client.query(
          `update learning_objective_intelligence set status = 'failed', error = $2, updated_at = now() where learning_objective_id = $1`,
          [obj.id, err.message ?? String(err)],
        );
        console.error(`  FAILED ${obj.title}: ${err.message ?? err}`);
        failed++;
      }
    }

    console.log(
      `\nDone. ${generated} generated, ${skipped} skipped (unchanged/no material), ${failed} failed. Model: ${ANALYSIS_MODEL}.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
