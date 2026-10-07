import { test, type Page } from "@playwright/test";

// Visual self-check (§13.7): desktop + mobile screenshots per milestone into docs/screenshots/.
// Uses the real basemap. Run: MILESTONE=m3 npx playwright test --project=screenshots
const milestone = process.env.MILESTONE ?? "dev";

const SHOTS: { name: string; hash: string }[] = [
  { name: "thai", hash: "g=thai" },
  { name: "dominican", hash: "g=dominican" },
  { name: "whos-here-tract", hash: "g=dominican&a=t:36061026900" },
  { name: "focus-nta-elmhurst", hash: "g=thai&a=n:QN0401" },
  { name: "focus-radius-koreatown", hash: "g=korean&a=r:40.74770,-73.98690,0.5" },
  { name: "focus-borough-queens", hash: "g=bangladeshi&a=b:4" },
];

async function settle(page: Page) {
  await page.waitForFunction(() => {
    const mv = (window as unknown as { __map?: { map: { loaded(): boolean; areTilesLoaded(): boolean } } }).__map;
    return !!mv && mv.map.loaded() && mv.map.areTilesLoaded();
  }, undefined, { timeout: 45_000 });
  await page.waitForTimeout(1200);
}

for (const s of SHOTS) {
  test(`desktop ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/#${s.hash}`);
    await settle(page);
    await page.screenshot({ path: `docs/screenshots/${milestone}-desktop-${s.name}.png` });
  });

  test(`mobile ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/#${s.hash}`);
    await settle(page);
    await page.screenshot({ path: `docs/screenshots/${milestone}-mobile-${s.name}.png` });
  });
}

test("desktop drill-down panel", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#g=thai&a=n:QN0401");
  await settle(page);
  const drill = page.getByRole("region", { name: "Drill-down" });
  await drill.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await drill.screenshot({ path: `docs/screenshots/${milestone}-desktop-drilldown.png` });
});

test("mobile panel collapsed", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#g=dominican&a=b:2");
  await settle(page);
  await page.getByRole("button", { name: "Close area" }).click();
  await page.getByRole("button", { name: "Hide panel" }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `docs/screenshots/${milestone}-mobile-collapsed.png` });
});
