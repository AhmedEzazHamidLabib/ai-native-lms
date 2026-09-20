import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import { loadCredentials, loginAs } from "./helpers";

/**
 * Real-browser coverage for instructor-initiated course creation
 * (0049_instructor_lifecycle_and_course_creation.sql) and the
 * resulting instructor-name display on the course catalog. Cleans up
 * the throwaway course it creates via the admin client, the same
 * pattern e2e/global-teardown.ts already uses.
 */
test.describe("Instructor: create a course, verify catalog display", () => {
  let createdCourseId: string | null = null;

  test.beforeEach(async ({}, testInfo) => {
    // The sign-out control and "Your courses" account block used mid-test
    // live in the desktop permanent sidebar only — see instructor.spec.ts.
    test.skip(testInfo.project.name === "mobile", "desktop-chrome-only flow");
  });

  test.afterEach(async () => {
    if (!createdCourseId) return;
    process.loadEnvFile(path.resolve(__dirname, "../.env.local"));
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
    await admin.from("course_members").delete().eq("course_id", createdCourseId);
    await admin.from("courses").delete().eq("id", createdCourseId);
    createdCourseId = null;
  });

  test("instructor creates a course, lands on it, and it shows correctly on the catalog with an instructor name", async ({ page }) => {
    test.setTimeout(60_000); // two full sign-in flows + course creation, against the live hosted DB
    const creds = await loadCredentials();
    await loginAs(page, "instructor", creds.instructors[0].email, creds.instructors[0].password);

    const uniqueCode = `TEST E2E ${Date.now()}`;
    await page.getByRole("button", { name: "+ Create course" }).click();
    await page.getByLabel("Course code").fill(uniqueCode);
    await page.getByLabel("Term").fill("TEST Term");
    await page.getByLabel("Course title").fill("TEST E2E Created Course");
    await page.getByRole("button", { name: "Create course" }).click();

    await page.waitForURL("**/instructor/courses/**");
    const url = page.url();
    createdCourseId = url.split("/instructor/courses/")[1]?.split("/")[0] ?? null;
    expect(createdCourseId).toBeTruthy();

    // The new course shows up back on "Your courses" with an instructor name.
    await page.goto("/instructor");
    await expect(page.getByText(uniqueCode)).toBeVisible();
    const card = page.locator("li", { hasText: uniqueCode });
    await expect(card.getByText(/Instructor:/)).toBeVisible();

    // A student browsing Available Courses sees the same course with an
    // instructor name attached, never an email.
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("**/login");
    await loginAs(page, "student", creds.student.email, creds.student.password);
    await page.goto("/student/courses");
    const studentCard = page.locator("li", { hasText: uniqueCode });
    await expect(studentCard.getByText(/Instructor:/)).toBeVisible();
    const cardText = await studentCard.innerText();
    expect(cardText).not.toMatch(/@/);
  });
});
