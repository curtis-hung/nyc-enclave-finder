import { expect, test } from "@playwright/test";
import { expectHash, openApp, pickGroup } from "./helpers";

// J4: phone -> share (§1.1). The phone part runs in the mobile project; the "open on desktop"
// part opens the copied URL in a fresh desktop-sized page of the same browser.
test("J4: phone -> share", async ({ page, browser }) => {
  await openApp(page);
  await pickGroup(page, "Jamaican", /^Jamaican/);
  await page.getByRole("group", { name: "Borough focus" }).getByRole("button", { name: "Queens" }).click();
  await expectHash(page, "a", "b:4");
  await page.getByRole("button", { name: "Hide area details" }).click();
  await page.getByRole("button", { name: "Close area" }).isVisible();
  const url = page.url(); // "copy the URL"
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const desk = await ctx.newPage();
  await desk.goto(url); // the copied URL already carries ?basemap=none from openApp
  await desk.waitForFunction(() => !!(window as any).__map?.map.loaded());
  await expect(desk.getByRole("heading", { level: 2 }).first()).toContainText("Jamaican");
  await expect(desk.getByRole("complementary", { name: "Area details" }).getByRole("heading", { level: 2 })).toHaveText("Queens");
  await expect.poll(() => desk.evaluate(() => (window as any).__map.focusState().masked)).toBe(true);
  expect(new URL(desk.url()).hash).toBe(new URL(url).hash);
  await ctx.close();
});
