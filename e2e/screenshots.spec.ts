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
  { name: "place-flushing", hash: "g=chinese&a=r:40.75900,-73.83000,0.4" },
  { name: "thai-tracts", hash: "g=thai&l=tract" },
  { name: "j1-thai-elmhurst", hash: "g=thai&a=n:QN0401&c=thai" },
  { name: "card-himalayan-yak", hash: "g=nepali&a=n:QN0401&c=himalayan&rs=2022" },
  { name: "korean-clusters", hash: "g=korean&c=korean&a=r:40.74770,-73.98690,0.5" },
  { name: "ecuadorian-tag-clusters", hash: "g=ecuadorian&c=ecuadorian" },
  { name: "focus-borough-queens", hash: "g=bangladeshi&a=b:4" },
  { name: "about", hash: "ab=1" },
  { name: "diversity", hash: "ly=div" },
  { name: "asian-clusters", hash: "g=chinese&c=asian" },
  { name: "borough-reference", hash: "g=dominican&r=boro" },
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
  await page.getByRole("button", { name: "Hide panels" }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `docs/screenshots/${milestone}-mobile-collapsed.png` });
});

for (const [name, hash] of [["gaps-korean", "g=korean&c=korean&x=1"], ["gaps-ecuadorian", "g=ecuadorian&c=ecuadorian&x=1"], ["gaps-chinese-strict", "g=chinese&c=chinese&x=1&p=strict"]]) {
  test(`desktop ${name} row focus`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/#${hash}`);
    await settle(page);
    const rows = page.getByRole("region", { name: "Gaps panel" }).locator("tbody tr");
    await rows.first().waitFor();
    await page.screenshot({ path: `docs/screenshots/${milestone}-desktop-${name}.png` });
    await rows.first().click();
    await page.waitForTimeout(1500);
    await settle(page);
    await page.screenshot({ path: `docs/screenshots/${milestone}-desktop-${name}-focus.png` });
  });
}

test("desktop bucket context", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#g=ecuadorian&c=latin_american");
  await settle(page);
  const cl = page.getByRole("region", { name: "Restaurant clusters" });
  await cl.locator("tbody tr").first().click();
  await cl.getByRole("button", { name: "Residential context for this cluster" }).click();
  await page.waitForTimeout(1500);
  await settle(page);
  await page.screenshot({ path: `docs/screenshots/${milestone}-desktop-bucket-context.png` });
});

for (const p of ["strict", "default", "loose"]) {
  test(`desktop preset ${p}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/#g=dominican&c=dominican&p=${p}`);
    await settle(page);
    await page.screenshot({ path: `docs/screenshots/${milestone}-desktop-preset-${p}.png` });
  });
}

test("desktop panels hidden", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#g=chinese&a=n:QN0705&c=chinese");
  await settle(page);
  await page.getByRole("button", { name: "Hide panels" }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `docs/screenshots/${milestone}-desktop-panels-hidden.png` });
});

test("desktop diaspora strips", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#g=korean&a=n:QN0701&c=korean");
  await settle(page);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `docs/screenshots/${milestone}-desktop-diaspora.png` });
  const panel = page.getByRole("complementary", { name: "Area details" });
  await panel.getByRole("region", { name: /Who's here: Language/ }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await panel.screenshot({ path: `docs/screenshots/${milestone}-desktop-diaspora-language.png` });
});

for (const [name, hash] of [["diversity", "ly=div&l=nta"], ["connectors-dominican", "g=dominican&c=dominican"], ["compare", "a=b:2&a2=n:QN0401"], ["worship", "pw=1&a=n:BK1202"]]) {
  test(`desktop m8 ${name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/#${hash}`);
    await settle(page);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `docs/screenshots/${milestone}-desktop-${name}.png` });
  });
}
