import { expect, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

// The visual baseline of the run replay screen. Kept in its own file so the baseline can be reviewed and
// approved before it is committed; never regenerate it just to get a green run (see CLAUDE.md).
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
  await page.getByRole("button", { name: "Mission Replay", exact: true }).click();
  await page.getByRole("button", { name: "Imported agent run" }).click();
  const replay = page.getByRole("region", { name: "Agent run replay" });
  await replay.getByLabel("Timeline position").fill("22");
  await expect(replay.getByRole("heading", { name: "Step failed" })).toBeVisible();
  await expect(replay).toHaveScreenshot("run-replay.png", { animations: "disabled" });
});
