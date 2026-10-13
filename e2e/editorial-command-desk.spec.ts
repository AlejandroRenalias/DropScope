import { expect, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { officeHistories } from "../src/frontend/office-projection.js";
import { researchLayoutHistory } from "./fixtures/research-layout.js";

let viteServer: ViteDevServer;

test.beforeAll(async () => {
  viteServer = await createServer({ server: { host: "127.0.0.1", port: 5177 } });
  await viteServer.listen();
});

test.afterAll(async () => {
  await viteServer.close();
});

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.addStyleTag({ content: ".topbar { position: static !important; }" });
});

test("guides the first local mission and recovers from an offline runtime", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Mission controls" }).click();
  const setup = page.getByRole("region", { name: "First mission setup" });
  await expect(setup).toContainText("Record a mission before you inspect it.");
  await expect(setup).toContainText("Choose fixture");
  await expect(setup).toContainText("Launch locally");
  await expect(setup).toContainText("Inspect evidence");
  await expect(setup).toContainText("Read decision");
  await expect(setup).toHaveScreenshot("first-mission-setup.png", { animations: "disabled" });

  await page.getByRole("button", { name: "Launch local mission" }).click();
  const status = page.getByRole("status");
  await expect(status).toContainText("Local runtime needs attention");
  await expect(status).toContainText("Local runtime is unavailable. Start it with npm run runtime:dev.");
  await expect(page.locator(".runtime-context")).toContainText("The synthetic demo remains available");
  await expect(page.locator(".runtime-context details")).not.toHaveAttribute("open", "");
  await expect(setup).toBeVisible();
});

test("captures the six editorial command desk surfaces", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page).toHaveScreenshot("clean-research-page.png", { animations: "disabled", fullPage: true });

  await expect(page.getByRole("region", { name: "Research Office floor" })).toHaveScreenshot("research-office.png", { animations: "disabled" });

  await page.getByRole("button", { name: "Agent Desk" }).click();
  await expect(page.getByRole("region", { name: "Agent Desk" })).toHaveScreenshot("agent-desk.png", { animations: "disabled" });

  await page.getByRole("button", { name: "Tribunal Room" }).click();
  await expect(page.getByRole("region", { name: "Tribunal Room" })).toHaveScreenshot("tribunal-room.png", { animations: "disabled" });

  await page.getByRole("button", { name: "Review Office" }).click();
  await expect(page.getByRole("region", { name: "Review Office" })).toHaveScreenshot("review-office.png", { animations: "disabled" });

  await page.getByRole("button", { name: "Final Report" }).click();
  await expect(page.getByRole("region", { name: "Final Report" })).toHaveScreenshot("final-report.png", { animations: "disabled" });

  await page.getByRole("button", { name: "Mission Replay" }).click();
  await expect(page.getByRole("region", { name: "Mission Replay" })).toHaveScreenshot("mission-replay.png", { animations: "disabled" });
});

