import { expect, test, type Page } from "@playwright/test";
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

const COMPACT_NAVIGATION_MAX_WIDTH = 760;

async function openSurface(page: Page, label: string) {
  if ((page.viewportSize()?.width ?? 1440) <= COMPACT_NAVIGATION_MAX_WIDTH) {
    const toggle = page.getByRole("button", { name: /^Workspace/ });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  }
  await page.getByRole("button", { name: label, exact: true }).click();
}

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

test("captures the six command-center surfaces", async ({ page }) => {
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
  test(`keeps the command center inside ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    if (viewport.width > COMPACT_NAVIGATION_MAX_WIDTH) await expect(page.getByRole("button", { name: "Research Office", exact: true })).toBeVisible();
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
    await page.screenshot({ path: testInfo.outputPath(`research-office-${viewport.width}.png`), fullPage: true, animations: "disabled" });
    if (viewport.width === 390) await expect(page).toHaveScreenshot("clean-research-mobile.png", { animations: "disabled", fullPage: true });

    for (const surface of ["Agent Desk", "Tribunal Room", "Review Office", "Final Report", "Mission Replay"]) {
      await openSurface(page, surface);
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(dimensions.scrollWidth, `${surface} should not overflow at ${viewport.width}px`).toBe(dimensions.clientWidth);
    }
  });
}

test("top bar fits one desktop line, shows live status, and provides keyboard-accessible compact navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(nav.getByRole("button")).toHaveCount(6);
  await expect(nav.getByRole("button", { name: "Research Office" })).toHaveAttribute("aria-current", "page");
  const rows = await nav.getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().top));
  expect(new Set(rows).size).toBe(1);
  expect(await page.locator(".topbar").evaluate((header) => header.getBoundingClientRect().height)).toBeLessThanOrEqual(81);
  await expect(page.locator(".live-status")).toContainText("2 researchers working");
  await expect(page.locator(".event-counter")).toHaveText(/^Event \d+ \/ \d+$/);
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

test("constellation shows real dependencies, keyboard selection, findings, provenance and policy disclosure", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const office = page.getByRole("region", { name: "Research Office floor" });
  await expect(office.locator(".cnode")).toHaveCount(3);
  await expect(office.locator(".edge")).toHaveCount(2);
  await expect(office.getByRole("button", { name: "Market: Completed" })).toBeVisible();
  await expect(office.getByRole("button", { name: "Evidence: Working" })).toBeVisible();

  const latest = office.getByRole("article", { name: "Latest finding" });
  await expect(latest).toContainText("Workspace demand mapped.");
  await expect(latest).toContainText("25 replay units");
  await expect(latest).toContainText("Not recorded");
  await expect(office.locator(".finding-record")).toHaveCount(0);

  const selected = office.getByRole("region", { name: "Selected task" });
  await expect(selected).toContainText("workflow-interviews");
  const operations = office.getByRole("button", { name: "Operations: Working" });
  await operations.focus();
  await operations.press("Enter");
  await expect(operations).toHaveAttribute("aria-pressed", "true");
  await expect(selected).toContainText("supplier-check");
  await office.getByRole("button", { name: "Market: Completed" }).click();
  await expect(selected).toContainText("Recorded finding");
  await expect(selected).toContainText("Workspace demand mapped.");

  await page.getByRole("button", { name: "Mission controls", exact: true }).click();
  await page.getByRole("button", { name: "BLOCKED", exact: true }).click();
  await expect(page.locator(".live-status")).toContainText("Policy block");
  await office.getByRole("button", { name: "Open required approval", exact: true }).first().click();
  await expect(page.getByRole("status")).toContainText("This local disclosure does not change mission data or policy.");
  await page.getByRole("button", { name: "COMPLETED", exact: true }).click();
  await expect(page.locator(".live-status")).toContainText("Mission complete");
  await expect(office.locator(".finding-record")).toHaveCount(3);
  await office.locator(".finding-record summary").first().click();
  await expect(office.locator(".finding-provenance").first()).toContainText("Not recorded");
  await expect(office).toContainText("4 of 4 recorded tasks completed");
  await expect(office.getByRole("group", { name: "Task dependency map" })).toBeVisible();
  await office.getByRole("button", { name: /^Inspect evidence/ }).click();
  await expect(page.getByRole("region", { name: "Agent Desk" })).toBeVisible();
});

test("recorded decisions and activity navigate to their screens", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const office = page.getByRole("region", { name: "Research Office floor" });
  const decisions = office.getByRole("region", { name: "Recorded decisions" });
  await expect(decisions).toContainText("Tribunal");
  await expect(decisions).toContainText("Blind review");
  await decisions.getByRole("button", { name: "Open" }).first().click();
  await expect(page.getByRole("region", { name: "Tribunal Room" })).toBeVisible();
  await page.getByRole("button", { name: "Research Office", exact: true }).click();
  await office.getByRole("button", { name: /^All events/ }).click();
  await expect(page.getByRole("region", { name: "Mission Replay" })).toBeVisible();
});

test("research office is honest when a saved history has no research attempts", async ({ page }) => {
  await page.route("**/api/missions", (route) => route.fulfill({
    json: { missionId: officeHistories.RUNNING[0]!.missionId, fixtureId: "crosscurrent-workspace-market", events: [officeHistories.RUNNING[0]!] },
  }));
  await page.getByRole("button", { name: "Mission controls", exact: true }).click();
  await page.getByRole("button", { name: "Launch local mission", exact: true }).click();
  const office = page.getByRole("region", { name: "Research Office floor" });
  await expect(office).toContainText("No completed findings yet");
  await expect(office).toContainText("0 of 0 recorded tasks completed");
  await expect(office).toContainText("No tasks are recorded in this replay yet.");
  await expect(office.locator(".finding-record")).toHaveCount(0);
  await expect(office.locator(".team-member")).toHaveCount(0);
  await expect(office.getByRole("region", { name: "Mission budget · units" })).toContainText("140");
  await expect(page.locator(".live-status")).toContainText("No researchers working");
});

for (const width of [1440, 768, 375]) {
  test(`clarity and long finding layout at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".source-label")).toHaveText("Synthetic demo · recorded replay");
    await expect(page.locator(".live-status")).toContainText("2 researchers working");
    await expect(page.getByRole("button", { name: "RUNNING", exact: true })).toBeHidden();
    if (width === 1440) expect(await page.locator(".work-graph").evaluate((node) => node.getBoundingClientRect().bottom)).toBeLessThanOrEqual(900);
    await page.screenshot({ path: testInfo.outputPath(`clarity-${width}.png`), fullPage: true, animations: "disabled" });
    const contrast = await page.evaluate(() => {
      type Rgba = [number, number, number, number];
      const parse = (value: string): Rgba => { const parts = value.match(/[\d.]+/g)!.map(Number); return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1]; };
      const luminance = (values: number[]) => values.map((value) => { const s = value / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i]!, 0);
      const backdrop = (node: Element): number[] => {
        const layers: Rgba[] = [];
        for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parentElement) {
          const color = parse(getComputedStyle(ancestor).backgroundColor);
          if (color[3] > 0) layers.push(color);
          if (color[3] === 1) break;
        }
        let base: number[] = [255, 255, 255];
        for (const [r, g, b, a] of layers.reverse()) base = [r * a + base[0]! * (1 - a), g * a + base[1]! * (1 - a), b * a + base[2]! * (1 - a)];
        return base;
      };
      const selectors = [".source-label", ".source-copy", ".live-status b", ".chip", ".eyebrow", ".cnode-copy small", ".cnode-copy strong", ".cnode-copy em", ".tl-item summary", ".decisions small", ".roster small", ".note", ".inspector dt", ".finding-top", ".facts dt", ".facts dd", ".finding-text > span", ".finding-source", ".stages li"];
      return selectors.flatMap((selector) => [...document.querySelectorAll(selector)].filter((node) => (node as HTMLElement).offsetParent !== null).map((node) => {
        const color = parse(getComputedStyle(node).color);
        const a = luminance([color[0], color[1], color[2]]); const b = luminance(backdrop(node));
        return { selector, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
      }));
    });
    for (const item of contrast) expect(item.ratio, `${item.selector} contrast`).toBeGreaterThanOrEqual(4.5);

    await page.route("**/api/missions", (route) => route.fulfill({ json: { missionId: researchLayoutHistory[0]!.missionId, fixtureId: "crosscurrent-workspace-market", events: researchLayoutHistory } }));
    await page.getByRole("button", { name: "Mission controls", exact: true }).click();
    await page.getByRole("button", { name: "Launch local mission", exact: true }).click();
    await expect(page.locator(".earlier .finding-text").first()).toContainText("Layout-only sample");
    await expect(page.locator(".earlier .finding-text").nth(1).locator(":scope > span")).toHaveCount(3);
    const metrics = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, proseWidth: document.querySelector(".earlier .finding-text")!.getBoundingClientRect().width, maxWidth: getComputedStyle(document.querySelector(".earlier .finding-text")!).maxWidth }));
    expect(metrics.scroll).toBe(metrics.width);
    expect(metrics.proseWidth).toBeLessThanOrEqual(parseFloat(metrics.maxWidth));
    await page.screenshot({ path: testInfo.outputPath(`long-findings-${width}.png`), fullPage: true, animations: "disabled" });
  });
}

