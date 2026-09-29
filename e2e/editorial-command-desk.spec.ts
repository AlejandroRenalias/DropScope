import { expect, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

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

test("captures the six editorial command desk surfaces", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

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
  test(`keeps the command desk inside ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("button", { name: "Research Office" })).toBeVisible();
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

    for (const surface of ["Agent Desk", "Tribunal Room", "Review Office", "Final Report", "Mission Replay"]) {
      await page.getByRole("button", { name: surface }).click();
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(dimensions.scrollWidth, `${surface} should not overflow at ${viewport.width}px`).toBe(dimensions.clientWidth);
    }
  });
}
