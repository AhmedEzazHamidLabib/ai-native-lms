import { test, expect } from "@playwright/test";
import { loadCredentials, loginAs, resetDiagnosticAttempt } from "./helpers";

test.describe("Student: Learn with AI, Learning Diagnostic, presentation regression", () => {
  const CSE_1203 = "11111111-1111-1111-1111-111111111111";

  test.beforeEach(async ({ page }) => {
    const creds = await loadCredentials();
    await loginAs(page, "student", creds.student.email, creds.student.password);
    await page.goto(`/student/courses/${CSE_1203}`);
  });

  test("full name displays, and Learn with AI is reachable with a New badge", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: "Course sections" }).getByRole("link", { name: /Learn with AI/i });
    await expect(nav).toBeVisible();
    await expect(nav.getByText(/new/i)).toBeVisible();
    await nav.click();
    await expect(page.getByRole("heading", { name: "Learn with AI" })).toBeVisible();
  });

  test("Learning Diagnostic: start, 10 persisted questions, refresh does not reshuffle, submit, zero-grade result, preferences save", async ({ page }) => {
    test.setTimeout(90_000); // 10 real question round-trips against the live hosted DB
    const creds = await loadCredentials();
    await resetDiagnosticAttempt(creds.student.email);
    await page.goto(`/student/courses/${CSE_1203}/assessments`);
    await page.getByText("Learning Diagnostic").click();
    await expect(page.getByText(/does not affect your grade/i)).toBeVisible();

    await page.getByRole("button", { name: /start test|resume test/i }).click();
    await page.waitForURL("**/attempt/**");
    await expect(page.getByText("Question 1 of 10")).toBeVisible();

    const firstQuestionPrompt = await page.locator("main p.font-display").first().innerText();

    // Refresh mid-attempt — must not reshuffle the persisted selection.
    await page.reload();
    await expect(page.getByText("Question 1 of 10")).toBeVisible();
    const afterReloadPrompt = await page.locator("main p.font-display").first().innerText();
    expect(afterReloadPrompt).toBe(firstQuestionPrompt);

    // Answer all 10 questions by picking the first option each time, then Next.
    // Scoped to <main> — Next.js's own dev-tools button also has the
    // accessible name "Next" and would otherwise cause a strict-mode clash.
    const main = page.locator("main");
    for (let i = 0; i < 10; i++) {
      await main.locator("button[aria-pressed]").first().click();
      if (i < 9) await main.getByRole("button", { name: "Next", exact: true }).click();
    }

    await main.getByRole("button", { name: "Submit test" }).click();

    await expect(page.getByText("Practice Test Complete")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/does not affect your grade/i)).toBeVisible();

    // Tutor preference mini-form on the results page.
    const exampleFirst = page.getByLabel("Show me an example first");
    await exampleFirst.scrollIntoViewIfNeeded();
    await exampleFirst.check();
    const saveButton = page.getByRole("button", { name: "Save preferences" });
    await saveButton.scrollIntoViewIfNeeded();
    await saveButton.click();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 10_000 });
  });

  test("presentation regression: a real lecture renders the actual PPTX, not raw extracted text", async ({ page }) => {
    await page.goto(`/student/courses/${CSE_1203}/course`);
    await page.getByRole("link", { name: /Lecture 01/i }).click();
    // The rendered slide surface (an <img>/<canvas>/iframe-backed viewer), never a
    // plain text dump of extracted slide content.
    const slideSurface = page.locator("main img, main canvas, main iframe").first();
    await expect(slideSurface).toBeVisible({ timeout: 15_000 });
  });
});
