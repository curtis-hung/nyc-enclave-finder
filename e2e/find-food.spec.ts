import { expect, test } from "@playwright/test";
import { expectHash, openApp } from "./helpers";

// Elmhurst, Queens
test.use({ geolocation: { latitude: 40.7445, longitude: -73.8803 }, permissions: ["geolocation"] });

const panel = (page: import("@playwright/test").Page) => page.getByRole("region", { name: "Find food" });

test.describe("find food (§9.9)", () => {
  test("near me: suggestions within the distance, closest first, location never in the URL", async ({ page }) => {
    await openApp(page, "c=thai");
    await panel(page).getByRole("button", { name: /Find food/ }).click();
    await expectHash(page, "ff", "near");
    const list = panel(page).locator(".find-list li");
    await expect(list.first()).toBeVisible();
    const miles = await panel(page).locator(".find-list li .why .chip:first-child").allTextContents();
    const d = miles.map((t) => (t.startsWith("<") ? 0 : parseFloat(t)));
    expect(d.length).toBeGreaterThan(0);
    expect(d.every((x) => x <= 1)).toBe(true); // default 1 mi
    expect([...d].sort((a, b) => a - b)).toEqual(d); // closest first
    expect(page.url()).not.toMatch(/40\.74|73\.88/); // the user's location stays out of the URL
    // picking a suggestion opens its card
    await list.first().locator(".find-name").click();
    await expect(page.getByRole("complementary", { name: "Restaurant details" })).toBeVisible();
    await expect(page).toHaveURL(/rs=\d+/);
  });

  test("in an enclave: restaurant clusters, then where the community lives", async ({ page }) => {
    await openApp(page, "c=thai&ff=enclave");
    await expect(panel(page).locator(".find-list li").first()).toContainText(/cluster #\d+/);
    await panel(page).getByRole("button", { name: "Where the community lives" }).click();
    await expect(panel(page)).toContainText(/residential enclave/);
    await expect(panel(page).locator(".find-list li").first()).toContainText(/Thai enclave/);
  });

  test("off the beaten path lists places outside every cluster; around here needs an area", async ({ page }) => {
    await openApp(page, "c=thai&ff=outpost");
    await expect(panel(page).locator(".find-list li").first()).toBeVisible();
    await expect(panel(page).locator(".find-list")).not.toContainText(/cluster #/);
    await panel(page).getByRole("button", { name: "Around here" }).click();
    await expect(panel(page)).toContainText("Focus an area first");
    await page.evaluate(() => { location.hash = "c=thai&ff=here&a=n:QN0401"; });
    await expect(panel(page).locator(".find-list li").first()).toBeVisible();
  });
});
