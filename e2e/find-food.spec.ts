import { expect, test } from "@playwright/test";
import { expectHash, openApp } from "./helpers";

const panel = (page: import("@playwright/test").Page) => page.getByRole("region", { name: "Find food" });
const chipMiles = async (page: import("@playwright/test").Page) =>
  (await panel(page).locator(".find-list li .why .chip:first-child").allTextContents()).map((t) => (t.startsWith("<") ? 0 : parseFloat(t)));

test.describe("find food with location shared (§9.9)", () => {
  // Elmhurst, Queens
  test.use({ geolocation: { latitude: 40.7445, longitude: -73.8803 }, permissions: ["geolocation"] });

  test("nearby from my location: within the distance, closest first, location never in the URL", async ({ page }) => {
    await openApp(page, "c=thai");
    await panel(page).getByRole("button", { name: /Find food/ }).click();
    await expectHash(page, "ff", "near");
    await panel(page).getByRole("button", { name: "Use my location" }).click();
    await expect(panel(page)).toContainText("Starting from your location");
    const list = panel(page).locator(".find-list li");
    await expect(list.first()).toBeVisible();
    const d = await chipMiles(page);
    expect(d.every((x) => x <= 1)).toBe(true); // default 1 mi
    expect([...d].sort((a, b) => a - b)).toEqual(d); // closest first
    expect(page.url()).not.toMatch(/40\.74|73\.88/); // the user's location stays out of the URL
    await list.first().locator(".find-name").click();
    await expect(page.getByRole("complementary", { name: "Restaurant details" })).toBeVisible();
    await expect(page).toHaveURL(/rs=\d+/);
  });
});

test.describe("find food with location blocked (§9.9)", () => {
  test.use({ permissions: [] });

  test("opening never asks for location; a ZIP code sets the starting point and the radius", async ({ page }) => {
    await openApp(page, "c=korean");
    await panel(page).getByRole("button", { name: /Find food/ }).click();
    await expect(panel(page)).toContainText("Choose a starting point");
    await panel(page).getByRole("button", { name: "Use my location" }).click();
    await expect(panel(page)).toContainText("Location is off or not allowed");
    await panel(page).getByLabel("ZIP code").fill("11354");
    await panel(page).getByRole("button", { name: "Go", exact: true }).click();
    await expect(panel(page)).toContainText("Starting from ZIP 11354");
    await expect(page).toHaveURL(/a=r:40\.7\d+,-73\.8\d+,1(&|$)/);
    await expect(panel(page).locator(".find-list li").first()).toBeVisible();
    await panel(page).getByRole("button", { name: "0.5 mi" }).click();
    await expect(page).toHaveURL(/a=r:[\d.,-]+,0\.5(&|$)/);
    expect((await chipMiles(page)).every((x) => x <= 0.5)).toBe(true);
    await panel(page).getByLabel("ZIP code").fill("99999");
    await panel(page).getByRole("button", { name: "Go", exact: true }).click();
    await expect(panel(page)).toContainText("isn't in the NYC restaurant data");
  });

  test("enclaves and off the beaten path work without any location", async ({ page }) => {
    await openApp(page, "c=thai&ff=enclave");
    await expect(panel(page).locator(".find-list li").first()).toContainText(/cluster #\d+/);
    await panel(page).getByRole("button", { name: "Where the community lives" }).click();
    await expect(panel(page)).toContainText(/residential enclave/);
    await expect(panel(page).locator(".find-list li").first()).toContainText(/Thai enclave/);
    await expect(panel(page)).not.toContainText("Location");
    await panel(page).getByRole("button", { name: "Off the beaten path" }).click();
    await expect(panel(page).locator(".find-list li").first()).toBeVisible();
    await expect(panel(page).locator(".find-list")).not.toContainText(/cluster #/);
  });

  test("in a neighborhood: pick it right inside the panel", async ({ page }) => {
    await openApp(page, "c=thai&ff=here");
    await expect(panel(page)).toContainText("Pick a neighborhood or borough above");
    await panel(page).getByRole("combobox", { name: "Neighborhood" }).selectOption("QN0401");
    await expectHash(page, "a", "n:QN0401");
    await expect(panel(page).locator(".find-list li").first()).toBeVisible();
    await panel(page).getByRole("button", { name: "Queens" }).click();
    await expectHash(page, "a", "b:4");
  });
});