test("every screen keeps the mission rails and budget visible", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const surface of ["Agent Desk", "Tribunal Room", "Review Office", "Final Report", "Mission Replay"]) {
    await page.getByRole("button", { name: surface, exact: true }).click();
    await expect(page.getByRole("complementary", { name: "Mission status" }), surface).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Budget and activity" }), surface).toBeVisible();
    await expect(page.getByRole("region", { name: "Mission budget · units" }), surface).toContainText("140");
    await expect(page.locator(".source-label"), surface).toHaveText("Synthetic demo · recorded replay");
  }
});

test("mission replay scrubs the constellation, rails and top bar together", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Mission Replay", exact: true }).click();
  const replay = page.getByRole("region", { name: "Mission Replay" });
  const budget = page.getByRole("region", { name: "Mission budget · units" });
  await expect(replay).toContainText(/Event 16 \/ 16/);
  await expect(page.locator(".event-counter")).toHaveText("Event 16 / 16");
  await expect(budget).toContainText("65");

  await replay.getByRole("button", { name: "Event 8, agent" }).click();
  await expect(replay).toContainText(/Event 8 \/ 16/);
  await expect(page.locator(".event-counter")).toHaveText("Event 8 / 16");
  await expect(replay.getByRole("region", { name: "Mission state at this event" })).toContainText("State as of event 8");
  await expect(replay.getByRole("heading", { name: "Finding submitted" })).toBeVisible();
  await expect(replay.locator(".deltas")).toContainText("Market: Working → Completed");
  await expect(replay.locator(".just-changed")).toHaveCount(1);
  await expect(budget).toContainText("115");
  await expect(page.getByRole("complementary", { name: "Mission status" }).locator(".team-member")).toHaveCount(1);
  await expect(page.locator(".live-status")).toContainText("No researchers working");

  const slider = replay.getByLabel("Timeline position");
  await slider.focus();
  await slider.press("ArrowRight");
  await expect(replay).toContainText(/Event 9 \/ 16/);
  await slider.press("End");
  await expect(replay).toContainText(/Event 16 \/ 16/);
  await expect(budget).toContainText("65");

  await replay.getByRole("button", { name: "Review", exact: true }).click();
  await expect(replay.getByRole("button", { name: "Review", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(replay.locator(".replay-events .event")).toHaveCount(14);
  await replay.locator(".replay-events .event").first().getByRole("button", { name: "Inspect" }).click();
  await expect(replay).toContainText(/Event 1 \/ 16/);
  await replay.getByText("Show raw payload").click();
  await expect(replay.locator(".raw pre")).toContainText("totalBudget");

  await replay.getByRole("button", { name: "COMPLETED", exact: true }).click();
  await expect(replay).toContainText(/Event 28 \/ 28/);
  await expect(page.locator(".live-status")).toContainText("Mission complete");
});

test("final report leads with the verdict, ranking, held-out reasons and a score profile", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Final Report", exact: true }).click();
  const report = page.getByRole("region", { name: "Final Report" });
  await expect(report.getByRole("heading", { name: "Recorded opportunity priorities" })).toBeVisible();
  const hero = report.getByRole("article", { name: "Report headline" });
  await expect(hero).toContainText("deskflow-alpha leads the priorities.");
  await expect(hero).toContainText("Reviewer verdict · Revise");
  await expect(hero).toContainText("Allowed");
  await expect(hero).toContainText("4 candidates");
  await expect(report.locator(".rp-rank li")).toHaveCount(3);
  await expect(report.locator(".rp-rank li").first()).toContainText("86");
  await expect(report.locator(".rp-held li")).toHaveCount(4);
  await expect(report.locator(".rp-held").first()).toContainText("RISK_GATE_NOT_ALLOWED");
  await expect(report.getByRole("img", { name: /Score profile: Customer problem 91/ })).toBeVisible();
  await expect(report.locator(".rp-vs")).toContainText("Advertising saturation 24/100");
  await expect(report.locator(".rp-next")).toContainText("deepen validation for deskflow-alpha");
  expect(await report.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
});