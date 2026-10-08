import { expect, test } from "@playwright/test";
import { expectHash, openApp, pickGroup } from "./helpers";

// User journeys (§1.1). They check that each step works, never what the data shows.

test("J1: group -> neighborhood -> restaurant", async ({ page }) => {
  await openApp(page);
  // 1. pick Thai
  await pickGroup(page, "Thai", /^Thai/);
  await expectHash(page, "g", "thai");
  // 2. where Thai New Yorkers live: choropleth on the default dimension with honest data states
  await expect(page.getByRole("group", { name: "Dimension" }).getByRole("button", { name: /Asian group/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Map legend")).toContainText("Suppressed");
  // 3. focus on Elmhurst; the rest of the city greys out
  await page.getByLabel("Neighborhood").selectOption({ label: "Elmhurst" });
  await expectHash(page, "a", "n:QN0401");
  await expect.poll(() => page.evaluate(() => (window as any).__map.focusState().masked)).toBe(true);
  const panel = page.getByRole("complementary", { name: "Area details" });
  // 4. every over-represented group there
  await expect(panel.getByRole("region", { name: /Who's here: Asian groups/ }).locator("tbody tr").nth(1)).toBeVisible();
  // 5. restaurant list filtered to Thai (primary label or tags)
  await expectHash(page, "c", "thai");
  const list = panel.getByRole("region", { name: "Restaurant list" });
  await expect(list.getByRole("heading")).toContainText("Thai restaurants here");
  const items = list.getByRole("listitem");
  await expect(items.first()).toBeVisible();
  const n = await items.count();
  for (let k = 0; k < Math.min(n, 15); k++) {
    // each row is Thai by its DOHMH label, or carries the "inferred" badge (Thai via a tag)
    await expect(items.nth(k)).toHaveText(/Thai|inferred/);
  }
  // 6. open a card: primary label, tags with confidence and sources, Google Maps link
  await items.first().getByRole("button").click();
  const card = page.getByRole("region", { name: "Restaurant" });
  await expect(card.getByText("DOHMH category")).toBeVisible();
  await expect(card.getByRole("link", { name: /Google Maps/ })).toHaveAttribute("href", /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
  await expect.poll(() => new URL(page.url()).hash).toMatch(/rs=\d+/);
});

const shown = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as any).__map.shown as { enclaves: string[]; clusters: string[]; gap: string[] });

test("J2: commercial vs. residential", async ({ page }) => {
  await openApp(page);
  // 1. jump to the Koreatown preset
  await page.getByLabel("Places").selectOption({ label: "Koreatown (Manhattan) — Korean" });
  await expectHash(page, "g", "korean");
  const panel = page.getByRole("complementary", { name: "Area details" });
  // 2. who's here shows over-represented cuisines AND residential groups
  await expect(panel.getByRole("region", { name: "Over-represented cuisines" })).toBeVisible();
  await expect(panel.getByRole("region", { name: /Who's here: Asian groups/ })).toBeVisible();
  // 3. Korean selected; open the gaps panel: clusters listed with distances to enclaves
  await page.getByRole("button", { name: /Open experiment view/ }).click();
  await expectHash(page, "x", "1");
  const gaps = page.getByRole("region", { name: "Gaps panel" });
  await expect(gaps.getByRole("columnheader", { name: /Nearest enclave/ })).toBeVisible();
  const korean = gaps.locator("tbody tr").filter({ hasText: /^Korean #/ });
  await expect(korean.first()).toBeVisible();
  // 4. clicking a row focuses the cluster together with its nearest enclave
  await korean.first().click();
  await expect.poll(async () => (await shown(page)).gap).toContain("footprint");
  const parts = (await shown(page)).gap;
  const edge = await korean.first().locator("td").nth(3).textContent();
  if (!edge?.includes("no enclave")) expect(parts).toContain("enclave");
});

test("J3: bucket -> leaf, with sensitivity", async ({ page }) => {
  await openApp(page);
  // 1. Latin American: bucket-level clusters
  await pickGroup(page, "Hispanic & Latin", /^Hispanic & Latin American/);
  await expectHash(page, "c", "latin_american");
  const clusters = page.getByRole("region", { name: "Restaurant clusters" });
  await expect(clusters).toContainText("Latin American restaurant clusters");
  await expect(clusters).toContainText("bucket-level");
  // 2. drill into Ecuadorian: tag-based clusters with their tag coverage
  await pickGroup(page, "Ecuadorian", /^Ecuadorian/);
  await expectHash(page, "c", "ecuadorian");
  await expect(clusters).toContainText("Tag-based");
  // 3. open the bucket context panel (Latin American is Ecuadorian's bucket pairing)
  await page.getByRole("group", { name: "Paired cuisines" }).getByRole("button", { name: /Latin American/ }).click();
  await expectHash(page, "c", "latin_american");
  const rows = clusters.locator("tbody tr");
  await rows.first().click();
  await clusters.getByRole("button", { name: "Residential context for this cluster" }).click();
  const ctx = page.getByRole("region", { name: "Bucket context" });
  await expect(ctx).toContainText("Residential context — who lives nearby. This is not evidence of what these restaurants serve.");
  // 4. strict / default / loose: enclaves and clusters change, URL updates
  await page.getByText("Advanced").click();
  const before = await shown(page);
  for (const p of ["strict", "loose", "default"]) {
    await page.getByLabel("Analytical preset").selectOption(p);
    await expect.poll(() => new URL(page.url()).hash.includes(`p=${p}`) || (p === "default" && !new URL(page.url()).hash.includes("p="))).toBe(true);
    await expect.poll(async () => (await shown(page)).clusters.every((id) => id.includes(`.${p}.`))).toBe(true);
    await expect.poll(async () => (await shown(page)).enclaves.every((id) => id.includes(`.${p}.`))).toBe(true);
  }
  const after = await shown(page);
  expect(after.clusters).toEqual(before.clusters); // back on default: same set as before
});
