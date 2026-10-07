import { expect, type Page } from "@playwright/test";

/** Open the app without the remote basemap so tests are deterministic and offline-safe. */
export async function openApp(page: Page, hash = "") {
  await page.goto(`/?basemap=none${hash ? `#${hash}` : ""}`);
  await page.waitForFunction(() => {
    const mv = (window as unknown as { __map?: { map: { loaded(): boolean; getLayer(id: string): unknown } } }).__map;
    return !!mv && mv.map.loaded() && !!mv.map.getLayer("tract-fill");
  }, undefined, { timeout: 30_000 });
}

export async function pickGroup(page: Page, query: string, name: RegExp | string) {
  const current = page.getByRole("button", { name: /Change group/ });
  if (await current.isVisible()) await current.click();
  await page.getByPlaceholder(/Search groups/).fill(query);
  await page.getByRole("option", { name }).first().click();
}

/** The choropleth paint for the active level, read from MapLibre (behaviour, not pixels). */
export async function choroplethState(page: Page) {
  return page.evaluate(() => {
    const m = (window as unknown as { __map: { map: any } }).__map.map;
    const vis = (id: string) => m.getLayoutProperty(id, "visibility");
    const level = vis("nta-line") === "visible" ? "nta" : "tract";
    const color = m.getPaintProperty(`${level}-fill`, "fill-color");
    const colors = Array.isArray(color) ? color[1][2][1] : [];
    return { level, colors: colors as string[], painted: Array.isArray(color) };
  });
}

export function hashParams(page: Page) {
  return new URLSearchParams(new URL(page.url()).hash.slice(1));
}

export async function expectHash(page: Page, key: string, value: string | null) {
  await expect.poll(() => hashParams(page).get(key)).toBe(value);
}
