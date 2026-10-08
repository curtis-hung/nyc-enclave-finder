import { expect, test } from "@playwright/test";
import { expectHash, openApp, pickGroup } from "./helpers";

// J5: diaspora detail (§1.1, §4.6). Checks that strips render where the data qualifies and are
// absent — never shown as zero — where it doesn't. It does not assert what the data shows.

test("J5: diaspora detail", async ({ page }) => {
  await openApp(page);
  // 1. pick Korean: the group profile shows the citywide split by birthplace and language at home
  await pickGroup(page, "Korean", /^Korean/);
  const profile = page.getByRole("region", { name: "Diaspora profile" });
  await expect(profile).toBeVisible();
  await expect(profile).toContainText("Born in the US");
  await expect(profile).not.toContainText("second generation");

  // 2. focus on a neighborhood: strips under listed groups for the surrounding district
  await page.getByLabel("Neighborhood").selectOption({ label: "Elmhurst" });
  await expectHash(page, "a", "n:QN0401");
  const panel = page.getByRole("complementary", { name: "Area details" });
  await expect(panel.locator(".dia-note")).toContainText("surrounding district");
  const strips = panel.locator(".strip-row");
  await expect(strips.first()).toBeVisible();
  // both cases in one view: some listed group rows have a strip, some (thin data) have none
  const groupRows = await panel.locator(".whos-tbl tbody tr:not(.strip-row):not(.fill-row)").count();
  expect(await strips.count()).toBeLessThan(groupRows);
  // hidden never renders as zero
  for (const t of await panel.locator(".diaspora strong").allTextContents()) expect(t).not.toMatch(/^0(\.0)?%$/);
  // detailed languages fill in under a tract-level language bucket, labelled district-level
  await expect(panel.locator(".fill-row").first()).toContainText("district");

  // 3. a Korean restaurant cluster's residential context shows the split for its district
  const rows = page.getByRole("region", { name: "Restaurant clusters" }).locator("tbody tr");
  let shown = false;
  for (let k = 0; k < Math.min(5, await rows.count()) && !shown; k++) {
    await rows.nth(k).click();
    shown = await page.getByRole("region", { name: "Cluster residential context" })
      .waitFor({ timeout: 4000 }).then(() => true).catch(() => false);
  }
  expect(shown).toBe(true);
  const ctx = page.getByRole("region", { name: "Cluster residential context" });
  await expect(ctx).toContainText("This is not evidence of what these restaurants serve.");
  await expect(ctx).toContainText("surrounding district");
});
