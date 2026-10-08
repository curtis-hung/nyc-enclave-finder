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
