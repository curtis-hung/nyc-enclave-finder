import { expect, test } from "@playwright/test";
import { expectHash, openApp, pickGroup } from "./helpers";

test("phone: pick a group and collapse the panel", async ({ page }) => {
  await openApp(page);
  await pickGroup(page, "Haitian", /^Haitian/);
  await expectHash(page, "g", "haitian");
  await page.getByRole("button", { name: "Hide panel" }).click();
  await expect(page.locator("#panel-body")).toBeHidden();
  await expect(page.locator(".mini-legend")).toBeVisible();
  await page.getByRole("button", { name: /Haitian/ }).click(); // reopen from the collapsed bar
  await expect(page.locator("#panel-body")).toBeVisible();
});
