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

test("clicking off the tracts resets the view", async ({ page }) => {
  await openApp(page, "g=thai&a=n:QN0401");
  const panel = page.getByRole("complementary", { name: "Area details" });
  await expect(panel).toBeVisible();
  // centre the map on open water (Upper New York Bay) and click it
  const pt = await page.evaluate(async () => {
    const m = (window as any).__map.map;
    m.stop();
    m.jumpTo({ center: [-74.04, 40.67], zoom: 11 });
    await new Promise((r) => m.once("idle", r));
    const p = m.project([-74.04, 40.67]);
    const r = m.getCanvas().getBoundingClientRect();
    return { x: p.x + r.left, y: p.y + r.top, onTract: m.queryRenderedFeatures(p, { layers: ["tract-fill", "nta-fill"].filter((l: string) => m.getLayer(l)) }).length };
  });
  expect(pt.onTract).toBe(0);
  await page.mouse.click(pt.x, pt.y);
  await expectHash(page, "a", null);
  await expect(panel).toBeHidden();
  await expectHash(page, "g", "thai");
});

test("colloquial names float over clusters and match the cluster table", async ({ page }) => {
  await openApp(page, "g=chinese&c=asian");
  await expect.poll(async () => (await page.evaluate(() => (window as any).__map.shown.clusters.length))).toBeGreaterThan(0);
  const names: string[] = await page.evaluate(() => (window as any).__map.shown.names);
  // every floated name is a gazetteer place label and appears on exactly one row of the cluster table
  const labels: string[] = await page.evaluate(async () =>
    (await (await fetch("data/gazetteer.json")).json()).map((p: any) => p.label ?? p.name.replace(/\s*\(.*\)\s*$/, "")));
  const rows = page.getByRole("region", { name: "Restaurant clusters" }).locator(".cl-name");
  const rowNames = (await rows.allTextContents()).map((t) => t.trim());
  for (const n of names) expect(labels).toContain(n);
  for (const n of rowNames) expect(names).toContain(n);
  expect(new Set(names).size).toBe(names.length);
  await expect(page.locator(".cluster-name")).toHaveCount(names.length);
});
