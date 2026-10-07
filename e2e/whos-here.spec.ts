import { expect, test, type Page } from "@playwright/test";
import { expectHash, openApp } from "./helpers";

/** Click the map at a lon/lat (projected through MapLibre), i.e. a real user click on that place. */
async function clickMapAt(page: Page, lon: number, lat: number) {
  const pt = await page.evaluate(([x, y]) => {
    const m = (window as unknown as { __map: { map: any } }).__map.map;
    const p = m.project([x, y]);
    const r = m.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, [lon, lat]);
  await page.mouse.click(pt.x, pt.y);
}

test.describe("who's here (M4)", () => {
  test("clicking a neighborhood lists several over-represented groups per dimension", async ({ page }) => {
    await openApp(page, "g=thai");
    await page.waitForTimeout(500);
    await clickMapAt(page, -73.8800, 40.7380); // Elmhurst
    await expectHash(page, "a", "n:QN0401");
    const panel = page.getByRole("complementary", { name: "Area details" });
    await expect(panel.getByRole("heading", { level: 2 })).toHaveText("Elmhurst");
    const asian = panel.getByRole("region", { name: /Who's here: Asian groups/ });
    await expect(asian.locator("tbody tr").first()).toBeVisible();
    expect(await asian.locator("tbody tr").count()).toBeGreaterThan(1); // never a single winner
    for (const dim of ["Race", "Hispanic", "Ancestry", "Country of birth", "Language"]) {
      await expect(panel.getByRole("region", { name: new RegExp(`Who's here: ${dim}`) })).toBeVisible();
    }
  });

  test("tract click, breadcrumbs up to NTA and borough", async ({ page }) => {
    await openApp(page);
    await page.waitForTimeout(500);
    await clickMapAt(page, -73.8800, 40.7380);
    await expect.poll(() => new URL(page.url()).hash).toMatch(/a=t:\d{11}/);
    const panel = page.getByRole("complementary", { name: "Area details" });
    await expect(panel).toContainText("Census tract");
    await panel.getByRole("navigation", { name: "Larger areas" }).getByRole("button", { name: "Elmhurst" }).click();
    await expectHash(page, "a", "n:QN0401");
    await panel.getByRole("navigation", { name: "Larger areas" }).getByRole("button", { name: "Queens" }).click();
    await expectHash(page, "a", "b:4");
    await expect(panel.getByRole("heading", { level: 2 })).toHaveText("Queens");
  });

  test("borough buttons and closing", async ({ page }) => {
    await openApp(page);
    await page.getByRole("group", { name: "Boroughs" }).getByRole("button", { name: "Bronx" }).click();
    await expectHash(page, "a", "b:2");
    const panel = page.getByRole("complementary", { name: "Area details" });
    await expect(panel.getByRole("heading", { level: 2 })).toHaveText("Bronx");
    await panel.getByRole("button", { name: "Close who's here" }).click();
    await expectHash(page, "a", null);
    await expect(panel).toBeHidden();
  });

  test("a group link in who's here selects that group", async ({ page }) => {
    await openApp(page, "a=n:QN0401");
    const panel = page.getByRole("complementary", { name: "Area details" });
    await panel.getByRole("region", { name: /Who's here: Asian groups/ }).getByRole("button", { name: "Nepali" }).click();
    await expectHash(page, "g", "nepali");
  });
});
