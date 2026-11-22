import { expect, test } from "@playwright/test";
import { expectPicture } from "./fixtures/picture.js";
import { createServer, type ViteDevServer } from "vite";
import { chooseRun, openTool } from "./fixtures/replay.js";

// The visual baseline of the run replay screen. Kept in its own file so the baseline can be reviewed and
// approved before it is committed; never regenerate it just to get a green run.
let viteServer: ViteDevServer;

test.beforeAll(async () => {
  viteServer = await createServer({ server: { host: "127.0.0.1", port: 5177 } });
  await viteServer.listen();
});

test.afterAll(async () => {
  await viteServer.close();
});

test("captures the run replay surface", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.addStyleTag({ content: ".topbar { position: static !important; }" });
  await page.setViewportSize({ width: 1440, height: 900 });
  const replay = page.getByRole("region", { name: "Agent run replay" });
  await replay.getByLabel("Timeline position").fill("22");
  await expect(replay.getByRole("heading", { name: "Step failed" })).toBeVisible();
  await expectPicture(replay, "run-replay.png", { animations: "disabled" });
  // The timeline with the budget marker legend: the legend must not touch the tick numbers.
  await expectPicture(replay.locator("#rr-timeline"), "timeline-legend.png", { animations: "disabled" });
});

test("captures the budget replay panel with a result", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.addStyleTag({ content: ".topbar { position: static !important; }" });
  // Tall enough, with the tools panel enlarged, for the whole panel to show without scrolling.
  await page.setViewportSize({ width: 1440, height: 1300 });
  const replay = page.getByRole("region", { name: "Agent run replay" });
  await openTool(page, "Budget replay");
  await page.getByRole("button", { name: "Enlarge the tools panel" }).click();
  const panel = replay.getByRole("region", { name: "Budget replay" });
  await panel.getByRole("button", { name: /Try an example/ }).click();
  await expect(panel.locator(".bp-result")).toContainText("would have stopped this run at event 31 of 42");
  await replay.getByLabel("Timeline position").fill("31");
  await expect(panel.locator(".bp-gauge.over")).toContainText("4,065 tokens");
  await expectPicture(panel, "budget-replay.png", { animations: "disabled" });
});

test("captures the claim check panel with results", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.addStyleTag({ content: ".topbar { position: static !important; }" });
  await page.setViewportSize({ width: 1440, height: 1300 });
  await chooseRun(page, "Demo run with content stored");
  const replay = page.getByRole("region", { name: "Agent run replay" });
  await openTool(page, "Claim check");
  await page.getByRole("button", { name: "Enlarge the tools panel" }).click();
  const panel = replay.getByRole("region", { name: "Claim check" });
  await panel.getByRole("button", { name: /Try an example/ }).click();
  await expect(panel.locator(".cc-summary")).toContainText("2 supported, 1 not supported");
  await expectPicture(panel, "claim-check.png", { animations: "disabled" });
});
