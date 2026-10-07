import { expect, test } from "@playwright/test";
import { choroplethState, expectHash, openApp, pickGroup } from "./helpers";

test.describe("group focus (M3)", () => {
  test("picking a group paints the choropleth and updates the URL", async ({ page }) => {
    await openApp(page);
    expect((await choroplethState(page)).painted).toBe(false);
    await pickGroup(page, "Thai", /^Thai/);
    await expectHash(page, "g", "thai");
    await expect(page.getByRole("heading", { level: 2 })).toContainText("Thai");
    await expect(page.getByLabel("Map legend")).toBeVisible();
    await expect.poll(async () => (await choroplethState(page)).painted).toBe(true);
  });

  test("switching group changes the painted values", async ({ page }) => {
    await openApp(page, "g=dominican");
    await expect.poll(async () => (await choroplethState(page)).painted).toBe(true);
    const before = (await choroplethState(page)).colors.join();
    await pickGroup(page, "Korean", /^Korean/);
    await expectHash(page, "g", "korean");
    await expect.poll(async () => (await choroplethState(page)).colors.join()).not.toBe(before);
  });

  test("dimension switcher starts on the default and switches", async ({ page }) => {
    await openApp(page, "g=thai");
    const dims = page.getByRole("group", { name: "Dimension" });
    await expect(dims.getByRole("button", { name: /Asian group/ })).toHaveAttribute("aria-pressed", "true");
    await expect(dims.getByRole("button", { name: /Ancestry/ })).toBeDisabled(); // no data, never dropped
    await dims.getByRole("button", { name: /Birthplace/ }).click();
    await expectHash(page, "d", "birthplace");
    await expect(page.getByRole("heading", { level: 2 })).toContainText("Country of birth");
  });

  test("metric and unit toggles update the URL and the legend", async ({ page }) => {
    await openApp(page, "g=dominican");
    await page.getByRole("group", { name: "Show" }).getByRole("button", { name: "% share" }).click();
    await expectHash(page, "m", "share");
    await expect(page.getByLabel("Map legend")).toContainText("Share of all residents");
    await page.getByRole("group", { name: "Units" }).getByRole("button", { name: "Neighborhoods" }).click();
    await expectHash(page, "l", "nta");
    await expect.poll(async () => (await choroplethState(page)).level).toBe("nta");
  });

  test("sparse groups default to neighborhoods and say so", async ({ page }) => {
    await openApp(page, "g=thai");
    await expect(page.getByRole("note").filter({ hasText: "Too sparse at tract level" })).toBeVisible();
    await expect.poll(async () => (await choroplethState(page)).level).toBe("nta");
  });

  test("data states are distinguishable in the legend", async ({ page }) => {
    await openApp(page, "g=thai");
    const legend = page.getByLabel("Map legend");
    for (const s of ["Caution", "Suppressed", "Zero estimated", "No data"]) await expect(legend).toContainText(s);
  });

  test("proxy groups are labelled", async ({ page }) => {
    await openApp(page, "g=jewish");
    await expect(page.getByRole("note").filter({ hasText: "Proxy measure" })).toBeVisible();
  });

  test("URL state round-trips into the controls", async ({ page }) => {
    await openApp(page, "g=dominican&d=birthplace&m=count&l=nta&p=strict");
    await expect(page.getByRole("group", { name: "Dimension" }).getByRole("button", { name: /Birthplace/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("group", { name: "Show" }).getByRole("button", { name: "Count" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("group", { name: "Units" }).getByRole("button", { name: "Neighborhoods" })).toHaveAttribute("aria-pressed", "true");
    await page.getByText("Advanced").click();
    await expect(page.getByLabel("Analytical preset")).toHaveValue("strict");
  });

  test("enclave list and toggle", async ({ page }) => {
    await openApp(page, "g=dominican");
    const sec = page.getByRole("region", { name: "Residential enclaves" });
    await expect(sec.getByRole("table")).toBeVisible();
    await sec.getByRole("checkbox", { name: "Show" }).uncheck();
    await expectHash(page, "e", "0");
  });
});
