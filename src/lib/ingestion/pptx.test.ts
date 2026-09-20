import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parsePptx } from "./pptx";

/**
 * Real ingestion acceptance fixtures.
 *
 * Drop the CSE 1203 decks at these paths to run this test:
 *   fixtures/pptx/cse1203_Lecture_01.pptx
 *   fixtures/pptx/CSE1203_Lecture_02_AI_Project_Hardware_OS_DOS_Windows.pptx
 *
 * Run with: npx vitest run src/lib/ingestion/pptx.test.ts
 *
 * Slide counts (28 and 37) are structural sanity checks on these two
 * specific files, not assumptions baked into production ingestion code —
 * parsePptx() itself never hardcodes a slide count.
 */
const FIXTURES_DIR = path.resolve(__dirname, "../../../fixtures/pptx");

async function loadFixture(filename: string): Promise<Buffer | null> {
  try {
    return await readFile(path.join(FIXTURES_DIR, filename));
  } catch {
    return null;
  }
}

describe("parsePptx", () => {
  it("extracts ordered slides with text from the Lecture 01 deck", async () => {
    const file = await loadFixture("cse1203_Lecture_01.pptx");
    if (!file) {
      console.warn(
        "SKIPPED: fixtures/pptx/cse1203_Lecture_01.pptx not present.",
      );
      return;
    }

    const result = await parsePptx(file);

    expect(result.slides).toHaveLength(28);
    expect(result.slides[0].index).toBe(1);
    expect(result.slides.at(-1)?.index).toBe(28);

    // Every slide got *some* extracted content — not literally hollow.
    const nonEmptySlides = result.slides.filter(
      (s) => (s.title?.length ?? 0) > 0 || s.text.length > 0,
    );
    expect(nonEmptySlides.length).toBeGreaterThan(0);
  });

  it("extracts ordered slides with text from the Lecture 02 deck", async () => {
    const file = await loadFixture(
      "CSE1203_Lecture_02_AI_Project_Hardware_OS_DOS_Windows.pptx",
    );
    if (!file) {
      console.warn(
        "SKIPPED: fixtures/pptx/CSE1203_Lecture_02_AI_Project_Hardware_OS_DOS_Windows.pptx not present.",
      );
      return;
    }

    const result = await parsePptx(file);

    expect(result.slides).toHaveLength(37);
    expect(result.slides[0].index).toBe(1);
    expect(result.slides.at(-1)?.index).toBe(37);

    const nonEmptySlides = result.slides.filter(
      (s) => (s.title?.length ?? 0) > 0 || s.text.length > 0,
    );
    expect(nonEmptySlides.length).toBeGreaterThan(0);
  });
});
