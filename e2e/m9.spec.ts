import { expect, test } from "@playwright/test";
import { expectHash, openApp } from "./helpers";

test.describe("M9 about page and accessibility", () => {
  test("about dialog opens from the panel, carries the required statement and closes", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "About & methods" }).first().click();
    await expectHash(page, "ab", "1");
    const dlg = page.getByRole("dialog", { name: "About NYC Enclave Finder" });
    await expect(dlg).toContainText(
      `"Lives here" means census-measured residence. "Eats here" means restaurant location. Neither proves cultural identity, causality or neighborhood ownership.`,
    );
    for (const h of ["Principles", "Sources and snapshot dates", "Restaurant clusters", "Gap measures", "Presets", "Diaspora detail"])
      await expect(dlg.getByRole("heading", { name: h })).toBeVisible();
    // every source in meta appears with its snapshot date
    await expect(dlg.locator("table").first().locator("tbody tr")).toHaveCount(
      await page.evaluate(async () => Object.keys((await (await fetch("data/meta.json")).json()).sources).length),
    );
    await expect(dlg.getByRole("button", { name: "Close about" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dlg).toBeHidden();
    await expectHash(page, "ab", null);
  });

  test("about dialog is reachable from a shared link", async ({ page }) => {
    await openApp(page, "ab=1");
    await expect(page.getByRole("dialog", { name: "About NYC Enclave Finder" })).toBeVisible();
  });

  test("keyboard focus is visible on controls", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el && el !== document.body ? getComputedStyle(el).outlineStyle : "none";
    });
    expect(outline).not.toBe("none");
  });
});
