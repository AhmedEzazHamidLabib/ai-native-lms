import "server-only";

/**
 * The ONE other place the strong model gets called for Course
 * Intelligence, alongside scripts/compile-course-intelligence.mjs
 * (bulk/CI use). This is the interactive counterpart: a single
 * instructor-triggered rebuild of one objective, invoked from
 * src/lib/domain/intelligence-actions.ts. Same tool schema and
 * malformed-array repair logic as the script, deliberately duplicated
 * rather than shared — the script is a standalone .mjs with no bundler
 * access to src/lib (see its own header comment).
 */

const ANALYSIS_MODEL = "claude-sonnet-5";

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

export interface CourseIntelligenceResult {
  canonicalExplanation: string;
  keyFacts: string[];
  commonMisconceptions: { misconception: string; diagnosticCue: string }[];
  analogies: string[];
  teachingProgression: string[];
  practiceGenerationGuidance: string;
}

function repairArrayField(value: unknown, fieldName: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  if (typeof value !== "string") {
    throw new Error(`Malformed model output: "${fieldName}" was an unexpected type (${typeof value}).`);
  }
  return [...value.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1].trim());
}

function repairMisconceptions(value: unknown): { misconception: string; diagnosticCue: string }[] {
  if (Array.isArray(value)) return value as { misconception: string; diagnosticCue: string }[];
  if (typeof value === "string") return [];
  throw new Error('Malformed model output: "commonMisconceptions" was neither an array nor a string.');
}

function validateIntelligenceShape(input: Record<string, unknown>): CourseIntelligenceResult {
  const canonicalExplanation = input.canonicalExplanation;
  const practiceGenerationGuidance = input.practiceGenerationGuidance;
  if (typeof canonicalExplanation !== "string" || !canonicalExplanation.trim()) {
    throw new Error('Malformed model output: "canonicalExplanation" was missing or empty.');
  }
  if (typeof practiceGenerationGuidance !== "string") {
    throw new Error('Malformed model output: "practiceGenerationGuidance" was not a string.');
  }
  return {
    canonicalExplanation,
    practiceGenerationGuidance,
    keyFacts: repairArrayField(input.keyFacts, "keyFacts") as string[],
    analogies: repairArrayField(input.analogies, "analogies") as string[],
    teachingProgression: repairArrayField(input.teachingProgression, "teachingProgression") as string[],
    commonMisconceptions: repairMisconceptions(input.commonMisconceptions),
  };
}

async function callAnalysisModel(
  objectiveTitle: string,
  objectiveDescription: string,
  sourceMaterial: string,
): Promise<CourseIntelligenceResult> {
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
  const block = (data.content ?? []).find(
    (b: { type: string; name?: string }) => b.type === "tool_use" && b.name === "course_intelligence",
  );
  if (!block) throw new Error("Analysis model did not call course_intelligence as expected.");
  return validateIntelligenceShape(block.input);
}

/** Bounded to 3 attempts — the malformed-array-field quirk is stochastic; a retry with identical input can come back clean. */
export async function analyzeLearningObjective(
  objectiveTitle: string,
  objectiveDescription: string,
  sourceMaterial: string,
  attempts = 3,
): Promise<CourseIntelligenceResult> {
  let lastError: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await callAnalysisModel(objectiveTitle, objectiveDescription, sourceMaterial);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export const COURSE_INTELLIGENCE_MODEL = ANALYSIS_MODEL;
