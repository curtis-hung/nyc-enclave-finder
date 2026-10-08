import { expect, test, type Page } from "@playwright/test";
import { expectHash, openApp } from "./helpers";

async function screenPoint(page: Page, lon: number, lat: number) {
  return page.evaluate(([x, y]) => {
    const m = (window as any).__map.map;
    const p = m.project([x, y]);
    const r = m.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, [lon, lat]);
}

test.describe("M7 feedback round 2", () => {
  test("hovering a restaurant dot shows its details", async ({ page }) => {
    await openApp(page, "c=korean");
    // zoom to Koreatown and hover a rendered restaurant point
    await page.evaluate(() => (window as any).__map.map.jumpTo({ center: [-73.9869, 40.7477], zoom: 16 }));
    await page.waitForFunction(() => (window as any).__map.map.queryRenderedFeatures({ layers: ["rest-pt"] }).length > 0);
    const pt = await page.evaluate(() => {
      const m = (window as any).__map.map;
      const c = m.getCanvas();
      const r = c.getBoundingClientRect();
      const mid = { x: r.width / 2, y: r.height / 2 };
      const ps = m.queryRenderedFeatures({ layers: ["rest-pt"] }).map((f: any) => m.project(f.geometry.coordinates));
      ps.sort((a: any, b: any) => Math.hypot(a.x - mid.x, a.y - mid.y) - Math.hypot(b.x - mid.x, b.y - mid.y));
      return { x: r.left + ps[0].x, y: r.top + ps[0].y };
    });
    await page.mouse.move(pt.x, pt.y);
    const tip = page.locator(".tooltip");
    await expect(tip).toContainText("click for details");
    await expect(tip.locator(".tt-name")).not.toHaveText("…");
  });

  test("clicking a tract closes an open restaurant card", async ({ page }) => {
    await openApp(page, "c=root&rs=0&l=tract");
    await expect(page.getByRole("region", { name: "Restaurant", exact: true })).toBeVisible();
    const pt = await screenPoint(page, -73.945, 40.805);
    await page.mouse.click(pt.x, pt.y);
    await expectHash(page, "rs", null);
    await expect(page.getByRole("region", { name: "Restaurant", exact: true })).toBeHidden();
  });

  test("the residential context pane follows the selected cluster", async ({ page }) => {
    await openApp(page, "g=hispanic&c=latin_american");
    const cl = page.getByRole("region", { name: "Restaurant clusters" });
    const rows = cl.locator("tbody tr");
    await rows.nth(0).click();
    await cl.getByRole("button", { name: "Residential context for this cluster" }).click();
    const ctx = page.getByRole("region", { name: "Bucket context" });
    await expect(ctx).toContainText("cluster #1");
    await rows.nth(1).click();
    await expect(ctx).toContainText("cluster #2");
  });
});
