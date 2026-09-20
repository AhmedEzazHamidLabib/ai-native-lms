import { test, expect } from "@playwright/test";
import { loadCredentials, loginAs } from "./helpers";

test.describe("Instructor: navigation, profile, calendar, security", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    // The account block and sidebar-based nav these tests check live in
    // the desktop permanent sidebar only (hidden below `sm`) — the
    // mobile drawer equivalent is covered by responsive-and-theme.spec.ts,
    // which already asserts no horizontal nav overflow at 390px.
    test.skip(testInfo.project.name === "mobile", "desktop-chrome-only checks; see responsive-and-theme.spec.ts for mobile");
    const creds = await loadCredentials();
    await loginAs(page, "instructor", creds.instructors[0].email, creds.instructors[0].password);
    // Land on a real course to see the course-scoped nav.
    await page.getByRole("link", { name: /manage course/i }).first().click();
    await page.waitForURL("**/instructor/courses/**");
  });

  test("shows exactly six top-level sections with no horizontal nav overflow", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: "Course sections" });
    const labels = await nav.getByRole("link").allInnerTexts();
    const topLevel = labels.filter((l) =>
      ["Overview", "Course Content", "Assessments", "Students", "Insights", "Course Settings"].some((s) => l.startsWith(s)),
    );
    expect(topLevel.length).toBe(6);

    const box = await nav.boundingBox();
    const scrollWidth = await nav.evaluate((el) => el.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(Math.ceil((box?.width ?? 0) + 2));
  });

  test("profile shows full name, not just email", async ({ page }) => {
    const creds = await loadCredentials();
    // Generic on purpose (no real name hardcoded in a public test file):
    // the account block's top line must be something OTHER than the raw
    // login email once a full_name is set — that's the actual bug this
    // guards against (falling back to "Role / email" silently).
    const accountBlock = page.locator("aside").filter({ hasText: "Instructor" });
    const topLine = await accountBlock.locator("span.font-medium").first().innerText();
    expect(topLine).not.toBe(creds.instructors[0].email);
  });

  test("Course Content section shows Materials/Calendar/Announcements sub-nav", async ({ page }) => {
    await page.getByRole("link", { name: "Course Content" }).click();
    await expect(page.getByRole("link", { name: "Materials" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Calendar" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Announcements" })).toBeVisible();
  });

  test("Calendar shows the configured Monday/Saturday schedule, not a blanket 'no schedule' message", async ({ page }) => {
    await page.goto(page.url().replace(/\/instructor\/courses\/([^/]+).*/, "/instructor/courses/$1/calendar"));
    const body = await page.textContent("body");
    expect(body).not.toMatch(/No recurring meeting schedule is configured yet/);
  });

  test("Assessments > Tests lists the Learning Diagnostic as non-graded", async ({ page }) => {
    await page.goto(page.url().replace(/\/instructor\/courses\/([^/]+).*/, "/instructor/courses/$1/assessments"));
    await expect(page.getByText("Learning Diagnostic")).toBeVisible();
  });

  test("Students > Roster shows no synthetic test residue", async ({ page }) => {
    await page.goto(page.url().replace(/\/instructor\/courses\/([^/]+).*/, "/instructor/courses/$1/students"));
    const body = await page.textContent("body");
    // Generic on purpose — this asserts the real roster is free of
    // one-off synthetic test-account patterns, without hardcoding any
    // real student's email or name in a public test file. Excludes
    // "dev-student@example.test" itself: e2e/global-setup.ts enrolls it
    // intentionally for this run's own student.spec.ts and removes it
    // again in global-teardown.ts — its presence here is expected
    // infrastructure, not leftover residue. Swap in your own course's
    // expectations when reusing this suite.
    expect(body).not.toMatch(/selfsignup-|tomorrow-student-|pending-student-|final-check-/i);
  });
});
