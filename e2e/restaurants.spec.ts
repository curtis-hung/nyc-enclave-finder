import { expect, test } from "@playwright/test";
import { expectHash, openApp } from "./helpers";

const shownCount = async (page: import("@playwright/test").Page) => {
  const t = (await page.getByRole("region", { name: "Restaurants" }).locator("p").first().textContent()) ?? "";
  return Number((t.match(/^([\d,]+) restaurants/)?.[1] ?? "0").replace(/,/g, ""));
};

test.describe("restaurants and clusters (M6)", () => {
  test("cuisine filter, confidence selector and multi-location toggle drive the map and URL", async ({ page }) => {
    await openApp(page);
    await page.getByLabel("Cuisine").selectOption({ label: "Ecuadorian" });
    await expectHash(page, "c", "ecuadorian");
    await expect.poll(() => shownCount(page)).toBeGreaterThan(0);
    const medium = await shownCount(page);
    await page.getByLabel("Inferred tags").selectOption("high");
    await expectHash(page, "cf", "high");
    await expect.poll(() => shownCount(page)).toBeLessThanOrEqual(medium); // a stricter floor never adds restaurants
    await page.getByLabel("Inferred tags").selectOption("low");
    await expect.poll(() => shownCount(page)).toBeGreaterThanOrEqual(medium);
    await page.getByLabel("Cuisine").selectOption({ label: "Mexican" });
    const before = await shownCount(page);
    await page.getByLabel("Show multi-location businesses").check();
    await expectHash(page, "mc", "1");
    await expect.poll(() => shownCount(page)).toBeGreaterThanOrEqual(before);
  });

  test("selecting a group defaults the cuisine to its paired cuisine and lists its clusters", async ({ page }) => {
    await openApp(page, "");
    await page.getByPlaceholder(/Search groups/).fill("Korean");
    await page.getByRole("option", { name: /^Korean/ }).first().click();
    await expectHash(page, "c", "korean");
    const chips = page.getByRole("group", { name: "Paired cuisines" });
    await expect(chips.getByRole("button", { name: /Korean/ })).toHaveAttribute("aria-pressed", "true");
    const clusters = page.getByRole("region", { name: "Restaurant clusters" });
    await expect(clusters).toContainText("Korean restaurant clusters");
    const rows = clusters.locator("tbody tr");
    if (await rows.count()) {
      await rows.first().click();
      await expect(rows.first()).toHaveClass(/sel/);
    }
  });

  test("tag-based clusters report tag coverage", async ({ page }) => {
    await openApp(page, "c=ecuadorian");
    const clusters = page.getByRole("region", { name: "Restaurant clusters" });
    await expect(clusters).toContainText("Tag-based");
    if (await clusters.locator("tbody tr").count()) await expect(clusters.locator("thead")).toContainText("Tag cov.");
  });

  test("restaurant card shows conflicts collapsed when present", async ({ page }) => {
    await openApp(page, "c=root&rs=0");
    const card = page.getByRole("region", { name: "Restaurant" });
    await expect(card.getByText("DOHMH category")).toBeVisible();
    await card.getByRole("button", { name: "Close restaurant" }).click();
    await expectHash(page, "rs", null);
  });

  test("area panel lists over-represented cuisines", async ({ page }) => {
    await openApp(page, "a=b:4&c=root");
    const panel = page.getByRole("complementary", { name: "Area details" });
    await expect(panel.getByRole("region", { name: "Over-represented cuisines" })).toBeVisible();
  });
});