for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
]) {
  test(`keeps the command desk inside ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    if (viewport.width >= 1280) await expect(page.getByRole("button", { name: "Research Office", exact: true })).toBeVisible();
    else await expect(page.getByRole("button", { name: "Workspace Research Office" })).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("region", { name: "Research Office floor" })).toBeVisible();
    const officeDimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      workGraphs: document.querySelectorAll(".work-graph").length,
      ledgers: document.querySelectorAll(".ledger-panel").length,
      eventTrails: document.querySelectorAll(".event-panel").length,
    }));
    expect(officeDimensions.scrollWidth).toBe(officeDimensions.clientWidth);
    expect(officeDimensions).toMatchObject({ workGraphs: 1, ledgers: 1, eventTrails: 1 });
    await page.screenshot({ path: testInfo.outputPath(`research-prototype-${viewport.width}.png`), fullPage: true, animations: "disabled" });
    if (viewport.width === 390) await expect(page).toHaveScreenshot("clean-research-mobile.png", { animations: "disabled", fullPage: true });

    for (const surface of ["Agent Desk", "Tribunal Room", "Review Office", "Final Report", "Mission Replay"]) {
      if (surface === "Agent Desk" && viewport.width < 1280) await page.getByRole("button", { name: "Workspace Research Office" }).click();
      await page.getByRole("button", { name: surface }).click();
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(dimensions.scrollWidth, `${surface} should not overflow at ${viewport.width}px`).toBe(dimensions.clientWidth);
    }
  });
}

test("prototype header fits one desktop line and provides keyboard-accessible compact navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(nav.getByRole("button")).toHaveCount(6);
  await expect(nav.getByRole("button", { name: "Research Office" })).toHaveAttribute("aria-current", "page");
  const rows = await nav.getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().top));
  expect(new Set(rows).size).toBe(1);
  expect(await page.locator(".topbar").evaluate((header) => header.getBoundingClientRect().height)).toBeLessThanOrEqual(81);
  await page.setViewportSize({ width: 390, height: 844 });
  const toggle = page.getByRole("button", { name: "Workspace Research Office" });
  await expect(nav).toBeHidden();
  await toggle.focus();
  await toggle.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(nav.getByRole("button")).toHaveCount(6);
  await toggle.press("Tab");
  await expect(nav.getByRole("button", { name: "Research Office" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
  await expect(nav).toBeHidden();
  await toggle.press("Enter");
  await nav.getByRole("button", { name: "Agent Desk" }).click();
  await expect(page.getByRole("region", { name: "Agent Desk" })).toBeVisible();
});

test("research dossier preserves findings, keyboard tabs, provenance and policy disclosure", async ({ page }) => {
  const office = page.getByRole("region", { name: "Research Office floor" });
  await expect(office.locator(".finding-record")).toHaveCount(1);
  await expect(office).toContainText("Workspace demand mapped.");
  await office.locator(".finding-record summary").click();
  await expect(office.locator(".finding-provenance")).toContainText("Not recorded");
  await expect(office.locator(".finding-provenance")).toContainText("25 replay units");

  const findings = office.getByRole("tab", { name: "Findings", exact: true });
  const dependencies = office.getByRole("tab", { name: "Dependencies", exact: true });
  await findings.focus();
  await findings.press("ArrowRight");
  await expect(dependencies).toBeFocused();
  await expect(dependencies).toHaveAttribute("aria-selected", "true");
  await expect(office.getByRole("tabpanel", { name: "Dependencies" })).toContainText("Starting task");
  await dependencies.press("Home");
  await expect(findings).toBeFocused();
  await expect(office.getByRole("tabpanel", { name: "Findings" })).toBeVisible();

  await page.getByRole("button", { name: "Mission controls", exact: true }).click();
  await page.getByRole("button", { name: "BLOCKED", exact: true }).click();
  await office.getByRole("button", { name: "Open required approval", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("This local disclosure does not change mission data or policy.");
  await page.getByRole("button", { name: "COMPLETED", exact: true }).click();
  await expect(office.locator(".finding-record")).toHaveCount(4);
  await expect(office.locator(".pending-research")).toHaveCount(0);
  await expect(office).toContainText("4 of 4 recorded tasks completed");
  await office.getByRole("button", { name: "Inspect evidence", exact: true }).click();
  await expect(page.getByRole("region", { name: "Agent Desk" })).toBeVisible();
});

test("research dossier is honest when a saved history has no research attempts", async ({ page }) => {
  await page.route("**/api/missions", (route) => route.fulfill({
    json: { missionId: officeHistories.RUNNING[0]!.missionId, fixtureId: "crosscurrent-workspace-market", events: [officeHistories.RUNNING[0]!] },
  }));
  await page.getByRole("button", { name: "Mission controls", exact: true }).click();
  await page.getByRole("button", { name: "Launch local mission", exact: true }).click();
  const office = page.getByRole("region", { name: "Research Office floor" });
  await expect(office).toContainText("No completed findings yet");
  await expect(office).toContainText("0 of 0 recorded tasks completed");
  await expect(office.locator(".finding-record")).toHaveCount(0);
  await expect(office.locator(".team-member")).toHaveCount(0);
  await office.locator(".office-detail > summary").click();
  await expect(office.getByRole("region", { name: "Mission ledger", exact: true })).toContainText("140");
});

for (const width of [1440, 768, 375]) {
  test(`clarity and long finding layout at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 900 });
    await expect(page.locator(".source-label")).toHaveText("Synthetic demo · recorded replay");
    await expect(page.locator(".research-status")).toHaveText("Replaying · 2 of 3 researchers active");
    await expect(page.locator(".dossier-intro, .dossier-toolbar")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "RUNNING", exact: true })).toBeHidden();
    const first = page.locator(".finding-record > summary").first();
    if (width === 1440) expect(await first.evaluate((node) => node.getBoundingClientRect().bottom)).toBeLessThanOrEqual(900);
    await page.screenshot({ path: testInfo.outputPath(`clarity-${width}.png`), fullPage: true, animations: "disabled" });
    const contrast = await page.evaluate(() => {
      const rgb = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      const luminance = (values: number[]) => values.map((value) => { const s = value / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i]!, 0);
      return [".source-label", ".source-notice > span", ".finding-copy small", ".finding-copy strong", ".research-status", ".event summary"].flatMap((selector) => [...document.querySelectorAll(selector)].map((node) => {
        let ancestor: Element | null = node;
        while (ancestor && getComputedStyle(ancestor).backgroundColor === "rgba(0, 0, 0, 0)") ancestor = ancestor.parentElement;
        const background = ancestor ? getComputedStyle(ancestor).backgroundColor : "rgb(255, 255, 255)";
        const a = luminance(rgb(getComputedStyle(node).color)); const b = luminance(rgb(background));
        return { selector, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
      }));
    });
    for (const item of contrast) expect(item.ratio, `${item.selector} contrast`).toBeGreaterThanOrEqual(4.5);

    await page.route("**/api/missions", (route) => route.fulfill({ json: { missionId: researchLayoutHistory[0]!.missionId, fixtureId: "crosscurrent-workspace-market", events: researchLayoutHistory } }));
    await page.getByRole("button", { name: "Mission controls", exact: true }).click();
    await page.getByRole("button", { name: "Launch local mission", exact: true }).click();
    await expect(page.locator(".finding-text").first()).toContainText("Layout-only sample");
    await expect(page.locator(".finding-text").nth(1).locator(":scope > span")).toHaveCount(3);
    const metrics = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, proseWidth: document.querySelector(".finding-text")!.getBoundingClientRect().width, maxWidth: getComputedStyle(document.querySelector(".finding-text")!).maxWidth }));
    expect(metrics.scroll).toBe(metrics.width);
    expect(metrics.proseWidth).toBeLessThanOrEqual(parseFloat(metrics.maxWidth));
    await page.screenshot({ path: testInfo.outputPath(`long-findings-${width}.png`), fullPage: true, animations: "disabled" });
  });
}
