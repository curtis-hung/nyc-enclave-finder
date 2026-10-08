import { expect, test } from "@playwright/test";
import { expectHash, openApp } from "./helpers";

const shown = (page: import("@playwright/test").Page) => page.evaluate(() => (window as any).__map.shown);

test.describe("M8 SHOULD / STRETCH features", () => {
  test("borough reference toggle changes the LQ comparison and the URL", async ({ page }) => {
    await openApp(page, "g=chinese");
    const ref = page.getByRole("group", { name: "Compared with" });
    await ref.getByRole("button", { name: "Borough" }).click();
    await expectHash(page, "r", "boro");
    await expect(page.getByLabel("Map legend")).toContainText("borough share");
    await ref.getByRole("button", { name: "NYC" }).click();
    await expectHash(page, "r", null);
    await expect(page.getByLabel("Map legend")).toContainText("citywide share");
  });

  test("connector lines can be toggled", async ({ page }) => {
    await openApp(page, "g=thai&c=thai");
    await expect.poll(async () => (await shown(page)).connectors).toBeGreaterThanOrEqual(0);
    await page.getByLabel("Connectors").uncheck();
    await expectHash(page, "cn", "0");
    await expect.poll(async () => (await shown(page)).connectors).toBe(0);
  });

  test("diversity layer replaces the choropleth", async ({ page }) => {
    await openApp(page);
    await page.getByRole("group", { name: "Map shows" }).getByRole("button", { name: "Diversity" }).click();
    await expectHash(page, "ly", "div");
    await expect(page.getByLabel("Map legend")).toContainText("Diversity index");
    await expect.poll(() => page.evaluate(() => Array.isArray((window as any).__map.map.getPaintProperty("tract-fill", "fill-color")))).toBe(true);
  });

  test("compare mode: pin one area, focus another", async ({ page }) => {
    await openApp(page, "a=n:QN0401");
    const panel = page.getByRole("complementary", { name: "Area details" });
    await panel.getByRole("button", { name: "Pin", exact: true }).click();
    await expectHash(page, "a2", "n:QN0401");
    await page.getByRole("group", { name: "Borough focus" }).getByRole("button", { name: "Bronx" }).click();
    const cmp = panel.getByRole("region", { name: "Comparison" });
    await expect(cmp).toContainText("Compared with Elmhurst");
    await expect(cmp.locator("tbody tr").first()).toBeVisible();
    await cmp.getByRole("button", { name: "Unpin" }).click();
    await expectHash(page, "a2", null);
  });

  test("places of worship layer is labelled and toggles", async ({ page }) => {
    await openApp(page);
    const box = page.getByLabel(/Places of worship/);
    await expect(page.getByText("incomplete, uneven coverage")).toBeVisible();
    await box.check();
    await expectHash(page, "pw", "1");
    await expect.poll(async () => (await shown(page)).worship).toBeGreaterThan(0);
  });
});
