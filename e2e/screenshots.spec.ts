import { test } from "@playwright/test";

// Saves desktop + mobile screenshots to docs/screenshots/ for the visual self-check (§13.7).
const milestone = process.env.MILESTONE ?? "dev";

test("desktop screenshot", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `docs/screenshots/${milestone}-desktop.png` });
});

test("mobile screenshot", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `docs/screenshots/${milestone}-mobile.png` });
});
