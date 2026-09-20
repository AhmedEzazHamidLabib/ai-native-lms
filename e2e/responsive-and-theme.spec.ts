import { test, expect } from "@playwright/test";
import { loadCredentials, loginAs } from "./helpers";

test.describe("Responsive and color-scheme", () => {
  test("mobile viewport: no horizontal scroll, no overlapping account/avatar element", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const creds = await loadCredentials();
    await loginAs(page, "student", creds.student.email, creds.student.password);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    // Next's dev-route indicator must not sit under the sidebar's
    // account block anymore (moved to bottom-right in next.config.ts).
    const devIndicator = page.locator("[data-next-badge-root]");
    if (await devIndicator.count()) {
      const box = await devIndicator.boundingBox();
      expect(box?.x ?? 0).toBeGreaterThan(clientWidth / 2);
    }
  });

  test("prefers-color-scheme: dark still renders a readable light page (deliberately light-only)", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/login");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    // warm-paper #f7f6f2 → rgb(247, 246, 242) — must NOT have flipped to a dark background.
    expect(bg).toBe("rgb(247, 246, 242)");
  });
});
