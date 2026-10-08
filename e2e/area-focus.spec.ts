import { expect, test, type Page } from "@playwright/test";
import { expectHash, hashParams, openApp } from "./helpers";

const masked = (page: Page) => page.evaluate(() => (window as unknown as { __map: { focusState(): { masked: boolean } } }).__map.focusState().masked);
const areaPanel = (page: Page) => page.getByRole("complementary", { name: "Area details" });

async function clickMapAt(page: Page, lon: number, lat: number) {
  const pt = await page.evaluate(([x, y]) => {
    const m = (window as unknown as { __map: { map: any } }).__map.map;
    const p = m.project([x, y]);
    const r = m.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, [lon, lat]);
  await page.mouse.click(pt.x, pt.y);
}

test.describe("area focus (M5)", () => {
  test("neighborhood focus masks the city and shows exact stats", async ({ page }) => {
    await openApp(page, "g=thai");
    expect(await masked(page)).toBe(false);
    await page.getByLabel("Neighborhood").selectOption({ label: "Elmhurst" });
    await expectHash(page, "a", "n:QN0401");
    await expect.poll(() => masked(page)).toBe(true);
    const panel = areaPanel(page);
    await expect(panel.getByRole("heading", { level: 2 })).toHaveText("Elmhurst");
    await expect(panel).toContainText("Exact sums");
    await expect(panel.getByRole("region", { name: "Intersecting enclaves" })).toBeVisible();
    await expect(panel.getByRole("region", { name: /Who's here: Asian groups/ }).locator("tbody tr").first()).toBeVisible();
  });

  test("borough focus updates the stats", async ({ page }) => {
    await openApp(page);
    await page.getByRole("group", { name: "Borough focus" }).getByRole("button", { name: "Queens" }).click();
    await expectHash(page, "a", "b:4");
    await expect.poll(() => masked(page)).toBe(true);
    await expect(areaPanel(page).getByRole("heading", { level: 2 })).toHaveText("Queens");
    await page.getByRole("group", { name: "Borough focus" }).getByRole("button", { name: "Bronx" }).click();
    await expect(areaPanel(page).getByRole("heading", { level: 2 })).toHaveText("Bronx");
  });

  test("radius pin + slider: approximate stats that follow the radius", async ({ page }) => {
    await openApp(page, "g=korean");
    await page.getByRole("button", { name: "Drop a radius pin" }).click();
    await clickMapAt(page, -73.9869, 40.7477);
    await expect.poll(() => hashParams(page).get("a") ?? "").toMatch(/^r:40\.74\d+,-73\.98\d+,0\.5$/);
    await expect.poll(() => masked(page)).toBe(true);
    const panel = areaPanel(page);
    await expect(panel.getByRole("note").filter({ hasText: "Approximate" })).toBeVisible();
    const race = panel.getByRole("region", { name: /Who's here: Race/ });
    await expect(race.locator("tbody tr").first()).toBeVisible();
    const before = await race.locator("details tbody tr").first().locator("td").last().textContent();
    await page.getByLabel(/Radius:/).fill("2");
    await expect.poll(() => hashParams(page).get("a") ?? "").toMatch(/,2$/);
    await expect.poll(async () => race.locator("details tbody tr").first().locator("td").last().textContent()).not.toBe(before);
  });

  test("gazetteer preset sets a radius focus and its suggested group", async ({ page }) => {
    await openApp(page);
    await page.getByLabel("Places", { exact: true }).selectOption({ label: "Flushing (Main St) — Chinese" });
    await expectHash(page, "a", "r:40.75900,-73.83000,0.4");
    await expectHash(page, "g", "chinese");
    await expect(areaPanel(page).getByRole("heading", { level: 2 })).toContainText("Flushing");
    await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
  });

  test("the area panel can be hidden without losing the focus", async ({ page }) => {
    await openApp(page, "g=thai&a=n:QN0401");
    await areaPanel(page).getByRole("button", { name: "Hide area details" }).click();
    await expect(areaPanel(page).getByRole("region", { name: /Who's here: Race/ })).toBeHidden();
    await expectHash(page, "a", "n:QN0401");
    expect(await masked(page)).toBe(true);
    await expect(areaPanel(page)).toContainText("Elmhurst");
    await areaPanel(page).getByRole("button", { name: "Show area details" }).click();
    await expect(areaPanel(page).getByRole("region", { name: /Who's here: Race/ })).toBeVisible();
  });

  test("drill-down shows small multiples for the focused area", async ({ page }) => {
    await openApp(page, "g=thai&a=n:QN0401");
    const drill = areaPanel(page).getByRole("region", { name: "Drill-down" });
    await expect(drill.getByRole("img").first()).toBeVisible();
    expect(await drill.getByRole("img").count()).toBeGreaterThanOrEqual(2);
    await expect(drill.getByRole("img", { name: /^Thai/ })).toBeVisible(); // the selected group comes first
  });

  test("clear focus removes the mask", async ({ page }) => {
    await openApp(page, "a=b:2");
    await expect.poll(() => masked(page)).toBe(true);
    await page.getByRole("button", { name: "Clear focus" }).click();
    await expectHash(page, "a", null);
    await expect.poll(() => masked(page)).toBe(false);
  });
});
